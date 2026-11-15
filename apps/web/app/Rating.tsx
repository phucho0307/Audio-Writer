import { formatCount, formatScore, type Rating } from '@/lib/ratings';

const STAR =
  'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';

/**
 * Five stars filled to the score.
 *
 * Partial fill rather than rounding to whole stars: 4.6 and 4.1 both round to
 * four, and the difference between them is the thing a rating is for. The
 * fill is a clip on a gold copy laid over a dim one, so it can stop part way
 * through a star.
 */
function StarRow({ score, size }: { score: number; size: number }) {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  const row = (cls: string) => (
    <span className={`flex ${cls}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
  return (
    <span className="relative inline-flex" aria-hidden>
      {row('text-[var(--color-line-strong)]')}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {row('text-[var(--color-accent)]')}
      </span>
    </span>
  );
}

/**
 * A rating, in the shape the place calls for.
 *
 * `compact` is for cards and list rows: one gold star, the score, the count in
 * brackets. `full` is for a story's own page: the five-star row, "4,6/5", and
 * the count spelled out. Both carry the same text for screen readers, since
 * the stars themselves are decoration.
 */
export default function RatingBadge({
  rating,
  variant = 'compact',
  className = '',
}: {
  rating: Rating;
  variant?: 'compact' | 'full';
  className?: string;
}) {
  const said = `Đánh giá ${formatScore(rating.score)} trên 5, ${rating.count.toLocaleString('vi-VN')} lượt`;

  if (variant === 'full') {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`} title={said}>
        <span className="sr-only">{said}</span>
        <StarRow score={rating.score} size={15} />
        <span aria-hidden className="text-[14px] tabular-nums">
          <span className="font-medium text-[var(--color-ink)]">{formatScore(rating.score)}</span>
          <span className="text-[var(--color-faint)]">/5</span>
        </span>
        <span aria-hidden className="text-[12.5px] text-[var(--color-faint)]">
          · {rating.count.toLocaleString('vi-VN')} lượt đánh giá
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${className}`}
      title={said}
    >
      <span className="sr-only">{said}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="text-[var(--color-accent)]">
        <path d={STAR} />
      </svg>
      <span aria-hidden className="text-[var(--color-ink)]">{formatScore(rating.score)}</span>
      <span aria-hidden className="text-[var(--color-faint)]">({formatCount(rating.count)})</span>
    </span>
  );
}
