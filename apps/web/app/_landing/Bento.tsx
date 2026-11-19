'use client';

import { useRef, type ReactNode } from 'react';
import Link from 'next/link';
import type { HomeTotals, Story } from '@/lib/api';
import { calm, gsap, useGSAP } from '@/lib/motion';
import Reveal from '../Reveal';

/**
 * A tile with a light that follows the pointer.
 *
 * The light is a radial gradient positioned from two custom properties set on
 * pointer move - no element moves and nothing re-renders, so a grid of them
 * costs a style write per event.
 */
function Tile({
  children,
  className = '',
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const body = (
    <div
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--sx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--sy', `${e.clientY - r.top}px`);
      }}
      className={`card group relative flex h-full flex-col gap-3 overflow-hidden p-6 transition-colors hover:border-[var(--color-accent-line)] ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(320px circle at var(--sx, 50%) var(--sy, 50%), color-mix(in oklab, var(--color-accent) 13%, transparent), transparent 70%)',
        }}
      />
      <div className="relative flex h-full flex-col gap-3">{children}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid h-10 w-10 place-items-center rounded-full border border-[var(--color-accent-line)] text-[17px] text-[var(--color-accent)]"
    >
      {children}
    </span>
  );
}

/**
 * Counts up to a real number when it scrolls into view.
 *
 * Real numbers only: these are summed from the live catalogue on this page.
 * A landing page's counters are the first thing a sceptical reader checks,
 * and an invented "10.000+ người đang nghe" is the first thing to lose them.
 */
function Count({ value, label }: { value: number; label: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const node = el.current;
      if (!node) return;
      const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
      if (calm()) {
        node.textContent = fmt(value);
        return;
      }
      const state = { n: 0 };
      gsap.to(state, {
        n: value,
        duration: 1.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: node, start: 'top 90%', once: true },
        onUpdate: () => {
          node.textContent = fmt(state.n);
        },
      });
    },
    { dependencies: [value], revertOnUpdate: true },
  );
  return (
    <div className="flex flex-col gap-1 border-l border-[var(--color-line)] pl-5">
      <span ref={el} className="display text-[clamp(2.2rem,4.5vw,3.6rem)] leading-none tabular-nums text-[var(--color-ink)]">
        {value.toLocaleString('vi-VN')}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}

/** What people actually type, drifting across the tile: it shows the feature by example. */
const ASKS = [
  'truyện buồn, chồng ngoại tình có con với bé ba',
  'ma làng quê, đọc xong không dám ngủ',
  'ngôn tình nhẹ nhàng, kết có hậu',
  'trọng sinh báo thù, nữ chính mạnh mẽ',
  'cổ đại cung đấu, kết mở',
  'chữa lành, nghe trước khi ngủ',
];

function AskChips() {
  return (
    <div aria-hidden className="flex flex-wrap gap-2 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
      {ASKS.map((q, i) => (
        <span
          key={q}
          className="chip cursor-default animate-[drift_6s_ease-in-out_infinite]"
          style={{ animationDelay: `${(i % 5) * -1.1}s` }}
        >
          “{q}”
        </span>
      ))}
    </div>
  );
}

export default function Bento({ stories, totals }: { stories: Story[]; totals?: HomeTotals }) {
  const count = totals?.stories ?? stories.length;
  const chapters = totals?.chapters ?? stories.reduce((n, s) => n + s.contributionCount, 0);
  const forks = totals?.forks ?? stories.reduce((n, s) => n + Math.max(0, s.branchCount - 1), 0);
  const words = totals?.words ?? stories.reduce((n, s) => n + s.wordCount, 0);

  return (
    <section className="mx-auto flex max-w-[1180px] flex-col gap-14 px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="flex max-w-[60ch] flex-col gap-4">
        <span className="label label-accent">Mấy cái lặt vặt mà xịn</span>
        <h2 className="display text-[clamp(2rem,4vw,3.2rem)] leading-[1.04]">
          Làm kỹ từng góc nhỏ,{' '}
          <span className="italic text-[var(--color-accent)]">vì hội mọt khó tính lắm.</span>
        </h2>
      </Reveal>

      <Reveal childrenStagger stagger={0.07} className="grid auto-rows-[minmax(190px,auto)] gap-4 md:grid-cols-3">
        <div className="md:col-span-2 md:row-span-2">
          <Tile href="/kham-pha?tim=ai" className="justify-between">
            <Glyph>✦</Glyph>
            <AskChips />
            <div className="mt-auto flex flex-col gap-3">
              <h3 className="display text-[clamp(1.6rem,3vw,2.4rem)] leading-tight">
                Tả truyện bằng lời, <span className="italic text-[var(--color-accent)]">AI tìm giùm</span>
              </h3>
              <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
                Hông nhớ tên, hông biết thể loại gì? Cứ gõ như kể cho bạn thân nghe: muốn buồn hay vui,
                kết có hậu hay kết mở, có bé ba hay hông. AI đọc hết thư viện rồi nói luôn vì sao truyện
                đó hợp với bà, truyện nào không hợp thì giấu đi.
              </p>
              <span className="text-[13px] text-[var(--color-accent)] transition-transform group-hover:translate-x-1">
                Thử tìm bằng AI →
              </span>
            </div>
          </Tile>
        </div>
        <Tile>
          <Glyph>☾</Glyph>
          <h3 className="display text-[21px]">Đêm hay ngày tuỳ bà</h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
            Mặc định nền tối cho dịu mắt lúc đọc khuya. Muốn đọc giờ nghỉ trưa thì bấm cái trăng trên góc.
          </p>
        </Tile>
        <Tile>
          <Glyph>≈</Glyph>
          <h3 className="display text-[21px]">Web biết nghe</h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
            Lớp sương phía sau trang dày lên, đèn sáng hơn khi truyện đang được đọc. Tắt tiếng là nó dịu lại.
          </p>
        </Tile>
        <Tile>
          <Glyph>@</Glyph>
          <h3 className="display text-[21px]">Ai viết ghi tên người đó</h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
            Chương nào, nhánh nào cũng có @username của người viết. Hông ai lấy công của ai.
          </p>
        </Tile>
        <Tile>
          <Glyph>♪</Glyph>
          <h3 className="display text-[21px]">Đổi giọng đọc</h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
            Giọng nữ trầm ấm, giọng nam khàn khàn, chọn giọng hợp không khí truyện rồi nghe lại từ đầu.
          </p>
        </Tile>
        <Tile>
          <Glyph>✎</Glyph>
          <h3 className="display text-[21px]">Bản gốc hông bao giờ mất</h3>
          <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
            Truyện đã đăng thì khoá lại, muốn sửa phải tạo bản sửa. Hông ai lỡ tay xoá mất chương của bà.
          </p>
        </Tile>
      </Reveal>

      {count > 0 && (
        <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
          <Count value={count} label="truyện đang có" />
          <Count value={chapters} label="chương đã đăng" />
          <Count value={forks} label="nhánh rẽ" />
          <Count value={words} label="chữ đã viết" />
        </div>
      )}
    </section>
  );
}
