import catalog from './chinese-catalog.json';
import type { TextSource } from './api';

export type ChineseWork = {
  id: string;
  nativeStoryId: string;
  branchId: string;
  title: string;
  authorId: string;
  authorName: string;
  genres: string[];
  sourceId: 'monkeyd' | 'metruyen';
  sourceName: string;
  sourceUrl: string;
  coverUrl: string | null;
  chapterCount: number;
  wordCount: number;
  textSource: TextSource;
  collectionId: 'chinese-drama';
  selectionRank: number;
  containedTitles?: string[];
  popularity: {
    kind: 'source-most-views' | 'source-period-ranking';
    period?: string;
    rank: number;
    url: string;
  };
};

export const CHINESE_WORKS = catalog.works as ChineseWork[];
export const CHINESE_SHELF_NAME = catalog.name;

export function matchesChineseSearch(work: ChineseWork, query: string): boolean {
  const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\btrong sinh\b/g, 'trung sinh');
  const text = fold(`${work.title} ${work.authorName} ${work.genres.join(' ')} ${work.sourceName}`);
  return fold(query).trim().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}
