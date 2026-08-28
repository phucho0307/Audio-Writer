/**
 * Sample stories shipped with the platform.
 *
 * These are hand-written rather than generated, for three reasons: the free API
 * tier allows only 20 requests per day so a seed run must not depend on it,
 * generated openings drift toward the most generic version of a genre, and
 * these are the first thing a visitor ever reads.
 *
 * One file per story under ./stories - eight chapters each is enough text that
 * keeping them in a single module made it unnavigable.
 *
 * All content is original to this project.
 */

export interface SampleChapter {
  text: string;
}

export interface SampleStory {
  slug: string;
  title: string;
  genres: string[];
  synopsis: string;
  /** Kept for reference; the drawn cover lives in ./cover-art keyed by slug. */
  palette: [string, string, string];
  motif: 'door' | 'mirror' | 'rain' | 'terrace' | 'flood' | 'lantern';
  chapters: SampleChapter[];
}

import { CAN_HO_704 } from './stories/can-ho-704';
import { TRONG_SINH } from './stories/trong-sinh-ngay-bi-hai';
import { HE_THONG_SAN_QUY } from './stories/he-thong-san-quy';
import { XUYEN_VIET } from './stories/xuyen-viet-trong-rau';
import { MAT_THE } from './stories/mat-the-ngay-thu-bay';
import { CO_DAI_Y_NU } from './stories/co-dai-y-nu';

export const SAMPLE_STORIES: SampleStory[] = [
  CAN_HO_704,
  TRONG_SINH,
  HE_THONG_SAN_QUY,
  XUYEN_VIET,
  MAT_THE,
  CO_DAI_Y_NU,
];
