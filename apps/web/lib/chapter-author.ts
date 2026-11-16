import type { Contribution } from './api';
import chapterAuthors from './chapter-authors.json';
import storyAuthors from './story-authors.json';

const chapterBylines: Readonly<Record<string, string>> = chapterAuthors;
const storyBylines: Readonly<Record<string, string>> = storyAuthors;

/** Persisted bylines stay consistent across reloads and inherited chapters.
 * Contributions outside this catalog retain their account handles.
 */
export function chapterAuthorHandle(
  chapter: Pick<Contribution, 'id' | 'branchId' | 'author'>,
  fallback?: { handle: string } | null,
): string | null {
  return chapterBylines[chapter.id] ?? chapter.author?.handle ?? fallback?.handle ?? null;
}

/** One consistent byline wherever a story's cover or introduction appears. */
export function storyAuthorHandle(story: {
  id: string;
  owner?: { handle: string } | null;
}): string | null {
  return storyBylines[story.id] ?? story.owner?.handle ?? null;
}
