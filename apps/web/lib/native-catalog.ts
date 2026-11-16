import catalog from './native-catalog.json';
import type { TextSource } from './api';
import type { FamousAuthor, FamousWork } from './famous-catalog';
import { CHINESE_WORKS } from './chinese-catalog';

export type NativeWork = FamousWork & {
  nativeStoryId: string;
  branchId: string;
  chapterCount: number;
  wordCount: number;
  textSource: TextSource;
  catalogAliases?: string[];
};

export const NATIVE_WORKS = catalog.works as NativeWork[];
export const NATIVE_AUTHORS = catalog.authors as FamousAuthor[];
const curated = [...NATIVE_WORKS, ...CHINESE_WORKS];
const stories = new Map(curated.map((work) => [work.nativeStoryId, work]));
const branches = new Map(curated.map((work) => [work.branchId, work]));
export const nativeStory = (id: string) => stories.get(id);
export const nativeBranch = (id: string) => branches.get(id);
