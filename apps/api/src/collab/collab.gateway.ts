import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { CollabAccessService } from './collab-access.service';
import { BODY, textOf, wordsIn } from './ydoc';

/** Room names are `branch:<uuid>`; nothing else is addressable. */
const ROOM = /^branch:([0-9a-f-]{36})$/i;

export const COLLAB_PATH = '/collab';

/**
 * Hocuspocus v4 reads the handshake as a Fetch `Request`; Node hands us an
 * `IncomingMessage`. Only the URL and headers are ever looked at - that is
 * where the room name and the cookies live.
 */
function toFetchRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === 'string') headers.set(key, value);
  }
  return new Request(url, { headers });
}

interface ConnectionContext {
  userId: string;
  handle: string;
  branchId: string;
  canEdit: boolean;
}

/**
 * The live draft rooms: several writers, and the model, in one document.
 *
 * Why a CRDT rather than the usual save-what-I-typed
 * --------------------------------------------------
 * Two people editing one chapter through ordinary writes means the second save
 * overwrites the first, so the product either locks the document to one person
 * or loses work. A CRDT removes the question: every client applies every edit
 * and all of them arrive at the same text regardless of order or timing, so
 * nobody waits for a lock and nobody's paragraph disappears. The server stops
 * being an arbiter and becomes a relay with a disk.
 *
 * Hocuspocus rather than a hand-rolled socket, because the hard parts here are
 * the sync protocol, awareness and debounced persistence - all solved, and all
 * tedious to get subtly right.
 *
 * It is mounted on the API's own HTTP server rather than run as a second
 * process: the connection has to be authorised against the same sessions,
 * branches and collaborators as every other request, and sharing the process
 * means sharing Prisma, the JWT secret and the logger instead of duplicating
 * all three behind a service boundary that buys nothing yet.
 */
@Injectable()
export class CollabGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabGateway.name);
  private hocus?: Hocuspocus;
  private wss?: WebSocketServer;
  private upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(
    private readonly config: ConfigService,
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly access: CollabAccessService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('COLLAB_ENABLED', 'true') !== 'true') {
      this.logger.log('collaborative drafts are off');
      return;
    }

    this.hocus = new Hocuspocus({
      name: 'audio-writer',
      // Quiet: Hocuspocus logs every connection at info by default.
      quiet: true,

      onAuthenticate: async (data) => {
        const branchId = this.branchOf(data.documentName);
        if (!branchId) throw new Error('unknown room');

        let payload: { sub?: string; handle?: string };
        try {
          payload = await this.jwt.verifyAsync(data.token, {
            secret: this.config.get<string>('JWT_ACCESS_SECRET'),
          });
        } catch {
          // Thrown rather than returned: Hocuspocus closes the socket on a
          // rejected promise, which is what an unauthenticated client deserves.
          throw new Error('bad token');
        }
        if (!payload.sub) throw new Error('bad token');

        const role = await this.access.roleFor(branchId, payload.sub);
        if (!role) throw new Error('no access to this draft');

        // A viewer is let in to watch, cursor and all, and cannot type. The
        // check lives here rather than in the client because the client is not
        // in a position to be trusted about it.
        data.connectionConfig.readOnly = role === 'VIEWER';

        return {
          userId: payload.sub,
          handle: payload.handle ?? 'ẩn danh',
          branchId,
          canEdit: role !== 'VIEWER',
        } satisfies ConnectionContext;
      },

      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            const branchId = this.branchOf(documentName);
            if (!branchId) return null;
            const row = await this.prisma.draftDoc.findUnique({
              where: { branchId },
              select: { state: true },
            });
            return row ? Uint8Array.from(row.state) : null;
          },

          // Hocuspocus debounces this: a room being typed in hard still writes
          // about once every two seconds, not once per keystroke.
          store: async ({ documentName, state, document }) => {
            const branchId = this.branchOf(documentName);
            if (!branchId) return;

            const words = wordsIn(textOf(document.getXmlFragment(BODY)));

            const bytes = Uint8Array.from(state);
            await this.prisma.draftDoc.upsert({
              where: { branchId },
              create: { branchId, state: bytes, wordCount: words },
              update: {
                state: bytes,
                wordCount: words,
                version: { increment: 1 },
              },
            });
          },
        }),
      ],
    });

    const http = this.adapterHost.httpAdapter?.getHttpServer() as
      | HttpServer
      | undefined;
    if (!http) {
      this.logger.error('no HTTP server to attach to; drafts are unavailable');
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });
    this.upgrade = (req, socket, head) => {
      const path = (req.url ?? '').split('?')[0];
      // Only ours. Anything else is left alone so another handler can take it,
      // instead of this one hijacking every upgrade on the server.
      if (path !== COLLAB_PATH) return;

      this.wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        // `handleConnection` only hands back the connection object; feeding it
        // is the integrator's job. Hocuspocus's own listener does exactly this,
        // and without it the socket opens, stays open, and never authenticates
        // or syncs, because the server is never shown a single message.
        const client = this.hocus!.handleConnection(ws, toFetchRequest(req));

        ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          const chunk = Array.isArray(data) ? Buffer.concat(data) : data;
          const bytes =
            chunk instanceof ArrayBuffer
              ? new Uint8Array(chunk)
              : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          client.handleMessage(bytes);
        });

        ws.on('close', (code: number, reason: Buffer) => {
          client.handleClose({ code, reason: reason?.toString() ?? '' });
        });

        // Keeps the connection's idle timer honest, so a quiet writer with the
        // tab open is not mistaken for a dead socket.
        ws.on('pong', () => client.touch());
      });
    };
    http.on('upgrade', this.upgrade);

    this.logger.log(`collaborative drafts up on ${COLLAB_PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
    const http = this.adapterHost.httpAdapter?.getHttpServer() as
      | HttpServer
      | undefined;
    if (http && this.upgrade) http.off('upgrade', this.upgrade);
    this.wss?.close();

    // Unload each room before the sockets go. Persistence is debounced by a
    // couple of seconds, so shutting down without this drops whatever was typed
    // inside that window - the one moment where losing keystrokes is certain
    // rather than unlikely.
    const hocus = this.hocus;
    if (hocus) {
      await Promise.all(
        [...hocus.documents.values()].map((doc) =>
          hocus.unloadDocument(doc).catch((err: Error) => {
            this.logger.warn(`could not flush ${doc.name}: ${err.message}`);
          }),
        ),
      );
      hocus.closeConnections();
    }
  }

  /** The server's own handle on a room, for writing into it without a socket. */
  get server(): Hocuspocus | undefined {
    return this.hocus;
  }

  private branchOf(documentName: string): string | null {
    const m = ROOM.exec(documentName);
    return m ? m[1] : null;
  }
}
