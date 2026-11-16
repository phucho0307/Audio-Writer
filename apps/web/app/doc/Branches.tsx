'use client';

import Link from 'next/link';
import type { BranchSummary, Story } from '@/lib/api';
import RatingBadge from '@/app/Rating';
import { branchRating } from '@/lib/ratings';
import { storyAuthorHandle } from '@/lib/chapter-author';
import { nativeStory } from '@/lib/native-catalog';

/**
 * Branches as readers meet them: at the chapter where they split off.
 *
 * Forks used to exist only in the author's workbench switcher. A reader who
 * finished chapter 7 had no way to learn that two other people had written a
 * different chapter 8, and a writer who made one could not find it again from
 * the story page - it was saved, and invisible. Branching is the product's
 * premise, so the split is shown where it happens.
 */

/** Branches split from `from` right after the chapter at `depth`. */
export function forksAt(
  story: Story,
  from: string,
  depth: number,
): BranchSummary[] {
  return story.branches.filter(
    (b) =>
      !b.isRoot &&
      !b.isDraft &&
      // An empty branch has nothing to read and its link leads nowhere.
      (b._count?.contributions ?? 0) > 0 &&
      b.forkedFromBranchId === from &&
      b.forkedAtDepth === depth,
  );
}

/** Every branch a reader may open, nearest split first. */
export function readableForks(story: Story): BranchSummary[] {
  return story.branches
    .filter((b) => !b.isRoot && !b.isDraft && (b._count?.contributions ?? 0) > 0)
    .sort((a, b) => (a.forkedAtDepth ?? 0) - (b.forkedAtDepth ?? 0));
}

/** "@handle", or nothing when the branch is the story owner's own. */
function authorOf(story: Story, b: BranchSummary): string | null {
  if (b.owner?.handle === story.owner?.handle) {
    const native = nativeStory(story.id);
    if (native) return native.textSource.authorName;
    const author = storyAuthorHandle(story);
    return author ? `@${author}` : null;
  }
  return b.owner ? `@${b.owner.handle}` : null;
}

function labelOf(story: Story, b: BranchSummary): string {
  const author = authorOf(story, b);
  // A guest's branch is already named "@handle"; do not print it twice.
  return author && b.name === author ? 'nhánh riêng' : b.name;
}

/** Where to land in a branch: its first chapter of its own. */
export function entryHref(storyId: string, b: BranchSummary): string {
  return `/doc/${storyId}/${(b.forkedAtDepth ?? 0) + 2}?branch=${b.id}`;
}

/** One branch as a link: name, author tag, how much of it is its own. */
export function BranchLink({
  story,
  branch: b,
  compact = false,
}: {
  story: Story;
  branch: BranchSummary;
  compact?: boolean;
}) {
  const author = authorOf(story, b);
  const own = b._count?.contributions ?? 0;
  return (
    <Link
      href={entryHref(story.id, b)}
      className={`group flex items-center gap-3 rounded-[5px] border border-[var(--color-line)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-accent-line)] ${
        compact ? 'px-3 py-2' : 'px-3.5 py-2.5'
      }`}
    >
      <span
        aria-hidden
        className="grid h-7 w-7 flex-none place-items-center rounded-full border border-[var(--color-accent-line)] text-[13px] text-[var(--color-accent)]"
      >
        ⑂
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <span className="truncate transition-colors group-hover:text-[var(--color-accent)]">
            {labelOf(story, b)}
          </span>
          {author && (
            <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-px text-[11.5px] text-[var(--color-accent)]">
              {author}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--color-faint)]">
          <RatingBadge rating={branchRating(b.id)} className="text-[11.5px]" />
          <span>
            · rẽ sau chương {(b.forkedAtDepth ?? 0) + 1}
            {own > 0 && ` · ${own} chương riêng`}
          </span>
        </span>
      </span>
      <span
        aria-hidden
        className="text-[var(--color-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-accent)]"
      >
        →
      </span>
    </Link>
  );
}

/**
 * Shown while reading a branch rather than the story itself: whose version
 * this is, where it left the original, and the way back.
 */
export function BranchBanner({
  story,
  branch: b,
}: {
  story: Story;
  branch: BranchSummary;
}) {
  if (b.isRoot) return null;
  const author = authorOf(story, b);
  const parent = story.branches.find((x) => x.id === b.forkedFromBranchId);
  const back =
    !parent || parent.isRoot
      ? `/doc/${story.id}`
      : `/doc/${story.id}?branch=${parent.id}`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[5px] border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-3.5 py-2.5 text-[13px]">
      <span aria-hidden className="text-[var(--color-accent)]">
        ⑂
      </span>
      <span className="text-[var(--color-ink)]">
        Bạn đang đọc{' '}
        <strong className="font-medium">{labelOf(story, b)}</strong>
        {author && (
          <>
            {' '}của <span className="text-[var(--color-accent)]">{author}</span>
          </>
        )}
        , rẽ sau chương {(b.forkedAtDepth ?? 0) + 1}.
      </span>
      <Link
        href={back}
        className="ml-auto text-[12.5px] text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
      >
        ← {parent && !parent.isRoot ? 'Nhánh gốc' : 'Bản chính'}
      </Link>
    </div>
  );
}
