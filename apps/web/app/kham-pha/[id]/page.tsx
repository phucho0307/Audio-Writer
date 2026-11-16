'use client';

import { thumbUrl } from '@/lib/thumb';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  mainBranch,
  api,
  type BranchRead,
  type Contribution,
  type Story,
} from '@/lib/api';
import { SignInPrompt } from '@/app/SignInWall';
import { useAuth } from '@/lib/useAuth';
import Reveal from '@/app/Reveal';
import SpiritText from '@/app/SpiritText';
import { chapterAuthorHandle, storyAuthorHandle } from '@/lib/chapter-author';
import AuthorByline from '@/app/AuthorByline';
import { nativeStory } from '@/lib/native-catalog';

/**
 * Choosing where to diverge.
 *
 * The whole screen exists to make one decision legible: everything up to the
 * chapter you pick stays as it was, and everything after it becomes yours. The
 * original is never touched, which is the thing people need to believe before
 * they will touch someone else's story at all.
 *
 * So the list is drawn as the branch it describes. A line runs down the
 * chapters; above the chosen point it is solid and gold because that history
 * is kept, below it the line steps aside and goes dashed because that part is
 * no longer this story. The sentence underneath says the same thing in words,
 * but the shape says it first.
 */
export default function ForkPicker({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, ready } = useAuth();
  const { id } = use(params);

  const [story, setStory] = useState<Story | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStory(id);
        setStory(s);
        const root = mainBranch(s);
        if (root) setRead(await api.readBranch(root.id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  /**
   * Opens the editor in fork mode. Nothing is created here: a branch exists
   * only once its first chapter is saved, so backing out costs nothing.
   */
  function fork() {
    if (!read || picked === null) return;
    setBusy(true);
    window.location.href = `/stories/${id}?forkFrom=${read.branch.id}&atDepth=${picked}`;
  }

  if (error && !story) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
        <Link href="/kham-pha" className="btn btn-ghost mt-5">
          <span aria-hidden>←</span> Quay lại
        </Link>
      </main>
    );
  }

  if (!story || !read) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-12 sm:px-8">
        <div className="flex gap-5">
          <div className="skeleton h-[164px] w-[118px] flex-none" />
          <div className="flex flex-1 flex-col gap-3 pt-1">
            <div className="skeleton h-8 w-2/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-4/5" />
          </div>
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-16 w-full" />
        ))}
      </main>
    );
  }

  const chapters: Contribution[] = read.contributions;

  return (
    <>
      {story.coverUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[380px] overflow-hidden"
        >
          <div
            className="h-full w-full scale-125 bg-cover bg-center opacity-25 blur-3xl"
            style={{ backgroundImage: `url(${thumbUrl(story.coverUrl)})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[color-mix(in_oklab,var(--color-ground)_60%,transparent)] to-[var(--color-ground)]" />
        </div>
      )}

      <main className="relative mx-auto flex max-w-3xl flex-col gap-9 px-5 py-8 sm:px-8 sm:py-10">
        <Link
          href="/kham-pha"
          className="text-[12.5px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
        >
          <span aria-hidden>←</span> Khám phá
        </Link>

        <Reveal as="header" className="flex gap-5 sm:gap-6">
          <div className="cover aspect-[3/4] w-[112px] flex-none self-start sm:w-[132px]">
            {story.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl(story.coverUrl)} alt="" />
            )}
          </div>
          <div className="flex flex-col items-start gap-2.5">
            <SpiritText
              text={story.title}
              className="display text-[1.8rem] leading-[1.08] sm:text-[2.1rem]"
            />
            <p className="line-clamp-3 text-[13.5px] leading-relaxed text-[var(--color-muted)]">
              {story.synopsis}
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5">
              {story.genres.map((g) => (
                <span key={g} className="chip chip-on cursor-default">
                  {g}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        {story.coverCredit && <p className="text-[11px] text-[var(--color-muted)]">Ảnh bìa: <a href={story.coverCredit.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{story.coverCredit.photographer || 'Pexels'}{story.coverCredit.photographer ? ' / Pexels' : ''} ↗</a></p>}

        <div className="flex flex-col gap-1.5 border-l-2 border-[var(--color-accent)] pl-4">
          <h2 className="display text-xl">Chương nào nên rẽ hướng khác?</h2>
          <p className="text-[13.5px] text-[var(--color-muted)]">
            Chọn chương cuối cùng bạn muốn giữ. Mọi thứ sau đó bạn viết lại.
          </p>
        </div>

        <ol className="flex flex-col">
          {chapters.map((c, i) => {
            const kept = picked !== null && i <= picked;
            const rewritten = picked !== null && i > picked;
            const isPick = picked === i;
            const first = i === 0;
            const last = i === chapters.length - 1;

            return (
              <li key={c.id}>
                <button
                  onClick={() => setPicked(isPick ? null : i)}
                  aria-pressed={isPick}
                  className={`group flex w-full gap-4 rounded-[5px] px-2 text-left transition-colors ${
                    rewritten ? 'opacity-45' : ''
                  } hover:bg-[var(--color-surface)]`}
                >
                  {/* The rail. Two half-segments per row rather than one line
                      down the list, so each chapter can draw its own half
                      above and below - which is what lets the line change
                      character exactly at the chosen chapter. */}
                  <span
                    className="relative flex w-7 flex-none flex-col items-center"
                    aria-hidden
                  >
                    <span
                      className={`w-px flex-1 ${first ? 'opacity-0' : ''} ${
                        kept
                          ? 'bg-[var(--color-accent)]'
                          : 'bg-[var(--color-line-strong)]'
                      }`}
                    />
                    <span
                      className={`my-1.5 grid h-7 w-7 flex-none place-items-center rounded-full border text-[12px] tabular-nums transition-colors ${
                        isPick
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                          : kept
                            ? 'border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                            : 'border-[var(--color-line-strong)] text-[var(--color-muted)] group-hover:border-[var(--color-accent-line)]'
                      }`}
                    >
                      {isPick ? '⑂' : i + 1}
                    </span>
                    <span
                      className={`w-px flex-1 ${last ? 'opacity-0' : ''} ${
                        picked !== null && i >= picked
                          ? // Past the fork the line is no longer this story's
                            // spine, so it stops being drawn as one.
                            'border-l border-dashed border-[var(--color-line-strong)]'
                          : kept
                            ? 'bg-[var(--color-accent)]'
                            : 'bg-[var(--color-line-strong)]'
                      }`}
                    />
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-1 py-3">
                    <span className="line-clamp-2 font-serif text-[15.5px] leading-relaxed">
                      {c.title ?? c.textPlain.split('\n')[0]}
                    </span>
                    <span className="text-[11px] text-[var(--color-faint)]"><AuthorByline branchId={c.branchId} handle={chapterAuthorHandle(c, story.owner)} nested /></span>
                    {isPick && (
                      <span className="text-[12px] text-[var(--color-accent)]">
                        Nhánh của bạn bắt đầu ngay sau chương này
                      </span>
                    )}
                    {rewritten && (
                      <span className="text-[12px] text-[var(--color-muted)]">
                        Bạn sẽ viết lại phần này
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Sticky, because the decision is made up in the list and confirmed
            down here - on a long story those are two different screens. */}
        <div className="card sticky bottom-[calc(76px+env(safe-area-inset-bottom))] sm:bottom-4 flex flex-col gap-3 p-4 shadow-[0_18px_40px_-14px_rgb(0_0_0/0.75)] backdrop-blur-sm">
          {picked === null ? (
            <p className="text-[13.5px] text-[var(--color-muted)]">
              Chọn một chương ở trên để bắt đầu.
            </p>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">
              Giữ lại{' '}
              <strong className="font-medium text-[var(--color-ink)]">
                chương 1–{picked + 1}
              </strong>
              , viết tiếp từ{' '}
              <strong className="font-medium text-[var(--color-ink)]">
                chương {picked + 2}
              </strong>
              . Bản gốc của {nativeStory(story.id)?.textSource.authorName ?? (storyAuthorHandle(story) ? `@${storyAuthorHandle(story)}` : 'tác giả')} không thay
              đổi.
            </p>
          )}

          {ready && !user ? (
            // Reading got them this far without an account; the ask arrives
            // only now, when they have chosen a chapter and want to write.
            <SignInPrompt
              compact
              title="Đăng nhập để rẽ nhánh"
              reason="Nhánh mới là truyện của bạn, nên cần một tài khoản để lưu. Bản gốc không thay đổi."
            />
          ) : (
            <button
              onClick={fork}
              disabled={picked === null || busy}
              className="btn btn-primary btn-lg"
            >
              <span aria-hidden>⑂</span>
              {busy ? 'Đang tạo nhánh…' : 'Rẽ nhánh và viết tiếp'}
            </button>
          )}

          {error && (
            <p className="text-[12.5px] text-[var(--color-son)]">{error}</p>
          )}
        </div>
      </main>
    </>
  );
}
