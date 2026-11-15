'use client';

import { useRef } from 'react';
import { calm, gsap, ScrollTrigger, useGSAP } from '@/lib/motion';
import { BRAND } from '@/lib/brand';

const ROW_A = ['kinh dị', 'ngoại tình', 'tâm linh', 'bùa ngải', 'giật gân', 'trinh thám'];
const ROW_B = ['báo thù', 'trọng sinh', 'nhà có ma', 'mạt thế', 'tiểu tam', 'ngôn tình ngược'];

/**
 * The genres, as a wall.
 *
 * Two rows running opposite ways forever, and both of them reacting to the
 * scrollbar: scroll fast and they speed up and lean into the direction of
 * travel, then settle back. The words are outlined rather than filled so a
 * screen of them reads as texture - one word per row is lit in gold.
 *
 * Each row's contents are rendered twice and moved by exactly half their
 * width, which is what makes the loop seamless.
 */
export default function Marquee() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;
      const [a, b] = gsap.utils.toArray<HTMLElement>('[data-track]', el);
      if (!a || !b) return;

      const ta = gsap.to(a, { xPercent: -50, duration: 46, ease: 'none', repeat: -1 });
      const tb = gsap.fromTo(b, { xPercent: -50 }, { xPercent: 0, duration: 52, ease: 'none', repeat: -1 });

      const skew = gsap.quickTo([a, b], 'skewX', { duration: 0.5, ease: 'power3' });
      // One pending "settle" at a time. Scroll fires dozens of updates a
      // second, and a new delayed call per update would pile up hundreds.
      let settle: gsap.core.Tween | null = null;

      ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: (self) => {
          const v = self.getVelocity();
          const boost = 1 + Math.min(Math.abs(v) / 400, 5);
          ta.timeScale(boost);
          tb.timeScale(boost);
          skew(gsap.utils.clamp(-10, 10, v / -180));
          // Ease back to cruising speed once the scrolling stops.
          gsap.to([ta, tb], { timeScale: 1, duration: 1.2, ease: 'power2.out', overwrite: true, delay: 0.1 });
          settle?.kill();
          settle = gsap.delayedCall(0.15, () => skew(0));
        },
      });
    },
    { scope: root },
  );

  const row = (words: string[], lit: number) =>
    [...words, ...words].map((w, i) => (
      <span key={i} className="flex items-center gap-[0.4em] pr-[0.4em]">
        <span className={i % words.length === lit ? 'outline-text-accent' : 'outline-text'}>{w}</span>
        <span aria-hidden className="text-[0.35em] text-[var(--color-accent)]">✦</span>
      </span>
    ));

  return (
    <section
      ref={root}
      aria-label={`Thể loại trên ${BRAND}`}
      className="relative overflow-hidden border-y border-[var(--color-line)] py-8"
    >
      <div className="display flex flex-col gap-1 text-[clamp(3rem,9vw,7.5rem)] leading-[1.02] [font-variation-settings:'SOFT'_100,'WONK'_1]">
        <div data-track className="flex w-max whitespace-nowrap will-change-transform">
          {row(ROW_A, 1)}
        </div>
        <div data-track className="flex w-max whitespace-nowrap italic will-change-transform">
          {row(ROW_B, 4)}
        </div>
      </div>
      {/* Edges fade into the ground so the words seem to come out of the
          dark rather than off the edge of a box. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[12%] bg-gradient-to-r from-[var(--color-ground)] to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[12%] bg-gradient-to-l from-[var(--color-ground)] to-transparent" />
    </section>
  );
}
