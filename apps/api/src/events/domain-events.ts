import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { requestContext } from '../auth/request-context';

export interface DomainEventMap {
  /** A story became readable by strangers for the first time. */
  'story.published': { storyId: string };
  /** Somebody asked to hear a chapter, so the next one is probably next. */
  'chapter.played': { branchId: string; depth: number; voice: string };
  /** A chapter became part of a branch, and so part of what can be retrieved. */
  'chapter.committed': { contributionId: string; branchId: string };
  /**
   * Something a list shows about a public story changed - its title, its
   * rating, that it exists at all. Cached lists rebuild on it.
   */
  'story.changed': { storyId: string };
}

/**
 * In-process publish/subscribe, deliberately small.
 *
 * It exists to break a cycle rather than to be an architecture: `TtsModule`
 * already imports `StoriesModule`, so a story publishing itself cannot call
 * narration directly. An event lets the story layer announce what happened
 * without knowing or caring who reacts.
 *
 * Two properties matter and both are deliberate:
 *
 * - **Handlers never break the emitter.** Publishing a story must not fail
 *   because narration could not be queued. Everything a handler throws is
 *   logged and swallowed.
 * - **This is not durable.** Events live in this process and die with it, so a
 *   crash between the database write and the handler loses the reaction. That
 *   is exactly the gap a transactional outbox closes, and `outbox_events` is
 *   already in the schema waiting for it. Until then, nothing here may be the
 *   only path to something important - pre-rendering is an optimisation, and a
 *   reader asking for a chapter still queues it the ordinary way.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // These are fan-out notifications, not a queue; a busy story with several
    // listeners should not trip Node's leak warning.
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEventMap>(
    name: K,
    payload: DomainEventMap[K],
  ): void {
    this.emitter.emit(name, payload);
  }

  on<K extends keyof DomainEventMap>(
    name: K,
    handler: (payload: DomainEventMap[K]) => void | Promise<void>,
  ): void {
    this.emitter.on(name, (payload: DomainEventMap[K]) => {
      // Outside the emitting request's identity, deliberately.
      //
      // AsyncLocalStorage survives the microtask queue, so a handler scheduled
      // from inside a request inherits whoever made it - and then acts with
      // their permissions. Publishing a story would have pre-rendered it as
      // the owner, which means past the paywall and over the whole book rather
      // than over the free chapters an anonymous reader sees. On a long story
      // that is hundreds of syntheses against a quota measured in tens.
      //
      // A reaction to something that happened is not being performed on behalf
      // of whoever triggered it, so it gets no identity at all. Anything a
      // handler is allowed to do, it must be allowed to do as nobody.
      requestContext.exit(() => {
        void (async () => {
          try {
            await handler(payload);
          } catch (err) {
            this.logger.error(
              `handler for ${String(name)} failed: ${(err as Error).message}`,
            );
          }
        })();
      });
    });
  }
}
