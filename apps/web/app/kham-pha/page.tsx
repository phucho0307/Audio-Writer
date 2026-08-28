'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Story } from '@/lib/api';

/**
 * The library.
 *
 * Reading is the only call to action here. Forking is offered at the end of a
 * chapter instead - by then the reader has an opinion about where the story
 * should have gone, which is the moment the offer means something. On a
 * thumbnail it was only a second button competing with the first.
 */
export default function Explore() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);

  useEffect(() => {
    api
      .listStories()
      .then((all) => setStories(all.filter((s) => s.contributionCount > 0)))
      .catch((e: Error) => setError(e.message));
  }, []);

  // Derived from the content, so the filter never offers an empty genre or
  // omits one a writer has just used. Multi-genre stories count under each.
  const counts = new Map<string, number>();
  for (const s of stories ?? []) {
    for (const g of s.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const genres = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'),
  );

  const shown = (stories ?? []).filter(
    (s) => genre === null || s.genres.includes(genre),
  );

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex max-w-[52ch] flex-col gap-3">
        <h1 className="font-serif text-[2.5rem] leading-[1.08] tracking-tight">
          Đọc, rồi viết tiếp theo cách của bạn.
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
          Mỗi truyện đều có thể rẽ nhánh từ bất kỳ chương nào. Bản gốc giữ
          nguyên, nhánh của bạn là của bạn.
        </p>
      </header>

      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* A row of labels rather than a toolbar of pills - the covers below are
          already carrying plenty of colour. */}
      {stories && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[var(--color-line)] py-3">
          <button
            onClick={() => setGenre(null)}
            aria-pressed={genre === null}
            className={`text-[13px] transition-colors ${
              genre === null
                ? 'font-medium text-[var(--color-ink)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            Tất cả
          </button>
          {genres.map(([g, n]) => (
            <button
              key={g}
              onClick={() => setGenre(genre === g ? null : g)}
              aria-pressed={genre === g}
              className={`text-[13px] transition-colors ${
                genre === g
                  ? 'font-medium text-[var(--color-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {g}
              <span className="ml-1 font-mono text-[10px] opacity-50">{n}</span>
            </button>
          ))}
        </div>
      )}

      {!stories && <p className="text-sm text-[var(--color-muted)]">Đang tải…</p>}

      <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((s) => (
          <Link
            key={s.id}
            href={`/doc/${s.id}`}
            className="group flex flex-col gap-3"
          >
            <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-[var(--color-surface)]">
              {s.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.coverUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-10 font-mono text-[10px] text-white/80">
                {s.contributionCount} chương
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <h2 className="font-serif text-[17px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                {s.title}
              </h2>
              <p className="line-clamp-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
                {s.synopsis}
              </p>
              <p className="font-mono text-[10.5px] text-[var(--color-muted)] opacity-70">
                {s.genres.join(' · ')}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {stories && shown.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">
          {genre
            ? `Chưa có truyện nào thuộc thể loại "${genre}".`
            : 'Chưa có truyện nào.'}
        </p>
      )}
    </main>
  );
}
