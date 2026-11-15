'use client';

import { useRef } from 'react';
import { calm, gsap, useGSAP } from '@/lib/motion';

const STEPS = [
  {
    n: '01',
    title: 'Lướt Khám phá',
    body: 'Nhìn ảnh bìa là biết bộ nào rén. Mấy chương đầu đọc free, khỏi đăng nhập, khỏi suy nghĩ.',
    glyph: '◐',
  },
  {
    n: '02',
    title: 'Bấm nghe',
    body: 'Giọng AI đọc cho, tua 1.5× cho đã. Trong lúc đọc, sương mù trên web tự dày lên theo.',
    glyph: '▶',
  },
  {
    n: '03',
    title: 'Tức cái kết? Rẽ nhánh',
    body: 'Chọn chương cuối muốn giữ, viết tiếp theo hướng của bà. Bí thì có AI nhắc bài.',
    glyph: '⑂',
  },
  {
    n: '04',
    title: 'Rủ hội bạn vô viết',
    body: 'Mời bằng @username, cả đám gõ chung một trang. Xong bấm đăng cho cả thread city đọc.',
    glyph: '✦',
  },
];

/**
 * How it goes, as a sideways journey.
 *
 * On a wide screen the section pins and the four steps slide past as the
 * reader scrolls - the order is the content here, so it is given a direction.
 * Per the ScrollTrigger rules: the pinned element is the section, what moves
 * is its child, the horizontal tween eases with "none" so it stays locked to
 * the scrollbar, and the distance is a function so a resize re-measures it.
 *
 * Narrow screens and reduced motion get the same steps stacked, unpinned -
 * horizontal scroll-jacking on a phone fights the thumb.
 */
export default function Journey() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        const track = el.querySelector<HTMLElement>('[data-track]');
        if (!track) return;
        const distance = () => track.scrollWidth - el.clientWidth;

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: 'top top',
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        });
        tl.to(track, { x: () => -distance(), ease: 'none' }, 0).fromTo(
          '[data-progress]',
          { scaleX: 0 },
          { scaleX: 1, ease: 'none' },
          0,
        );

        // Each panel's number drifts against the travel, so the panels have
        // a foreground and a background.
        gsap.utils.toArray<HTMLElement>('[data-num]', el).forEach((n) => {
          gsap.fromTo(n, { xPercent: 30 }, {
            xPercent: -30,
            ease: 'none',
            scrollTrigger: {
              trigger: n.parentElement,
              containerAnimation: tl,
              start: 'left right',
              end: 'right left',
              scrub: true,
            },
          });
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative overflow-hidden lg:h-screen">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 pt-16 sm:px-8 lg:absolute lg:inset-x-0 lg:top-0 lg:z-10 lg:pt-24">
        <span className="label label-accent">Cách chơi</span>
        <h2 className="display text-[clamp(2rem,4vw,3.2rem)] leading-[1.04]">
          Bốn bước, từ <span className="italic text-[var(--color-accent)]">người nghe</span> thành{' '}
          <span className="italic text-[var(--color-accent)]">người viết</span>.
        </h2>
        <div className="mt-4 hidden h-px w-full bg-[var(--color-line)] lg:block">
          <div data-progress className="h-px origin-left bg-[var(--color-accent)]" />
        </div>
      </div>

      <div
        data-track
        className="flex flex-col gap-5 px-5 py-12 sm:px-8 lg:h-full lg:w-max lg:flex-row lg:items-center lg:gap-8 lg:px-[max(2rem,calc((100vw-1180px)/2))] lg:pt-48"
      >
        {STEPS.map((s) => (
          <article
            key={s.n}
            className="card relative flex flex-col justify-end gap-4 overflow-hidden p-7 lg:h-[56vh] lg:w-[min(560px,42vw)] lg:p-10"
          >
            <span
              data-num
              aria-hidden
              className="display outline-text pointer-events-none absolute -right-4 -top-8 select-none text-[clamp(7rem,15vw,13rem)] leading-none"
            >
              {s.n}
            </span>
            <span
              aria-hidden
              className="grid h-12 w-12 place-items-center rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[20px] text-[var(--color-accent)]"
            >
              {s.glyph}
            </span>
            <span className="label">Bước {s.n}</span>
            <h3 className="display text-[clamp(1.6rem,2.6vw,2.3rem)] leading-tight">{s.title}</h3>
            <p className="max-w-[40ch] text-[15px] leading-relaxed text-[var(--color-muted)]">{s.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
