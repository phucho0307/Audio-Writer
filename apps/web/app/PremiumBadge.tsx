/**
 * Shown beside a premium member's name. Small on purpose: it thanks the
 * people paying for the site, it is not a rank.
 */
export default function PremiumBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const md = size === 'md';
  return (
    <span
      title="Thành viên Premium"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)] ${
        md ? 'px-2 py-0.5 text-[10.5px]' : 'px-1.5 py-px text-[9px]'
      }`}
    >
      <svg width={md ? 11 : 9} height={md ? 11 : 9} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.3 5.8 21.1l1.6-7L2 9.3l7.1-.7z" />
      </svg>
      Premium
    </span>
  );
}
