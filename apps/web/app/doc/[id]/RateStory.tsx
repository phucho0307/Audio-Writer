'use client';

import { useEffect, useState } from 'react';
import { api, type RatingSummary } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

const STAR =
  'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
const WORDS = ['', 'Dở', 'Tạm', 'Được', 'Hay', 'Rất hay'];

/**
 * Where a reader gives a story stars.
 *
 * Says plainly why it is not available when it is not - signed out, not read
 * yet, your own story - rather than showing stars that do nothing when
 * clicked.
 */
export default function RateStory({ storyId }: { storyId: string }) {
  const { user } = useAuth();
  const [r, setR] = useState<RatingSummary | null>(null);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.storyRating(storyId).then(setR).catch(() => setR(null));
  }, [storyId, user?.id]);

  if (!r || r.reason === 'OWN_STORY') return null;

  async function rate(stars: number) {
    setBusy(true);
    setError(null);
    try {
      setR(stars === r!.mine ? await api.unrateStory(storyId) : await api.rateStory(storyId, stars));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || r.mine || 0;
  const disabled = !r.canRate || busy;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[12.5px] text-[var(--color-muted)]">
          {r.mine ? 'Bạn chấm' : 'Chấm truyện này'}
        </span>
        <div
          role="radiogroup"
          aria-label="Chấm sao cho truyện"
          className="flex"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={r.mine === n}
              aria-label={`${n} sao, ${WORDS[n]}`}
              title={r.mine === n ? 'Bấm lần nữa để bỏ chấm' : WORDS[n]}
              disabled={disabled}
              onMouseEnter={() => !disabled && setHover(n)}
              onFocus={() => !disabled && setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => void rate(n)}
              className="p-0.5 transition-transform enabled:hover:scale-110 disabled:cursor-not-allowed"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
                className={n <= shown ? 'text-[var(--color-accent)]' : 'text-[var(--color-line-strong)]'}
              >
                <path d={STAR} />
              </svg>
            </button>
          ))}
        </div>
        {shown > 0 && <span className="text-[12.5px] text-[var(--color-ink)]">{WORDS[shown]}</span>}
      </div>

      <p className="text-[12px] text-[var(--color-faint)]">
        {r.reason === 'SIGN_IN' ? (
          <>
            <button type="button" onClick={signIn} className="text-[var(--color-accent)] hover:underline">
              Đăng nhập
            </button>{' '}
            để chấm sao.
          </>
        ) : r.reason === 'READ_FIRST' ? (
          'Đọc hoặc nghe ít nhất một chương rồi hãy chấm sao.'
        ) : r.average === null ? (
          r.count > 0
            ? `${r.count} người đã chấm. Đủ 5 lượt sẽ hiện điểm.`
            : 'Chưa ai chấm. Hãy là người đầu tiên.'
        ) : null}
      </p>
      {error && <p role="alert" className="text-[12px] text-[var(--color-son)]">{error}</p>}
    </div>
  );
}
