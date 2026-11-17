'use client';

import Link from 'next/link';
import { forgetProgress, resumeHref, useProgress } from '@/lib/progress';
import { thumbUrl } from '@/lib/thumb';

function mmss(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * "Đang nghe dở": the stories this reader is part-way through, newest first.
 *
 * Top of Khám phá, because a returning listener's first question is "where
 * was I", not "what is new". Each one goes straight back to the chapter and
 * second where they stopped. Hidden until there is something to show.
 */
export default function ContinueShelf() {
  const items = useProgress().slice(0, 12);
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="continue-title">
      <div className="flex items-baseline justify-between">
        <h2 id="continue-title" className="label label-accent">
          Đang nghe dở
        </h2>
        <span className="text-[11.5px] text-[var(--color-faint)]">{items.length} truyện</span>
      </div>
      <ul className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((p) => {
          const pct = p.totalChapters > 0 ? Math.min(100, ((p.chapter - 1) / p.totalChapters) * 100) : 0;
          return (
            <li key={p.storyId} className="group relative w-[230px] flex-none snap-start">
              <Link
                href={resumeHref(p)}
                className="flex h-full gap-3 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 pr-7 transition-colors hover:border-[var(--color-accent-line)]"
              >
                <span className="cover h-[76px] w-[56px] flex-none">
                  {p.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(p.coverUrl)} alt="" loading="lazy" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="line-clamp-2 font-serif text-[14px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                    {p.title}
                  </span>
                  <span className="text-[11.5px] text-[var(--color-muted)]">
                    Chương {p.chapter}
                    {p.totalChapters ? `/${p.totalChapters}` : ''}
                    {p.at > 0 ? ` · ${mmss(p.at)}` : ''}
                  </span>
                  <span className="mt-auto h-[3px] overflow-hidden rounded-full bg-[var(--color-line)]" aria-hidden>
                    <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => forgetProgress(p.storyId)}
                aria-label={`Bỏ "${p.title}" khỏi danh sách đang nghe`}
                title="Bỏ khỏi danh sách"
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-[12px] text-[var(--color-faint)] opacity-60 transition-opacity hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)] hover:opacity-100 focus-visible:opacity-100"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
