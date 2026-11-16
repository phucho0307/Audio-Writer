import catalog from './famous-catalog.json';
import { NATIVE_AUTHORS, NATIVE_WORKS } from './native-catalog';

export type FamousAuthor = {
  id: string;
  name: string;
  sourceUrl: string;
  note: string;
  genres: string[];
};

export type FamousWork = {
  id: string;
  title: string;
  authorId: string;
  genres: string[];
  format: 'audio' | 'book';
  sourceName: string;
  sourceUrl: string;
  discoveredAt: string;
  sourceTitle: string;
  coverUrl: string | null;
  imageSourceUrl: string;
  videoId?: string;
  nativeStoryId?: string;
  chapterCount?: number;
  wordCount?: number;
  containedTitles?: string[];
};

// Keep the original discovery records for stable old links. Only works that
// can be read here, or the existing official Nguyễn Ngọc Ngạn embeds, enter
// the active shelf. Publisher previews are not advertised as full books.
export const DISCOVERED_WORKS = catalog.works as FamousWork[];
export const FAMOUS_WORKS: FamousWork[] = [
  ...DISCOVERED_WORKS.filter((work) => !!work.videoId),
  ...NATIVE_WORKS,
];
export const FAMOUS_AUTHORS = [...new Map(
  [...catalog.authors as FamousAuthor[], ...NATIVE_AUTHORS].map((author) => [author.id, author]),
).values()]
  .filter((author) => FAMOUS_WORKS.some((work) => work.authorId === author.id));
export const CATALOG_CHECKED_AT = catalog.checkedAt;

export function famousAuthor(id: string): FamousAuthor {
  return FAMOUS_AUTHORS.find((author) => author.id === id)
    ?? (catalog.authors as FamousAuthor[]).find((author) => author.id === id)!;
}

export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export function matchesCatalogSearch(work: FamousWork, query: string): boolean {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  const authorQuery = words.join(' ');
  if (words.length >= 2) {
    const authors = FAMOUS_AUTHORS.filter((author) => {
      const name = foldSearch(author.name);
      return name === authorQuery || name.endsWith(` ${authorQuery}`);
    });
    if (authors.length) return authors.some((author) => author.id === work.authorId);
  }
  const haystack = foldSearch(`${work.title} ${famousAuthor(work.authorId).name} ${work.genres.join(' ')} ${(work.containedTitles ?? []).join(' ')}`);
  return words.every((word) => haystack.includes(word));
}
