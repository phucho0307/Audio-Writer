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
    q: 'Có tốn tiền hông bà?',
    a: 'Nghe với đọc mấy chương đầu là free, khỏi đăng nhập. Tác giả nào muốn khoá phần sau thì khoá, mở bằng credit. Viết truyện với rẽ nhánh thì hông tốn gì, AI gợi ý có lượt free mỗi ngày.',
  },
  {
    q: 'AI viết hết thì còn gì là truyện của mình?',
    a: 'Bà chọn dùng AI tới đâu: gợi ý hướng đi, viết tiếp một đoạn, hoặc tự viết từ đầu. Bản đăng do bà đọc lại, sửa và quyết định.',
  },
  {
    q: 'Rẽ nhánh có làm hư truyện gốc hông?',
    a: 'Khum. Bản gốc giữ nguyên tới từng dấu phẩy. Nhánh là của bà, có tag tên bà, nằm ngay dưới cái chương mà bà rẽ ra cho người sau thấy.',
  },
  {
    q: 'Rủ bạn viết chung thì ai được đăng?',
    a: 'Chủ truyện đăng vào truyện chính. Bạn được mời mà bấm đăng thì chương thành nhánh riêng mang tên nó, hông chen vô truyện của bà được. Hội bạn thân cũng phải có ranh giới chứ.',
  },
  {
    q: 'Truyện trên đây có chôm từ kênh khác hông?',
    a: 'Khum nha. Nội dung trong thư viện được viết riêng cho nền tảng. Tủ tham khảo chỉ dẫn link mấy kênh audio để bà đi nghe học nghề, tụi tui hông copy truyện của ai.',
  },
  {
    q: 'Đăng nhập kiểu gì?',
    a: 'Bằng Google, một cú bấm. Muốn đọc với nghe thôi thì khỏi đăng nhập luôn.',
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
        <span className="label label-accent">Hỏi lẹ đáp lẹ</span>
        <h2 className="display text-[clamp(2rem,4vw,3.2rem)] leading-[1.04]">
          Mấy câu hội mình <span className="italic text-[var(--color-accent)]">hay hỏi</span>.
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
          Đêm nay <span className="italic text-[var(--color-accent)]">nghe gì?</span>
        </h2>
        <p className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--color-muted)]">
          Đeo tai nghe, chọn một bộ hợp gu. Kết mà dở thì… bà biết phải làm gì rồi đó.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Magnetic>
            <Link href="/kham-pha" className="btn btn-primary btn-lg">
              Vào Khám phá
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
