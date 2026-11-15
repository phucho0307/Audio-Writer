'use client';

import { Fragment, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Reveal from '@/app/Reveal';
import SpiritText from '@/app/SpiritText';
import RatingBadge from '@/app/Rating';
import { chapterRating, storyRating } from '@/lib/ratings';
import { BranchBanner, BranchLink, forksAt, readableForks } from '../Branches';
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
        api
          .voices()
          .then((v) => api.chapterAudio(branch.id, v.default))
          .then(setAudio)
          .catch(() => {});
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, wantedBranch]);

  if (error && !story) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
        <Link href="/kham-pha" className="btn btn-ghost mt-5">
          <span aria-hidden>←</span> Khám phá
        </Link>
      </main>
    );
  }

  if (!story || !read) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-14 sm:px-8">
        <div className="flex gap-6">
          <div className="skeleton h-[228px] w-[164px] flex-none" />
          <div className="flex flex-1 flex-col gap-3 pt-2">
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton mt-3 h-9 w-32" />
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-11 w-full" />
          ))}
        </div>
      </main>
    );
  }

  const q = wantedBranch ? `?branch=${wantedBranch}` : '';
  const narrated = new Map(audio.filter((a) => a.url).map((a) => [a.depth, a]));
  const locked = read.access.lockedCount;
  // The branch being read, as the story lists it - which is where its author
  // and fork point live.
  const current = story.branches.find((b) => b.id === read.branch.id);
  const others = readableForks(story).filter((b) => b.id !== read.branch.id);
  const minutes = Math.round(
    audio.reduce((n, a) => n + (a.durationMs ?? 0), 0) / 1000 / 1.5 / 60,
  );

  return (
    <>
      {/* The cover, enlarged past legibility and pinned behind the header, so
          the top of the page is lit by the story's own artwork. It stops at
          the contents list, which is a tool and wants a plain ground. */}
      {story.coverUrl && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[460px] overflow-hidden">
          <div
            className="h-full w-full scale-125 bg-cover bg-center opacity-30 blur-3xl"
            style={{ backgroundImage: `url(${story.coverUrl})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[color-mix(in_oklab,var(--color-ground)_55%,transparent)] to-[var(--color-ground)]" />
        </div>
      )}

      <main className="relative mx-auto flex max-w-3xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-10">
        <Link
          href="/kham-pha"
          className="text-[12.5px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
        >
          <span aria-hidden>←</span> Khám phá
        </Link>

        {current && <BranchBanner story={story} branch={current} />}

        <Reveal as="header" className="flex flex-col gap-6 sm:flex-row sm:gap-7">
          <div className="cover aspect-[3/4] w-[150px] flex-none self-start sm:w-[176px]">
            {story.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={story.coverUrl} alt="" />
            )}
          </div>

          <div className="flex flex-col items-start gap-3.5">
            {story.genres.length > 0 && (
              <span className="label label-accent">
                {story.genres.join(' · ')}
              </span>
            )}

            <SpiritText
              text={story.title}
              delay={0.1}
              className="display text-[2.1rem] leading-[1.06] sm:text-[2.5rem]"
            />

            <RatingBadge rating={storyRating(story.id)} variant="full" />

            <p className="max-w-[52ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
              {story.synopsis}
            </p>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[var(--color-faint)]">
              <span>{story.contributionCount} chương</span>
              <Sep />
              <span>{story.wordCount.toLocaleString('vi-VN')} từ</span>
              {minutes > 0 && (
                <>
                  <Sep />
                  <span>~{minutes} phút nghe</span>
                </>
              )}
              <Sep />
              <span>{story.viewCount.toLocaleString('vi-VN')} lượt xem</span>
              {story.owner && (
                <>
                  <Sep />
                  <span className="text-[var(--color-muted)]">
                    @{story.owner.handle}
                  </span>
                </>
              )}
            </div>

            <Link
              href={`/doc/${id}/1${q}`}
              className="btn btn-primary btn-lg mt-1"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
              Đọc từ đầu
            </Link>
          </div>
        </Reveal>

        <section className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-2.5">
            <h2 className="label">Mục lục</h2>
            <span className="text-[11.5px] text-[var(--color-faint)]">
              {read.contributions.length} chương
              {locked > 0 && ` · ${locked} khoá`}
            </span>
          </div>

          <ol className="flex flex-col">
            {read.contributions.map((c) => {
              const clip = narrated.get(c.depth);
              const split = forksAt(story, read.branch.id, c.depth);
              return (
                <Fragment key={c.id}>
                <li>
                  <Link
                    href={`/doc/${id}/${c.depth + 1}${q}`}
                    className="group flex items-baseline gap-4 border-b border-[var(--color-line)] px-2 py-3 transition-colors hover:bg-[var(--color-surface)]"
                  >
                    <span className="w-6 flex-none text-right text-[12.5px] tabular-nums text-[var(--color-faint)] transition-colors group-hover:text-[var(--color-accent)]">
                      {c.depth + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                      {c.title ?? c.textPlain.split('\n')[0].slice(0, 60)}
                    </span>

                    <RatingBadge
                      rating={chapterRating(story.id, c.id, c.depth)}
                      className="flex-none text-[11.5px]"
                    />

                    {/* A narrated chapter says so with its running time - the
                        one fact that tells a listener whether they have time
                        for it before bed. */}
                    {/* The slot is kept when a chapter has no audio yet, so the
                        ratings to its left stay in one column. */}
                    {clip ? (
                      <span className="flex w-[46px] flex-none items-center justify-end gap-1.5 text-[11.5px] tabular-nums text-[var(--color-muted)]">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                        </svg>
                        {mmss(clip.durationMs)}
                      </span>
                    ) : (
                      <span className="w-[46px] flex-none" aria-hidden />
                    )}
                    <span className="hidden w-16 flex-none text-right text-[11.5px] tabular-nums text-[var(--color-faint)] sm:block">
                      {c.wordCount} từ
                    </span>
                  </Link>
                </li>
                {/* The story splits here: the other ways it goes on after
                    this chapter, each tagged with whoever wrote it. */}
                {split.length > 0 && (
                  <li className="flex flex-col gap-2 border-b border-[var(--color-line)] py-3 pl-12 pr-2">
                    <span className="label label-accent">
                      ⑂ {split.length} hướng khác rẽ từ chương {c.depth + 1}
                    </span>
                    {split.map((b) => (
                      <BranchLink key={b.id} story={story} branch={b} compact />
                    ))}
                  </li>
                )}
                </Fragment>
              );
            })}

            {locked > 0 && (
              <li className="flex items-center gap-4 border-b border-[var(--color-line)] px-2 py-4">
                <span
                  className="w-6 flex-none text-center text-[var(--color-faint)]"
                  aria-hidden
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mx-auto">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                  </svg>
                </span>
                <span className="flex-1 text-[14px] text-[var(--color-muted)]">
                  Còn {locked} chương — mở khoá {read.access.unlockPrice} credit
                </span>
              </li>
            )}
          </ol>
        </section>

        {/* Every version of the story in one place, including ones that split
            from another branch rather than from the chapters above. */}
        {others.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-2.5">
              <h2 className="label">Các hướng khác của truyện</h2>
              <span className="text-[11.5px] text-[var(--color-faint)]">
                {others.length} nhánh
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {others.map((b) => (
                <BranchLink key={b.id} story={story} branch={b} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-[var(--color-line-strong)]">
      ·
    </span>
  );
}
