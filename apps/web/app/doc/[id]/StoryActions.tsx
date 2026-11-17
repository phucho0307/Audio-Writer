'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type FollowState } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { followsChanged } from '@/lib/follows';
import { useAuth } from '@/lib/useAuth';

/**
 * Follow and share, beside the story's main button.
 *
 * Following is how a reader hears about new chapters: the bell in the header
 * lights when a followed story has grown. Opening the story counts as having
 * seen what is there, which is what clears it.
 */
export default function StoryActions({ storyId, title }: { storyId: string; title: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<FollowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Pressed while signed out: followed once the reader has signed in. */
  const pending = useRef(false);

  useEffect(() => {
    let live = true;
    api
      .followState(storyId)
      .then((s) => {
        if (!live) return;
        setState(s);
        if (s.following) {
          // Looking at the story is seeing its new chapters.
          void api.followSeen(storyId).then(followsChanged).catch(() => {});
        } else if (pending.current && user) {
          pending.current = false;
          void toggle(s);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, user?.id]);

  async function toggle(current = state) {
    if (!current || busy) return;
    if (!user) {
      pending.current = true;
      signIn('Đăng nhập để theo dõi truyện và biết ngay khi có chương mới.');
      return;
    }
    setBusy(true);
    try {
      setState(current.following ? await api.unfollow(storyId) : await api.follow(storyId));
      followsChanged();
    } catch {
      // Left as it was; the button still says the truth.
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = window.location.origin + `/doc/${storyId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Dismissed the share sheet, or the clipboard is blocked: nothing to say.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state && (
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={state.following}
          title={state.following ? 'Bấm để bỏ theo dõi' : 'Nhận báo khi có chương mới'}
          className={`btn btn-ghost ${state.following ? 'border-[var(--color-accent-line)] text-[var(--color-accent)]' : ''}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={state.following ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
            <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
          </svg>
          {state.following ? 'Đang theo dõi' : 'Theo dõi'}
          {state.followers > 0 && (
            <span className="text-[11.5px] tabular-nums opacity-70">{state.followers.toLocaleString('vi-VN')}</span>
          )}
        </button>
      )}
      <button type="button" onClick={() => void share()} className="btn btn-ghost">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
        <span role="status">{copied ? 'Đã chép liên kết' : 'Chia sẻ'}</span>
      </button>
    </div>
  );
}
