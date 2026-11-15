'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { mainBranch, api, type BranchRead, type Story } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { signIn } from '@/lib/auth';
import ChapterNarration from './ChapterNarration';
import RichText from '@/app/RichText';
import { docOf } from '@/lib/prose';
import { BranchBanner, BranchLink, forksAt } from '../../Branches';

/**
 * How far through the chapter the reader is.
 *
 * A chapter is one long column with no landmarks, so there is nothing to tell
 * you whether the next scroll ends it or whether there are five more screens.
 * One hairline across the top answers that without taking any room.
 */
function ReadingProgress({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = target.current;
      if (!el) return;
      const start = el.offsetTop;
      // The last screenful is not scrollable, so it is taken off the distance;
      // otherwise the bar stops short of full at the end of every chapter.
      const span = el.offsetHeight - window.innerHeight * 0.65;
      if (span <= 0) return setPct(100);
      const done = ((window.scrollY - start) / span) * 100;
      setPct(Math.max(0, Math.min(100, done)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [target]);

  return (
    <div
      className="fixed inset-x-0 top-[56px] z-40 h-[2px]"
      role="progressbar"
      aria-label="Tiến độ đọc"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-[var(--color-accent)] transition-[width] duration-150 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The reading view.
 *
 * Separate from the story page on purpose: that screen is a workbench, with a
 * composer, an AI panel and branch controls. Someone who came to read wants
 * the text, a way to hear it, and a way to reach the next chapter.
 *
 * The one product surface that belongs here is the invitation to fork - the
 * end of a chapter is when a reader is most likely to have an opinion about
 * where the story should have gone.
 */
export default function Reader({
  params,
}: {
  params: Promise<{ id: string; ch: string }>;
}) {
  const { user, ready } = useAuth();
  const { id, ch } = use(params);
  const wantedBranch = useSearchParams().get('branch');

  // Chapters are 1-based in the URL; depth is 0-based in the data.
  const depth = Math.max(0, Number(ch) - 1);

  const [story, setStory] = useState<Story | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const article = useRef<HTMLElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStory(id);
        setStory(s);
        const branch =
          (wantedBranch && s.branches.find((b) => b.id === wantedBranch)) ||
          mainBranch(s);
        if (branch) setRead(await api.readBranch(branch.id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id, wantedBranch]);

  useEffect(() => {
    if (story) api.recordView(id).catch(() => {});
  }, [story, id]);

  /**
   * Fork here and go straight to writing.
   *
   * The reader is already standing on the chapter they want to diverge from,
   * so sending them to the chapter picker asks a question they have just
   * answered by scrolling to the bottom of this page.
   */
  function forkHere() {
    if (!read) return;
    setForking(true);
    // Nothing is created until the first chapter is saved.
    window.location.href = `/stories/${id}?forkFrom=${read.branch.id}&atDepth=${depth}`;
  }

  // Landing on a new chapter should start at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [depth]);

  if (error && !story) {
    return (
      <main className="mx-auto max-w-[42rem] px-5 py-14 sm:px-8">
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
        <Link href="/kham-pha" className="btn btn-ghost mt-5">
          <span aria-hidden>←</span> Khám phá
        </Link>
      </main>
    );
  }

  if (!story || !read) {
    return (
      <main className="mx-auto flex max-w-[42rem] flex-col gap-4 px-5 py-14 sm:px-8">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-9 w-2/3" />
        <div className="skeleton mb-4 h-12 w-full" />
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="skeleton h-4"
            style={{ width: `${86 + ((i * 7) % 14)}%` }}
          />
        ))}
      </main>
    );
  }

  const chapters = read.contributions;
  const chapter = chapters.find((c) => c.depth === depth);
  const q = wantedBranch ? `?branch=${wantedBranch}` : '';

  // Past the free chapters the paywall withholds the row entirely, so a
  // missing chapter the story claims to have is a locked one.
  if (!chapter) {
    const locked = depth < story.contributionCount;
    return (
      <main className="mx-auto flex max-w-[42rem] flex-col items-start gap-5 px-5 py-14 sm:px-8">
        <Link
          href={`/doc/${id}/1${q}`}
          className="text-[12.5px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          <span aria-hidden>←</span> Về đầu truyện
        </Link>
        <h1 className="display text-[1.8rem]">
          {locked ? 'Chương này đang bị khoá' : 'Không có chương này'}
        </h1>
        {locked && (
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            {read.access.freeChapters} chương đầu miễn phí. Mở khoá để đọc tiếp
            — {read.access.unlockPrice} credit.
          </p>
        )}
        <Link href={`/stories/${id}`} className="btn btn-primary">
          Mở trang truyện <span aria-hidden>→</span>
        </Link>
      </main>
    );
  }

  const prev = depth > 0 ? depth : null;
  const next = chapters.some((c) => c.depth === depth + 1) ? depth + 2 : null;
  const total = read.access.unlocked
    ? story.contributionCount
    : chapters.length;

  const current = story.branches.find((b) => b.id === read.branch.id);
  const split = forksAt(story, read.branch.id, depth);

  return (
    <>
      <ReadingProgress target={article} />

      <main className="mx-auto flex max-w-[42rem] flex-col gap-9 px-5 py-10 sm:px-8">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[12.5px]">
            <Link
              href={`/doc/${id}${q}`}
              className="text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
            >
              <span aria-hidden>←</span> Mục lục
            </Link>
            <span aria-hidden className="text-[var(--color-line-strong)]">
              ·
            </span>
            <Link
              href={`/doc/${id}${q}`}
              className="font-serif text-[14px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
            >
              {story.title}
            </Link>
          </div>

          <span className="label label-accent">
            Chương {depth + 1} / {total}
          </span>

          <h1 className="display text-[1.9rem] leading-[1.12] sm:text-[2.2rem]">
            {chapter.title ?? `Chương ${depth + 1}`}
          </h1>

          <p className="flex flex-wrap items-center gap-x-2.5 text-[12px] text-[var(--color-faint)]">
            <span>{chapter.wordCount} từ</span>
            {/* Who wrote this chapter - not who owns the story. On a branch
                they are different people, and crediting the story's author
                with a stranger's chapter is the exact mix-up branches exist
                to prevent. */}
            {(chapter.author ?? story.owner) && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={
                    chapter.author && chapter.author.handle !== story.owner?.handle
                      ? 'text-[var(--color-accent)]'
                      : undefined
                  }
                >
                  @{(chapter.author ?? story.owner)!.handle}
                </span>
              </>
            )}
            {chapter.authorType === 'AI' && (
              <>
                <span aria-hidden>·</span>
                <span className="text-[var(--color-accent)]">AI viết</span>
              </>
            )}
          </p>
        </header>

        {current && <BranchBanner story={story} branch={current} />}

        <ChapterNarration
          branchId={read.branch.id}
          depth={depth}
          next={
            next !== null
              ? {
                  href: `/doc/${id}/${next}${q}`,
                  title:
                    chapters.find((c) => c.depth === depth + 1)?.title ??
                    `Chương ${next}`,
                }
              : null
          }
        />

        <article ref={article} className="prose-read">
          {/* The chapter's own document - bold, italics, lists - falling back
              to its plain text for chapters saved before the editors were
              rich. Rendered without a wrapper so the drop cap still finds
              the first paragraph. */}
          <RichText doc={docOf(chapter)} />
        </article>

        {/* Where the story already splits. Shown before the offer to write
            one's own: the ending a reader wants may already exist, written by
            someone else. */}
        {split.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="display text-[19px] leading-snug">
              Câu chuyện rẽ ở đây
            </h2>
            <p className="text-[13.5px] text-[var(--color-muted)]">
              Sau chương {depth + 1}, {split.length === 1 ? 'có một người' : `có ${split.length} hướng`}{' '}
              đã viết tiếp theo cách khác.
            </p>
            <div className="flex flex-col gap-2">
              {split.map((b) => (
                <BranchLink key={b.id} story={story} branch={b} />
              ))}
            </div>
          </section>
        )}

        {/* The offer, kept quiet. A filled panel here reads as an advert
            interrupting the story; a rule and a question reads as an aside. */}
        <section className="flex flex-col items-start gap-3 border-l-2 border-[var(--color-accent)] py-1 pl-5">
          <h2 className="display text-[19px] leading-snug">
            Bạn muốn chương này kết thúc khác đi?
          </h2>
          <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--color-muted)]">
            Giữ lại {depth + 1} chương đầu, rồi viết tiếp ngay. Bản gốc không
            thay đổi.
          </p>
          <button
            onClick={ready && !user ? signIn : forkHere}
            disabled={forking}
            className="btn btn-ghost"
          >
            <span aria-hidden>⑂</span>
            {forking
              ? 'Đang tạo nhánh…'
              : ready && !user
                ? // Inline rather than a card: this sits at the end of a
                  // chapter, and a sign-in box between the last line and the
                  // next-chapter arrows would read as the end of the story.
                  'Đăng nhập để viết một kết cục khác'
                : 'Viết một kết cục khác'}
            <span aria-hidden>→</span>
          </button>
        </section>

        <nav className="flex items-stretch justify-between gap-3 border-t border-[var(--color-line)] pt-5">
          {prev !== null ? (
            <Link
              href={`/doc/${id}/${prev}${q}`}
              className="group flex min-w-0 flex-1 flex-col gap-1 rounded-[5px] border border-transparent px-3 py-2.5 transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-surface)]"
            >
              <span className="label">← Chương trước</span>
              <span className="truncate text-[14px] transition-colors group-hover:text-[var(--color-accent)]">
                {chapters.find((c) => c.depth === depth - 1)?.title ??
                  `Chương ${prev}`}
              </span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}

          {next !== null ? (
            <Link
              href={`/doc/${id}/${next}${q}`}
              className="group flex min-w-0 flex-1 flex-col items-end gap-1 rounded-[5px] border border-transparent px-3 py-2.5 text-right transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-surface)]"
            >
              <span className="label">Chương tiếp →</span>
              <span className="w-full truncate text-[14px] transition-colors group-hover:text-[var(--color-accent)]">
                {chapters.find((c) => c.depth === depth + 1)?.title ??
                  `Chương ${next}`}
              </span>
            </Link>
          ) : (
            <span className="flex flex-1 items-center justify-end px-3 text-[12.5px] text-[var(--color-faint)]">
              {read.access.lockedCount > 0
                ? `Còn ${read.access.lockedCount} chương bị khoá`
                : 'Hết truyện'}
            </span>
          )}
        </nav>
      </main>
    </>
  );
}
