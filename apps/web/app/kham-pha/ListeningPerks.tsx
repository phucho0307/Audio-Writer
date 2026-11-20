import { TRACKS } from '@/lib/background-music';

/**
 * What listening here is like, said once near the top of the shelf: no ads
 * cutting into a chapter, and music the listener picks. Both are what sets
 * the site apart from the same story narrated on a video platform, and
 * neither shows until someone opens a chapter's settings, so it is said here.
 */
const PERKS = [
  {
    title: 'Không quảng cáo',
    body: 'Nghe liền mạch từ chương đầu đến chương cuối, không có gì chen ngang giữa câu chuyện.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M6 6l12 12" />
      </>
    ),
  },
  {
    title: 'Tự chọn nhạc nền',
    body: `${TRACKS.length} bản nhạc nền phát dưới giọng đọc, âm lượng chỉnh riêng. Đổi bài hoặc tắt trong nút Tuỳ chỉnh của trình phát.`,
    icon: (
      <>
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
      </>
    ),
  },
  {
    title: 'Nghe theo cách của bạn',
    body: 'Chọn giọng đọc, tốc độ, hẹn giờ tắt và tự chuyển chương khi nghe hết.',
    icon: (
      <>
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </>
    ),
  },
];

export default function ListeningPerks() {
  return (
    <section aria-label="Nghe truyện trên trang này" className="grid gap-3 sm:grid-cols-3">
      {PERKS.map((p) => (
        <div
          key={p.title}
          className="flex gap-3.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-surface)_70%,transparent)] p-4"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {p.icon}
            </svg>
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{p.title}</h3>
            <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">{p.body}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
