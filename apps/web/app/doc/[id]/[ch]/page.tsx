'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, type BranchRead, type Story } from '@/lib/api';
import ChapterNarration from './ChapterNarration';

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
  const { id, ch } = use(params);
  const wantedBranch = useSearchParams().get('branch');

  // Chapters are 1-based in the URL; depth is 0-based in the data.
  const depth = Math.max(0, Number(ch) - 1);

  const [story, setStory] = useState<Story | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStory(id);
        setStory(s);
        const branch =
          (wantedBranch && s.branches.find((b) => b.id === wantedBranch)) ||
          s.branches.find((b) => b.isRoot);
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
  async function forkHere() {
    if (!read) return;
    setForking(true);
    setError(null);
    try {
      const branch = await api.fork(read.branch.id, {
        atDepth: depth,
        name: `nhánh từ chương ${depth + 1}`,
      });
      window.location.href = `/stories/${id}?branch=${branch.id}`;
    } catch (e) {
      setError((e as Error).message);
      setForking(false);
    }
  }

  // Landing on a new chapter should start at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [depth]);

  if (error && !story) {
    return (
      <main className="mx-auto max-w-[42rem] px-6 py-14">
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
      <main className="mx-auto max-w-[42rem] px-6 py-14">
        <p className="text-sm text-[var(--color-muted)]">Đang tải…</p>
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
      <main className="mx-auto flex max-w-[42rem] flex-col gap-5 px-6 py-14">
        <Link
          href={`/doc/${id}/1${q}`}
          className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← về đầu truyện
        </Link>
        <h1 className="font-serif text-2xl">
          {locked ? 'Chương này đang bị khoá' : 'Không có chương này'}
        </h1>
        {locked && (
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            {read.access.freeChapters} chương đầu miễn phí. Mở khoá để đọc tiếp
            — {read.access.unlockPrice} credit.
          </p>
        )}
        <Link
          href={`/stories/${id}`}
          className="self-start text-[14px] text-[var(--color-accent)] hover:underline"
        >
          Mở trang truyện →
        </Link>
      </main>
    );
  }

  const prev = depth > 0 ? depth : null;
  const next = chapters.some((c) => c.depth === depth + 1) ? depth + 2 : null;
  const total = read.access.unlocked
    ? story.contributionCount
    : chapters.length;

  return (
    <main className="mx-auto flex max-w-[42rem] flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2.5">
        <Link
          href={`/doc/${id}${q}`}
          className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← mục lục
        </Link>
        <Link
          href={`/doc/${id}${q}`}
          className="font-serif text-[15px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          {story.title}
        </Link>
        <h1 className="font-serif text-[1.75rem] leading-tight tracking-tight">
          {chapter.title ?? `Chương ${depth + 1}`}
        </h1>
        <p className="font-mono text-[11px] text-[var(--color-muted)]">
          Chương {depth + 1} / {total}
          {story.owner && ` · @${story.owner.handle}`}
          {chapter.authorType === 'AI' && ' · AI viết'}
        </p>
      </header>

      <ChapterNarration branchId={read.branch.id} depth={depth} />

      <article className="whitespace-pre-wrap font-serif text-[18.5px] leading-[1.9]">
        {chapter.textPlain}
      </article>

      {/* The offer, kept quiet. A filled panel here reads as an advert
          interrupting the story; a rule and a question reads as an aside. */}
      <section className="flex flex-col gap-2.5 border-l-2 border-[var(--color-accent)] py-1 pl-5">
        <h2 className="font-serif text-[19px] leading-snug">
          Bạn muốn chương này kết thúc khác đi?
        </h2>
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--color-muted)]">
          Giữ lại {depth + 1} chương đầu, rồi viết tiếp ngay. Bản gốc không
          thay đổi.
        </p>
        <button
          onClick={forkHere}
          disabled={forking}
          className="self-start text-[14px] font-medium text-[var(--color-accent)] hover:underline disabled:opacity-50"
        >
          {forking ? 'Đang tạo nhánh…' : '⑂ Viết một kết cục khác →'}
        </button>
      </section>

      <nav className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] pt-5">
        {prev !== null ? (
          <Link
            href={`/doc/${id}/${prev}${q}`}
            className="group flex flex-col gap-0.5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              trước
            </span>
            <span className="max-w-[15ch] truncate text-[14px] transition-colors group-hover:text-[var(--color-accent)]">
              ←{' '}
              {chapters.find((c) => c.depth === depth - 1)?.title ??
                `Chương ${prev}`}
            </span>
          </Link>
        ) : (
          <span />
        )}

        {next !== null ? (
          <Link
            href={`/doc/${id}/${next}${q}`}
            className="group flex flex-col items-end gap-0.5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              tiếp
            </span>
            <span className="max-w-[15ch] truncate text-[14px] transition-colors group-hover:text-[var(--color-accent)]">
              {chapters.find((c) => c.depth === depth + 1)?.title ??
                `Chương ${next}`}{' '}
              →
            </span>
          </Link>
        ) : (
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {read.access.lockedCount > 0 ? '🔒 còn chương bị khoá' : 'hết truyện'}
          </span>
        )}
      </nav>
    </main>
  );
}
