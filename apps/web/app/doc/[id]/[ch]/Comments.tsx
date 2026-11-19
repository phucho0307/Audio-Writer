'use client';

import PremiumBadge from '@/app/PremiumBadge';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type ChapterComment } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

const MAX = 1000;

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** "3 phút trước", "hôm qua", then a plain date once it stops being recent. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.round(s / 3600)} giờ trước`;
  if (s < 2 * 86_400) return 'hôm qua';
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

/**
 * What readers said about this chapter.
 *
 * Under the way on to the next chapter, not above it: someone who has just
 * finished reading wants either to go on or to talk, and going on is the
 * commoner of the two. Flat and newest-first - a chapter's comments are a
 * room people pass through, not a forum.
 */
export default function Comments({ chapterId }: { chapterId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<ChapterComment[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The comment whose "Xoá" was pressed once and is waiting for the second press. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Typed while signed out: sent once the reader has signed in. */
  const pending = useRef(false);

  // Reloaded on sign-in too: who may delete what depends on who is asking.
  useEffect(() => {
    let live = true;
    setItems(null);
    api
      .comments(chapterId)
      .then((p) => {
        if (!live) return;
        setItems(p.items);
        setTotal(p.total);
        setCursor(p.nextCursor);
      })
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [chapterId, user?.id]);

  useEffect(() => {
    if (user && pending.current) {
      pending.current = false;
      void send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    if (!user) {
      pending.current = true;
      signIn('Đăng nhập để bình luận. Những gì bạn vừa gõ vẫn được giữ lại.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.addComment(chapterId, body);
      setItems((cur) => [created, ...(cur ?? [])]);
      setTotal((n) => n + 1);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    try {
      await api.deleteComment(id);
      setItems((cur) => (cur ?? []).filter((c) => c.id !== id));
      setTotal((n) => Math.max(0, n - 1));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadMore() {
    if (!cursor || more) return;
    setMore(true);
    try {
      const p = await api.comments(chapterId, cursor);
      setItems((cur) => [...(cur ?? []), ...p.items]);
      setCursor(p.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMore(false);
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="comments-title">
      <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-2.5">
        <h2 id="comments-title" className="label">
          Bình luận
        </h2>
        <span className="text-[11.5px] tabular-nums text-[var(--color-faint)]">
          {total > 0 ? `${total.toLocaleString('vi-VN')} bình luận` : 'Chưa có bình luận'}
        </span>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="comment-box">
          Viết bình luận
        </label>
        <textarea
          id="comment-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
          }}
          maxLength={MAX}
          rows={3}
          placeholder="Chương này làm bạn nghĩ gì?"
          className="field min-h-[84px] resize-y leading-relaxed"
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || text.trim().length === 0} className="btn btn-primary btn-sm">
            {busy ? 'Đang gửi…' : user ? 'Gửi bình luận' : 'Đăng nhập để gửi'}
          </button>
          {text.length > MAX - 200 && (
            <span className="text-[11.5px] tabular-nums text-[var(--color-faint)]">
              {text.length}/{MAX}
            </span>
          )}
          <span className="ml-auto hidden text-[11px] text-[var(--color-faint)] sm:inline">Ctrl + Enter để gửi</span>
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-[var(--color-son)]">
            {error}
          </p>
        )}
      </form>

      {items === null ? (
        <div className="flex flex-col gap-3" aria-busy>
          <div className="skeleton h-14 w-full" />
          <div className="skeleton h-14 w-4/5" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-[13.5px] text-[var(--color-muted)]">Hãy là người đầu tiên nói về chương này.</p>
      ) : (
        <ol className="flex flex-col gap-5">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3">
              {c.author.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.author.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 flex-none rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[10.5px] font-semibold text-[var(--color-accent)]"
                >
                  {initials(c.author.displayName)}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <Link href={`/u/${c.author.handle}`} className="text-[13px] font-medium hover:text-[var(--color-accent)]">
                    {c.author.displayName}
                  </Link>
                  {c.author.premium && <PremiumBadge />}
                  <time dateTime={c.createdAt} className="text-[var(--color-faint)]">
                    {ago(c.createdAt)}
                  </time>
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(c.id)}
                      onBlur={() => setConfirming((cur) => (cur === c.id ? null : cur))}
                      className={`ml-auto text-[11.5px] ${
                        confirming === c.id
                          ? 'font-medium text-[var(--color-son)]'
                          : 'text-[var(--color-faint)] hover:text-[var(--color-son)]'
                      }`}
                    >
                      {confirming === c.id ? 'Bấm lần nữa để xoá' : 'Xoá'}
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {cursor && (
        <button type="button" onClick={() => void loadMore()} disabled={more} className="btn btn-ghost btn-sm self-start">
          {more ? 'Đang tải…' : 'Xem bình luận cũ hơn'}
        </button>
      )}
    </section>
  );
}
