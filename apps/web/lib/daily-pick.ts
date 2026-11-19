import type { Story } from './api';
import { nativeStory } from './native-catalog';

/**
 * Today's recommended story: one of the stories written on Nhịp Bút, a
 * different one each day, the same for everyone all day.
 *
 * The day turns at midnight in Vietnam, not UTC, so the pick does not change
 * at seven in the morning. The pool is ordered by id, which never changes,
 * so adding a story shifts the rotation once rather than reshuffling it.
 *
 * For a reader, a story they have already opened is passed over in favour of
 * the next one in the rotation: a recommendation for something they are
 * halfway through is not a recommendation.
 */
export function dailyPick(stories: Story[], opened: (id: string) => boolean = () => false): Story | null {
  const pool = stories
    .filter((s) => !s.textSource && !nativeStory(s.id) && s.coverUrl && s.contributionCount >= 5)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!pool.length) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  for (let i = 0; i < pool.length; i++) {
    const s = pool[(day + i) % pool.length];
    if (!opened(s.id)) return s;
  }
  return pool[day % pool.length];
}
