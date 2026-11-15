'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { ApiError, api, type Collaborator, type Room } from '@/lib/api';
import FormatToolbar from '@/app/FormatToolbar';
import ShareDialog from './ShareDialog';
import { getToken } from '@/lib/auth';
import { collabUrl, colorFor, roomFor } from '@/lib/collab';

/**
 * The editor itself, mounted only once there is a socket to bind it to.
 *
 * This is a component rather than a `useEditor` call up in the room for one
 * blunt reason: TipTap builds a ProseMirror schema the moment it is
 * constructed, and a schema needs at least a document node. The previous
 * version passed an empty extension list while the provider was still
 * connecting, which threw `Schema is missing its top node type ('doc')` and
 * left the room on "Đang mở tài liệu…" forever. Deferring the whole component
 * means the extension list is never empty and the editor is never rebuilt - a
 * rebuild re-binds the document and drops every caret in the room.
 *
 * It was invisible to the test suite, which drives Yjs and the socket directly
 * and never constructs an editor. Only a browser could have caught it.
 */
function RoomEditor({
  provider,
  doc,
  handle,
  canEdit,
}: {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  handle: string;
  canEdit: boolean;
}) {
  const editor = useEditor({
    editable: canEdit,
    immediatelyRender: false,
    extensions: [
      // History is Yjs's own: ProseMirror's undo stack would undo other
      // people's typing as readily as your own.
      StarterKit.configure({
        undoRedo: false,
        heading: { levels: [3] },
        link: { openOnClick: false, autolink: true },
      }),
      Collaboration.configure({ document: doc, field: 'body' }),
      CollaborationCaret.configure({
        provider,
        user: { name: handle, color: colorFor(handle) },
      }),
    ],
    editorProps: {
      attributes: { class: 'prose-editor', spellcheck: 'false' },
    },
  });

  // Permission arrives a moment after the room does, and flipping it must not
  // cost anyone their cursor - so it is applied to the live editor rather than
  // being a reason to build a new one.
  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  if (!editor) {
    return (
      <p className="min-h-[42vh] text-[13px] text-[var(--color-muted)]">
        Đang mở tài liệu…
      </p>
    );
  }

  // The same formatting bar as every other writing box; it hides itself
  // for viewers, whose editor is read-only.
  return (
    <div className="flex flex-col gap-2">
      <FormatToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

type Peer = { handle: string; color: string };
type AiState = { state: 'writing' | 'failed'; by?: string; message?: string } | null;

/**
 * One chapter, several writers, and the model, in the same document.
 *
 * The editor is bound to a Yjs document rather than to React state: every
 * keystroke is a CRDT update that goes to everyone in the room and merges with
 * theirs, so there is no save button, no "someone else is editing" banner and
 * no last-write-wins. React here only draws the furniture around it.
 */
export default function DraftRoom({
  branchId,
  storyId,
  me,
  canEdit,
}: {
  branchId: string;
  storyId: string;
  me: { handle: string; displayName: string };
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting,
  );
  const [denied, setDenied] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [ai, setAi] = useState<AiState>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState<'ai' | 'commit' | 'invite' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [words, setWords] = useState(0);

  // One document and one socket for the life of the component. Recreating
  // either on a re-render would drop everyone's cursor and re-sync the room.
  const doc = useMemo(() => new Y.Doc(), []);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: roomFor(branchId),
      document: doc,
      token: () => getToken() ?? '',
      onStatus: ({ status }) => setStatus(status),
      onAuthenticationFailed: ({ reason }) =>
        setDenied(reason || 'Bạn không có quyền mở bản nháp này.'),
      // A refusal can be transient - an expired token that the next reconnect
      // carries a fresh one for - so it is cleared on success rather than
      // stranding the writer on an error screen until they reload.
      onAuthenticated: () => setDenied(null),
    });

    p.setAwarenessField('user', {
      name: me.handle,
      color: colorFor(me.handle),
    });

    const onAwareness = () => {
      const seen = new Map<string, Peer>();
      p.awareness?.getStates().forEach((state, clientId) => {
        const u = (state as { user?: Peer & { name?: string } }).user;
        if (!u?.name) return;
        if (clientId === doc.clientID) return; // not myself
        seen.set(u.name, { handle: u.name, color: u.color });
      });
      setPeers([...seen.values()]);
    };
    p.on('awarenessUpdate', onAwareness);

    providerRef.current = p;
    setProvider(p);

    return () => {
      p.off('awarenessUpdate', onAwareness);
      p.destroy();
      providerRef.current = null;
    };
  }, [branchId, doc, me.handle]);

  /**
   * Count from the document, not from editor events.
   *
   * `onUpdate` fires on edits, and an initial sync is not an edit: opening a
   * draft that already has text left the count at zero and the commit button
   * disabled, with the prose sitting right there on screen. The shared
   * fragment is also exactly what the server counts, so the two cannot
   * disagree.
   */
  useEffect(() => {
    const body = doc.getXmlFragment('body');
    const recount = () => {
      const text = body
        .toString()
        .replace(/<[^>]+>/g, ' ')
        .trim();
      setWords(text ? text.split(/\s+/).length : 0);
    };
    body.observeDeep(recount);
    recount();
    return () => body.unobserveDeep(recount);
  }, [doc]);

  // The model's progress is a field in the shared document, so it converges
  // like the prose does and cannot be left switched on by a client that
  // disappears halfway through.
  useEffect(() => {
    const meta = doc.getMap('meta');
    const read = () => setAi((meta.get('ai') as AiState) ?? null);
    meta.observe(read);
    read();
    return () => meta.unobserve(read);
  }, [doc]);

  useEffect(() => {
    api.room(branchId).then(setRoom).catch(() => undefined);
  }, [branchId]);

  async function runAi() {
    setBusy('ai');
    setError(null);
    try {
      await api.draftAi(branchId, { paragraphs: 1 });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'AI_QUOTA_EXHAUSTED'
          ? 'Hết lượt AI hôm nay.'
          : (e as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!words) {
      setError('Bản nháp đang trống.');
      return;
    }
    setBusy('commit');
    setError(null);
    try {
      const landed = await api.commitDraft(branchId, title.trim() || undefined);
      setTitle('');
      // An invited writer's chapter lives on their own branch now, so that is
      // where they are taken - back to the owner's story would show them a
      // page their chapter is (correctly) not on.
      window.location.href = landed.forked
        ? `/stories/${storyId}?branch=${landed.branchId}`
        : `/stories/${storyId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function invite(role: 'EDITOR' | 'VIEWER') {
    const h = handle.trim().replace(/^@/, '');
    if (!h) return;
    setBusy('invite');
    setError(null);
    try {
      setRoom(await api.invite(branchId, h, role));
      setHandle('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(c: Collaborator) {
    try {
      setRoom(await api.revoke(branchId, c.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (denied) {
    // The server's reason is a protocol code - "permission-denied" - which
    // was being shown to people verbatim. What they need is what it means and
    // what they can do instead: a room is by invitation, and anyone can still
    // write their own version by forking.
    return (
      <div className="card flex flex-col items-start gap-3 p-6">
        <span className="label label-accent">Phòng viết chung</span>
        <h2 className="display text-[22px] leading-snug">
          Bạn chưa được mời vào phòng này.
        </h2>
        <p className="max-w-[52ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
          Phòng viết chung chỉ dành cho chủ nhánh và những người họ mời. Muốn viết theo
          hướng của bạn thì rẽ nhánh từ truyện, bản gốc không bị ảnh hưởng.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/kham-pha/${storyId}`} className="btn btn-primary">
            <span aria-hidden>⑂</span> Rẽ nhánh
          </a>
          <a href={`/doc/${storyId}`} className="btn btn-ghost">
            Đọc truyện
          </a>
        </div>
      </div>
    );
  }

  const live = status === WebSocketStatus.Connected;
  // In the room as an invited writer rather than as its owner - decides both
  // the publish button's wording and where the server will put the chapter.
  const guest = room !== null && room.owner.handle !== me.handle;

  return (
    <div className="flex flex-col gap-4">
      {/* who is here */}
      <div className="flex flex-wrap items-center gap-3 border-y border-[var(--color-line)] py-2.5">
        {/* The connected state used to read "đang kết nối phòng viết", which
            is what you say while you are still connecting - so a room that was
            working looked stuck, and a room that was genuinely reconnecting
            looked the same. It now says what is true, and counts the people in
            it, which is the thing a writer actually wants to know. */}
        <span
          className={`dot ${live ? 'dot-on' : 'dot-live'}`}
          aria-hidden
        />
        <span className="text-[12px] text-[var(--color-muted)]" aria-live="polite">
          {live
            ? peers.length > 0
              ? `Phòng mở · ${peers.length + 1} người đang viết`
              : 'Phòng mở · chỉ có bạn'
            : 'Đang kết nối lại…'}
        </span>

        <div className="flex items-center gap-1.5">
          <Dot handle={me.handle} color={colorFor(me.handle)} self />
          {peers.map((p) => (
            <Dot key={p.handle} handle={p.handle} color={p.color} />
          ))}
        </div>

        <span className="ml-auto text-[12px] tabular-nums text-[var(--color-muted)]">
          {words} từ
        </span>
        {/* Owner only: who is in the room, and the link. */}
        {room && !guest && (
          <button onClick={() => setSharing(true)} className="btn btn-primary btn-sm">
            Chia sẻ
          </button>
        )}
      </div>

      {sharing && room && (
        <ShareDialog
          branchId={branchId}
          room={room}
          onRoomChange={setRoom}
          onClose={() => setSharing(false)}
        />
      )}

      {ai?.state === 'writing' && (
        <p className="text-[12.5px] text-[var(--color-accent)]">
          ✍ AI đang viết tiếp{ai.by ? ` (${ai.by} yêu cầu)` : ''}…
        </p>
      )}
      {ai?.state === 'failed' && (
        <p className="text-[12.5px] text-[var(--color-accent)]">
          AI dừng giữa chừng: {ai.message}
        </p>
      )}

      {provider ? (
        <RoomEditor
          provider={provider}
          doc={doc}
          handle={me.handle}
          canEdit={canEdit}
        />
      ) : (
        <p className="min-h-[42vh] text-[13px] text-[var(--color-muted)]">
          Đang mở tài liệu…
        </p>
      )}

      {!canEdit && (
        <p className="text-[12px] text-[var(--color-muted)]">
          Bạn đang xem. Chỉ người được mời mới viết được.
        </p>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2.5 border-t border-[var(--color-line)] pt-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={runAi}
              disabled={busy !== null}
              className="btn btn-ghost btn-sm"
            >
              <span aria-hidden>✍</span>
              {busy === 'ai' ? 'AI đang viết…' : 'Để AI viết tiếp'}
            </button>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tên chương (tuỳ chọn)"
              className="field min-w-0 flex-1 py-1.5 text-[13.5px]"
            />

            <button
              onClick={commit}
              disabled={busy !== null || !words}
              className="btn btn-primary btn-sm"
            >
              {busy === 'commit'
                ? 'Đang đăng…'
                : guest
                  ? 'Đăng vào nhánh của tôi'
                  : 'Đăng chương này'}
            </button>
          </div>

          {/* Said before the button is pressed, not after: where a chapter is
              going to end up is part of deciding whether to publish it. */}
          {guest && room && (
            <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
              Chương bạn đăng sẽ thành <span className="text-[var(--color-ink)]">một nhánh riêng mang tên @{me.handle}</span>,
              tách ra từ đây. Truyện của @{room.owner.handle} không thay đổi.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-[12.5px] text-[var(--color-accent)]">
          {error}
        </p>
      )}

      {/* invitations */}
      {room && (
        <details className="border-t border-[var(--color-line)] pt-3">
          <summary className="cursor-pointer font-mono text-[12px] text-[var(--color-muted)]">
            Người viết chung ({room.collaborators.length + 1})
          </summary>

          <ul className="mt-3 flex flex-col gap-2">
            <li className="flex items-center gap-2 text-[13px]">
              <Dot handle={room.owner.handle} color={colorFor(room.owner.handle)} />
              <span>@{room.owner.handle}</span>
              <span className="font-mono text-[12px] text-[var(--color-muted)]">
                chủ nhánh
              </span>
            </li>
            {room.collaborators.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[13px]">
                <Dot handle={c.handle} color={colorFor(c.handle)} />
                <span>@{c.handle}</span>
                <span className="font-mono text-[12px] text-[var(--color-muted)]">
                  {c.role === 'VIEWER' ? 'chỉ xem' : 'viết được'}
                </span>
                {/* Owner-only, like the invite form below: the server refuses
                    anyone else, so a guest was offered controls that could
                    only fail. */}
                {!guest && (
                  <button onClick={() => revoke(c)} className="btn btn-quiet btn-sm ml-auto">
                    Gỡ
                  </button>
                )}
              </li>
            ))}
          </ul>

        </details>
      )}
    </div>
  );
}

function Dot({
  handle,
  color,
  self,
}: {
  handle: string;
  color: string;
  self?: boolean;
}) {
  return (
    <span
      title={self ? `${handle} (bạn)` : handle}
      className="grid h-6 w-6 flex-none place-items-center rounded-full font-mono text-[12px] font-medium text-white"
      style={{ background: color }}
    >
      {handle.slice(0, 2)}
    </span>
  );
}
