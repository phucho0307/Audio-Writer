'use client';

import type { Story } from '@/lib/api';
import { famousAuthor, type FamousWork } from '@/lib/famous-catalog';
import { storyRating } from '@/lib/ratings';
import ShelfCard from './ShelfCard';

/**
 * A famous author's work. Most are read here (`nativeStoryId`); a few are
 * the author's official YouTube readings, which have no chapters and open
 * the work's own page.
 */
export default function FamousWorkCard({ work, story }: { work: FamousWork; story?: Story }) {
  const author = famousAuthor(work.authorId);
  const here = Boolean(work.nativeStoryId);
  return (
    <ShelfCard
      href={here ? `/doc/${work.nativeStoryId}` : `/tac-pham/${work.id}`}
      title={work.title}
      coverUrl={work.coverUrl}
      coverLabel={author.name}
      chapters={here ? (story?.contributionCount ?? work.chapterCount ?? null) : null}
      synopsis={
        story?.synopsis ??
        (work.videoId ? `Bản đọc chính thức của ${author.name} trên YouTube, nghe ngay tại đây.` : null)
      }
      genres={work.genres}
      author={author.name}
      rating={story ? storyRating(story) : null}
      frame={Boolean(work.videoId)}
    />
  );
}
