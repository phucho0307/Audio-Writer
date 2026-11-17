'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import CoverThumb, { thumbUrl } from '../CoverThumb';
import RatingBadge from '../Rating';
import type { Rating } from '@/lib/ratings';

const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';

/**
 * One card for every shelf.
 *
 * Stories written here, Chinese novels and famous authors' works used to be
 * three different cards - one said "8 chương", one "Đọc & nghe", one "12
 * phần đọc · Mê Truyện" - so a row of covers read as three products. They
 * are one thing to a reader: a story, its length, who wrote it, how it is
 * rated. Same slots, same order, everywhere.
 */
export default function ShelfCard({
  href,
  external = false,
  title,
  coverUrl,
  coverLabel,
  chapters,
  badge,
  synopsis,
  genres,
  author,
  rating,
  frame = false,
}: {
  href: string;
  /** Opens another site (an official YouTube upload). */
  external?: boolean;
  title: string;
  coverUrl: string | null;
  /** Shown on the cover when the image is missing: who or what it is. */
  coverLabel: string;
  /** Null for something that is not in chapters (a single video). */
  chapters: number | null;
  /** Extra mark on the cover, e.g. how many branches. */
  badge?: ReactNode;
  synopsis?: string | null;
  genres: string[];
  author: ReactNode;
  rating: Rating | null;
  /** A non-portrait image (a video still), letterboxed over a blurred copy. */
  frame?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // Imported synopses often open by repeating the title; the card shows it already.
  const blurb =
    synopsis && synopsis.toLowerCase().startsWith(title.toLowerCase())
      ? synopsis.slice(title.length).replace(/^[\s:.,–—-]+/, '')
      : synopsis;

  return (
    <Link
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group flex flex-col gap-3"
    >
      <div className="cover aspect-[3/4]">
        {coverUrl && !failed ? (
          <>
            {frame && (
              <div
                aria-hidden
                className="absolute inset-0 scale-125 bg-cover bg-center opacity-35 blur-xl"
                style={{ backgroundImage: `url(${thumbUrl(coverUrl)})` }}
              />
            )}
            <CoverThumb
              src={coverUrl}
              alt=""
              onFail={() => setFailed(true)}
              className={frame ? 'relative !object-contain' : ''}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-[var(--color-accent-soft)] px-5">
            <span className="label text-[var(--color-accent)]">{coverLabel}</span>
            <span className="display text-xl leading-tight sm:text-2xl">{title}</span>
          </div>
        )}
        <span className="scrim label flex items-center gap-2 text-white/85">
          {chapters !== null ? `${chapters} chương` : 'Video · YouTube'}
          {badge}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        {/* Two lines, held at two lines' height, so a row of cards stays in line. */}
        <h3 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">
          {title}
        </h3>
        <p className="line-clamp-2 min-h-[2.9em] text-[13px] leading-relaxed text-[var(--color-muted)]">{blurb}</p>
        <p className="truncate text-[11.5px] text-[var(--color-faint)]">{genres.join(' · ')}</p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--color-line)] pt-2 text-[12px]">
          <span className="min-w-0 truncate text-[var(--color-muted)]">{author}</span>
          {rating ? (
            <RatingBadge rating={rating} className="flex-none text-[12px]" />
          ) : (
            // The slot stays, so cards line up; it says plainly there is no score yet.
            <span className="flex flex-none items-center gap-1 text-[11.5px] text-[var(--color-faint)]" title="Chưa đủ lượt đánh giá">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d={STAR} />
              </svg>
              Chưa có
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
