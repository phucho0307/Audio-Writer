'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type FollowedStory } from '@/lib/api';
import { onFollowsChanged } from '@/lib/follows';
import { thumbUrl } from '@/lib/thumb';
import { useAuth } from '@/lib/useAuth';

/** Checked when the tab comes back into view, and no more often than this. */
const RECHECK_MS = 5 * 60_000;

/**
 * The bell: followed stories, with a dot when one has new chapters.
 *
 * Asked for, not pushed. The list is a comparison the server makes on
 * request (chapter count against what was seen), so there is nothing to
 * deliver and nothing to miss; it is refreshed when the reader comes back
 * to the tab, which is when they would look.
 */
export default function FollowBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<FollowedStory[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  const load = useCallback(() => {
    last.current = Date.now();
    api.myFollows().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setItems(null);
      return;
    }
    load();
    const off = onFollowsChanged(load);
    const onShow = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current > RECHECK_MS) load();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [user, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!user || items === null) return null;
  const fresh = items.filter((f) => f.newChapters > 0);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={fresh.length ? `Truyện theo dõi, ${fresh.length} truyện có chương mới` : 'Truyện theo dõi'}
        title="Truyện theo dõi"
        className="relative grid h-8 w-8 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {fresh.length > 0 && (
          <span className="absolute right-0.5 top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9.5px] font-semibold tabular-nums text-[var(--color-on-accent)]">
            {fresh.length > 9 ? '9+' : fresh.length}
          </span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden shadow-[0_18px_40px_-12px_rgb(0_0_0/0.6)]">
          <div className="border-b border-[var(--color-line)] px-3.5 py-2.5 text-[12.5px] font-medium">Truyện theo dõi</div>
          {items.length === 0 ? (
            <p className="px-3.5 py-4 text-[13px] leading-relaxed text-[var(--color-muted)]">
              Bấm <strong>Theo dõi</strong> ở trang một truyện để biết ngay khi truyện có chương mới.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.slice(0, 30).map((f) => (
                <li key={f.storyId}>
                  <Link
                    href={f.newChapters > 0 ? `/doc/${f.storyId}/${f.firstNew}` : `/doc/${f.storyId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--color-raised)]"
                  >
                    <span className="cover h-[46px] w-[34px] flex-none">
                      {f.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(f.coverUrl)} alt="" loading="lazy" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px]">{f.title}</span>
                      <span className={`text-[11.5px] ${f.newChapters > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-faint)]'}`}>
                        {f.newChapters > 0 ? `${f.newChapters} chương mới · đọc từ chương ${f.firstNew}` : `${f.totalChapters} chương`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
