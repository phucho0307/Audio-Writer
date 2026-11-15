'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type Story } from '@/lib/api';
import Reveal from '../Reveal';
import SpiritText from '../SpiritText';
import Tilt, { Sheen } from '../Tilt';
import { calm, gsap, useGSAP } from '@/lib/motion';

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

  // The most-read story leads the page, and only while nothing is filtered -
  // under a genre the grid is the answer to the question that was asked, and
  // a hero would just be one of its own results, repeated at four times the
  // size.
  const featured =
    genre === null && stories && stories.length > 2
      ? [...stories].sort((a, b) => b.viewCount - a.viewCount)[0]
      : null;
  const grid = featured ? shown.filter((s) => s.id !== featured.id) : shown;

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-12 px-5 py-10 sm:px-8 sm:py-14">
      {error && (
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
      )}

      {featured && <Featured story={featured} />}

      {!featured && (
        <Reveal as="header" className="flex max-w-[48ch] flex-col gap-3">
          <SpiritText
            text="Đọc, rồi viết tiếp theo cách của bạn."
            className="display text-[2.4rem] leading-[1.05] sm:text-[2.9rem]"
          />
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            Mỗi truyện đều có thể rẽ nhánh từ bất kỳ chương nào. Bản gốc giữ
            nguyên, nhánh của bạn là của bạn.
          </p>
        </Reveal>
      )}

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="label">
            {genre ? `Thể loại · ${genre}` : 'Tất cả truyện'}
          </h2>
          {stories && (
            <span className="text-[12.5px] text-[var(--color-faint)]">
              {shown.length} truyện
            </span>
          )}
        </div>

        {/* Scrollable on a phone rather than wrapped to four lines, which
            pushed the covers below the fold before anyone had chosen
            anything. */}
        {stories && genres.length > 0 && (
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setGenre(null)}
              aria-pressed={genre === null}
              className={`chip ${genre === null ? 'chip-on' : ''}`}
            >
              Tất cả
            </button>
            {genres.map(([g, n]) => (
              <button
                key={g}
                onClick={() => setGenre(genre === g ? null : g)}
                aria-pressed={genre === g}
                className={`chip ${genre === g ? 'chip-on' : ''}`}
              >
                {g}
                <span className="text-[10.5px] opacity-55">{n}</span>
              </button>
            ))}
          </div>
        )}

        {!stories && <CoverSkeletons />}

        <Reveal
          childrenStagger
          stagger={0.05}
          deps={[grid.length, genre]}
          className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4"
        >
          {grid.map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </Reveal>

        {stories && shown.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">
            {genre
              ? `Chưa có truyện nào thuộc thể loại "${genre}".`
              : 'Chưa có truyện nào.'}
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * The lead story.
 *
 * Its own cover is the background, blurred past the point of being an image
 * and used as a wash of the story's own colour - which means the page is
 * tinted by whatever is being featured rather than by a fixed brand gradient,
 * and a new cover redecorates it for free.
 */
function Featured({ story }: { story: Story }) {
  const backdrop = useRef<HTMLDivElement>(null);

  /**
   * The wash drifts against the scroll.
   *
   * `scrub` rather than `toggleActions`, because this is a position tied to
   * the scrollbar rather than something that plays - and `ease: 'none'`, since
   * any other easing makes the backdrop lag the page in a way that reads as
   * jank rather than as depth. Only the blurred copy moves; nothing anyone is
   * reading does.
   */
  useGSAP(
    () => {
      const el = backdrop.current;
      if (!el?.parentElement || calm()) return;
      gsap.to(el, {
        yPercent: 10,
        ease: 'none',
        scrollTrigger: {
          trigger: el.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      });
    },
    { scope: backdrop, dependencies: [story.id], revertOnUpdate: true },
  );

  return (
    <Reveal
      as="section"
      blur={false}
      className="relative overflow-hidden rounded-[8px] border border-[var(--color-line)]"
    >
      {story.coverUrl && (
        <div
          ref={backdrop}
          aria-hidden
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-35 blur-3xl"
          style={{ backgroundImage: `url(${story.coverUrl})` }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[var(--color-ground)] via-[color-mix(in_oklab,var(--color-ground)_78%,transparent)] to-[color-mix(in_oklab,var(--color-ground)_55%,transparent)]"
      />

      <div className="relative flex flex-col gap-7 p-6 sm:flex-row sm:items-center sm:gap-9 sm:p-9">
        <Tilt className="w-[150px] flex-none sm:w-[196px]">
          <Link href={`/doc/${story.id}`} className="group block">
            <div className="cover aspect-[3/4]">
              {story.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={story.coverUrl} alt="" />
              )}
              <Sheen />
            </div>
          </Link>
        </Tilt>

        <div className="flex min-w-0 flex-col items-start gap-4">
          <span className="label label-accent flex items-center gap-2">
            <span className="dot dot-on" aria-hidden />
            Được nghe nhiều nhất
          </span>

          <Link href={`/doc/${story.id}`}>
            <SpiritText
              key={story.id}
              text={story.title}
              delay={0.15}
              className="display text-[2.1rem] leading-[1.04] sm:text-[2.75rem]"
            />
          </Link>

          {story.synopsis && (
            <p className="max-w-[54ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
              {story.synopsis}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-[var(--color-faint)]">
            <span>{story.contributionCount} chương</span>
            <Dot />
            <span>{story.wordCount.toLocaleString('vi-VN')} từ</span>
            {story.branchCount > 1 && (
              <>
                <Dot />
                <span className="text-[var(--color-accent)]">
                  ⑂ {story.branchCount - 1} nhánh rẽ
                </span>
              </>
            )}
            {story.genres.length > 0 && (
              <>
                <Dot />
                <span className="text-[var(--color-muted)]">
                  {story.genres.join(' · ')}
                </span>
              </>
            )}
          </div>

          <Link href={`/doc/${story.id}`} className="btn btn-primary btn-lg">
            Đọc & nghe
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

function StoryCard({ story: s }: { story: Story }) {
  return (
    <Link href={`/doc/${s.id}`} className="group flex flex-col gap-3">
      <div className="cover aspect-[3/4]">
        {s.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.coverUrl} alt="" />
        )}
        <span className="scrim label flex items-center gap-2 text-white/85">
          {s.contributionCount} chương
          {/* `branchCount` includes the story itself, so the forks are one
              fewer. Shown on the cover because it is the one thing that sets
              a story here apart from the same story anywhere else: other
              people have taken it somewhere. */}
          {s.branchCount > 1 && (
            <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-px text-[9.5px] text-[var(--color-on-accent)]">
              ⑂ {s.branchCount - 1} nhánh
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Clamped to two lines and held at two lines' height. A title that
            wraps where its neighbour does not pushes everything below it out
            of line, and a grid out of line reads as broken rather than as
            varied. */}
        <h3 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">
          {s.title}
        </h3>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
          {s.synopsis}
        </p>
        <p className="text-[11.5px] text-[var(--color-faint)]">
          {s.genres.join(' · ')}
        </p>
      </div>
    </Link>
  );
}

/** Shaped like the grid it replaces, so the page does not jump when it lands. */
function CoverSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="skeleton aspect-[3/4]" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-[var(--color-line-strong)]">
      ·
    </span>
  );
}
