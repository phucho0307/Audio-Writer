'use client';

import type { Story } from '@/lib/api';
import type { ChineseWork } from '@/lib/chinese-catalog';
import { storyRating } from '@/lib/ratings';
import ShelfCard from './ShelfCard';

/**
 * A Chinese novel on the shelf. `story` is the same work as the site holds
 * it - its live chapter count, synopsis and rating - when the shelf has it.
 */
export default function ChineseWorkCard({ work, story }: { work: ChineseWork; story?: Story }) {
  return (
    <ShelfCard
      href={`/doc/${work.nativeStoryId}`}
      title={work.title}
      coverUrl={work.coverUrl}
      coverLabel="Truyện Trung"
      chapters={story?.contributionCount ?? work.chapterCount}
      synopsis={story?.synopsis}
      genres={work.genres.filter((g) => g !== 'Truyện Trung')}
      author={work.authorName}
      rating={story ? storyRating(story) : null}
    />
  );
}
