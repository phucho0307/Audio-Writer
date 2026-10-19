import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthorType } from '@prisma/client';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { StoriesService } from '../stories/stories.service';
import { LlmService } from '../llm/llm.service';
import { CollabAccessService } from './collab-access.service';
import { CollabGateway } from './collab.gateway';
import {
  appendParagraph,
  BODY,
  META,
  paragraphsOf,
  textOf,
  toProseMirror,
  wordsIn,
} from './ydoc';

export interface DraftState {
  branchId: string;
  text: string;
  wordCount: number;
  version: number;
  updatedAt: Date | null;
}

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stories: StoriesService,
    private readonly llm: LlmService,
    private readonly access: CollabAccessService,
    private readonly gateway: CollabGateway,
  ) {}

  private room(branchId: string): string {
    return `branch:${branchId}`;
  }

  /**
   * Read the draft without joining the room.
   *
   * Used by the commit path and by anything that wants the text but has no
   * business holding a socket open. A room with people in it is the live copy,
   * so that one is asked first; the stored snapshot is at most a couple of
   * seconds behind and is what answers when nobody is connected.
   */
  async read(branchId: string): Promise<DraftState> {
    await this.access.require(branchId, 'read');

    const live = this.gateway.server?.documents.get(this.room(branchId));
    if (live) {
      const text = textOf(live.getXmlFragment(BODY));
      return {
        branchId,
        text,
        wordCount: wordsIn(text),
        version: -1, // in memory, newer than anything stored
        updatedAt: null,
      };
    }

    const row = await this.prisma.draftDoc.findUnique({ where: { branchId } });
    if (!row) {
      return {
        branchId,
        text: '',
        wordCount: 0,
        version: 0,
        updatedAt: null,
      };
    }

    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(row.state));
    const text = textOf(doc.getXmlFragment(BODY));
    doc.destroy();

    return {
      branchId,
      text,
      wordCount: row.wordCount,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Turn the draft into a chapter.
   *
   * The draft is mutable and shared; a contribution is neither. Committing is
   * the moment one becomes the other, so it empties the room afterwards - the
   * text now lives in a contribution, and leaving a copy behind would let two
   * people keep editing something already published.
   */
  async commit(branchId: string, title?: string) {
    const { user } = await this.access.require(branchId, 'write');
    const draft = await this.read(branchId);

    if (!draft.text.trim()) {
      throw new BadRequestException('Bản nháp đang trống.');
    }

    const contribution = await this.stories.commit(branchId, {
      content: toProseMirror(draft.text.split(/\n\n+/).filter(Boolean)),
      textPlain: draft.text.trim(),
      title: title?.trim() || undefined,
      authorType: AuthorType.HUMAN,
    });

    await this.clear(branchId);
    this.logger.log(
      `branch ${branchId.slice(0, 8)} committed ${draft.wordCount} words by ${user.handle}`,
    );
    return contribution;
  }

  /** Empty the room and forget the snapshot. */
  async clear(branchId: string): Promise<void> {
    const connection = await this.gateway.server?.openDirectConnection(
      this.room(branchId),
    );
    if (connection) {
      await connection.transact((doc: Y.Doc) => {
        const body = doc.getXmlFragment(BODY);
        if (body.length) body.delete(0, body.length);
        doc.getMap(META).set('ai', null);
      });
      await connection.disconnect();
    }
    await this.prisma.draftDoc.deleteMany({ where: { branchId } });
  }

  /**
   * The model, writing into the same document as everyone else.
   *
   * It does not return text for the client to insert: it joins the room and
   * types, so every connected writer watches the same words appear in the same
   * place, and whatever they type meanwhile merges around it. The alternative -
   * generate, return, let one client paste it in - puts the result in exactly
   * one person's editor and leaves the others to receive it as a surprise.
   *
   * Progress is announced through a `meta` map in the same document rather than
   * a side channel, so the "đang viết" state converges like everything else and
   * cannot be left stuck on by a client that disconnects mid-stream.
   */
  async aiContinue(
    branchId: string,
    opts: { paragraphs?: number; pov?: 'first' | 'third_limited' },
  ): Promise<{ written: number }> {
    const { user } = await this.access.require(branchId, 'write');

    const server = this.gateway.server;
    if (!server) {
      throw new ServiceUnavailableException('Phòng viết chung đang tắt.');
    }

    const connection = await server.openDirectConnection(this.room(branchId));
    let written = 0;

    const mark = (state: unknown) =>
      connection.transact((doc: Y.Doc) => {
        doc.getMap(META).set('ai', state);
      });

    try {
      await mark({
        state: 'writing',
        by: user.handle,
        startedAt: Date.now(),
      });

      // Its own paragraph, so the model never continues the sentence a human
      // is in the middle of typing. Held across the stream: every chunk lands
      // in this node rather than making a paragraph each.
      let target: Y.XmlText | null = null;
      await connection.transact((doc: Y.Doc) => {
        target = appendParagraph(doc.getXmlFragment(BODY));
      });

      const stream = this.llm.continue(branchId, {
        pov: opts.pov ?? 'third_limited',
        paragraphs: (opts.paragraphs ?? 1) as 1 | 2 | 3,
      });

      for await (const chunk of stream) {
        if (!chunk) continue;
        // One transaction per chunk: each is a separate CRDT update, which is
        // what makes the text appear progressively for everyone rather than in
        // one lump at the end.
        await connection.transact(() => {
          const node = target as Y.XmlText | null;
          if (node) node.insert(node.length, chunk);
        });
        written += chunk.length;
      }

      await mark(null);
      return { written };
    } catch (err) {
      // The banner must not outlive the failure, or the room looks permanently
      // busy to everyone in it.
      await mark({ state: 'failed', message: (err as Error).message }).catch(
        () => undefined,
      );
      throw err;
    } finally {
      await connection.disconnect();
    }
  }

  /** Who is in the room right now, from the server's own awareness state. */
  presence(branchId: string) {
    const doc = this.gateway.server?.documents.get(this.room(branchId));
    if (!doc) return { count: 0, people: [] as { handle: string }[] };

    const people: { handle: string }[] = [];
    doc.awareness.getStates().forEach((state) => {
      const u = (state as { user?: { name?: string } }).user;
      if (u?.name) people.push({ handle: u.name });
    });
    return { count: doc.getConnectionsCount(), people };
  }

  /** Paragraph count, for a draft list that should not decode the whole CRDT. */
  paragraphs(branchId: string): number {
    const live = this.gateway.server?.documents.get(this.room(branchId));
    return live ? paragraphsOf(live.getXmlFragment(BODY)).length : 0;
  }
}
