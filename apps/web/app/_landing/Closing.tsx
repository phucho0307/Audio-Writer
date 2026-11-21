'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { calm, gsap, useGSAP } from '@/lib/motion';
import Reveal from '../Reveal';
import Magnetic from './Magnetic';

/**
 * Every answer here is true of the app as it stands. A landing page that
 * promises what the product does not do is the fastest way to lose the
 * people it was written for.
 */
const FAQ = [
  {
    q: 'Sử dụng có mất phí không?',
    a: 'Bạn có thể đọc và nghe các chương miễn phí. Nội dung có thu phí được mở bằng credit.',
  },
  {
    q: 'Bạn có cần dùng AI để viết truyện?',
    a: 'Bạn có thể tự viết hoặc dùng AI gợi ý, viết tiếp. Bạn quyết định nội dung được đăng.',
  },
  {
    q: 'Rẽ nhánh có thay đổi bản gốc không?',
    a: 'Bản gốc được giữ nguyên. Nhánh mới bắt đầu từ chương bạn chọn và ghi tên bạn.',
  },
  {
    q: 'Ai có thể đăng chương khi viết chung?',
    a: 'Chủ truyện đăng vào truyện chính. Chương do người được mời đăng sẽ thành nhánh riêng mang tên người đó.',
  },
  {
    q: 'Truyện trong thư viện lấy từ đâu?',
    a: 'Thư viện gồm truyện gốc và tác phẩm được phép đăng lại. Bạn có thể xem tác giả và nguồn trong từng truyện.',
  },
  {
    q: 'Bạn có thể đăng nhập bằng cách nào?',
    a: 'Bạn có thể dùng email và mật khẩu hoặc tài khoản Google. Các chương miễn phí không yêu cầu đăng nhập.',
  },
];

/**
 * An answer that opens by animating its row height.
 *
 * `grid-template-rows: 0fr -> 1fr` rather than measuring heights in script:
 * the browser animates to the content's natural size, whatever the text wraps
 * to on this screen.
 */
function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--color-line)]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-6 py-5 text-left"
      >
        <span className="display text-[clamp(1.15rem,2vw,1.45rem)] transition-colors group-hover:text-[var(--color-accent)]">
          {q}
        </span>
        <span
          aria-hidden
          className={`grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-accent)] transition-transform duration-300 ${
            open ? 'rotate-45' : ''
          }`}
        >
          +
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-[62ch] pb-6 text-[15px] leading-[1.75] text-[var(--color-muted)]">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function Faq() {
  return (
    <section className="mx-auto grid max-w-[1180px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
      <Reveal className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
        <span className="label label-accent">Hỗ trợ</span>
        <h2 className="display text-[clamp(2rem,4vw,3.2rem)] leading-[1.04]">
          Câu hỏi <span className="italic text-[var(--color-accent)]">thường gặp</span>.
        </h2>
      </Reveal>
      <div>
        {FAQ.map((f) => (
          <Item key={f.q} {...f} />
        ))}
      </div>
    </section>
  );
}

/**
 * The last screen: one question, set huge, that tightens as it arrives.
 * Letter-spacing and opacity are scrubbed to the scrollbar, so the line
 * gathers itself out of the fog as the reader reaches the bottom.
 */
export function FinalCta() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;
      gsap.fromTo(
        '[data-final]',
        { letterSpacing: '0.18em', opacity: 0.15, filter: 'blur(8px)' },
        {
          letterSpacing: '-0.02em',
          opacity: 1,
          filter: 'blur(0px)',
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top 85%', end: 'center 55%', scrub: true },
        },
      );
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative overflow-hidden px-5 pb-32 pt-24 text-center sm:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50 blur-[120px]"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 30%, transparent), transparent 65%)' }}
      />
      <div className="relative mx-auto flex max-w-[960px] flex-col items-center gap-8">
        <h2
          data-final
          className="display text-[clamp(3rem,10vw,8.5rem)] leading-[0.95] [font-variation-settings:'SOFT'_100,'WONK'_1]"
        >
          Bạn muốn <span className="italic text-[var(--color-accent)]">nghe gì?</span>
        </h2>
        <p className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--color-muted)]">
          Chọn truyện bạn thích và bắt đầu nghe.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Magnetic>
            <Link href="/kham-pha" className="btn btn-primary btn-lg">
              Khám phá truyện
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="/cua-toi" className="btn btn-ghost btn-lg">
              Viết truyện đầu tiên
            </Link>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
