'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  mainBranch,
  api,
  type BranchRead,
  type ChapterAudio,
  type Story,
} from '@/lib/api';

function mmss(ms: number | null): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000 / 1.5); // shown at the default 1.5x
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Contents.
 *
 * A thumbnail used to drop straight into chapter one, which is wrong for
 * anyone returning to a story - they are eight chapters in and want to get
 * back to where they stopped. The list is the landing page; chapter one is one
 * click away for newcomers.
 */
export default function Contents({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const wantedBranch = useSearchParams().get('branch');

  const [story, setStory] = useState<Story | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);
  const [audio, setAudio] = useState<ChapterAudio[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStory(id);
        setStory(s);
        const branch =
          (wantedBranch && s.branches.find((b) => b.id === wantedBranch)) ||
          mainBranch(s);
        if (!branch) return;
        const r = await api.readBranch(branch.id);
        setRead(r);
        api.chapterAudio(branch.id, 'Kore').then(setAudio).catch(() => {});
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, wantedBranch]);

  if (error && !story) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href="/kham-pha" className="mt-4 inline-block text-sm underline">
          ← Khám phá
        </Link>
      </main>
    );
  }

  if (!story || !read) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-sm text-[var(--color-muted)]">Đang tải…</p>
      </main>
    );
  }

  const q = wantedBranch ? `?branch=${wantedBranch}` : '';
  const narrated = new Map(audio.filter((a) => a.url).map((a) => [a.depth, a]));
  const locked = read.access.lockedCount;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-9 px-6 py-10">
      <Link
        href="/kham-pha"
        className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
      >
        ← khám phá
      </Link>

      <header className="flex flex-col gap-5 sm:flex-row sm:gap-6">
        {story.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.coverUrl}
            alt=""
            className="h-[228px] w-[164px] flex-none self-start rounded-md object-cover"
          />
        )}
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-[2rem] leading-[1.12] tracking-tight">
            {story.title}
          </h1>
          <p className="max-w-[52ch] text-[14.5px] leading-relaxed text-[var(--color-muted)]">
            {story.synopsis}
          </p>
          <p className="font-mono text-[11px] text-[var(--color-muted)]">
            {story.genres.join(' · ')}
          </p>
          <p className="font-mono text-[11px] text-[var(--color-muted)] opacity-70">
            {story.contributionCount} chương · {story.wordCount} từ ·{' '}
            {story.viewCount} lượt xem
            {story.owner && ` · @${story.owner.handle}`}
          </p>

          <Link
            href={`/doc/${id}/1${q}`}
            className="mt-1 self-start rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Đọc từ đầu
          </Link>
        </div>
      </header>

      <section className="flex flex-col">
        <h2 className="border-b border-[var(--color-line)] pb-2 font-mono text-[11px] uppercase tracking-widest text-[var(--color-muted)]">
          Mục lục
        </h2>

        <ol className="flex flex-col">
          {read.contributions.map((c) => {
            const clip = narrated.get(c.depth);
            return (
              <li key={c.id}>
                <Link
                  href={`/doc/${id}/${c.depth + 1}${q}`}
                  className="group flex items-baseline gap-4 border-b border-[var(--color-line)] py-3 transition-colors"
                >
                  <span className="w-7 flex-none font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
                    {c.depth + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] transition-colors group-hover:text-[var(--color-accent)]">
                    {c.title ?? c.textPlain.split('\n')[0].slice(0, 60)}
                  </span>
                  <span className="flex flex-none items-baseline gap-3 font-mono text-[10.5px] text-[var(--color-muted)]">
                    {clip && <span>♪ {mmss(clip.durationMs)}</span>}
                    <span className="opacity-60">{c.wordCount} từ</span>
                  </span>
                </Link>
              </li>
            );
          })}

          {locked > 0 && (
            <li className="flex items-baseline gap-4 border-b border-[var(--color-line)] py-3 opacity-50">
              <span className="w-7 flex-none font-mono text-[12px] text-[var(--color-muted)]">
                🔒
              </span>
              <span className="flex-1 text-[15px] text-[var(--color-muted)]">
                Còn {locked} chương — mở khoá {read.access.unlockPrice} credit
              </span>
            </li>
          )}
        </ol>
      </section>
    </main>
  );
}
