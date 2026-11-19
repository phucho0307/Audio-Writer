'use client';

import { thumbUrl } from '@/lib/thumb';
import { useRef } from 'react';
import Link from 'next/link';
import type { HomeTotals, Story } from '@/lib/api';
import { calm, gsap, useGSAP } from '@/lib/motion';
import SpiritText from '../SpiritText';
import Magnetic from './Magnetic';
import Waveform from './Waveform';
import { BRAND } from '@/lib/brand';
import { dailyPick } from '@/lib/daily-pick';
import { hasOpened } from '@/lib/progress';

/** Where each cover sits in the fan: angle, offset, depth. */
const FAN = [
  { r: -16, x: -168, y: 34, z: -120 },
  { r: -8, x: -86, y: 10, z: -50 },
  { r: 0, x: 0, y: 0, z: 0 },
  { r: 8, x: 86, y: 10, z: -50 },
  { r: 16, x: 168, y: 34, z: -120 },
];

/**
 * The first screen.
 *
 * Left: what this is, said the way the people it is for talk. Right: the
 * stories themselves - real covers from the catalogue, fanned out in depth,
 * drifting on their own, leaning toward the pointer, and scattering as the
 * page scrolls away. Under them, today's recommended story: a different one
 * each day, and one this reader has not opened yet.
 */
export default function Hero({ stories, totals }: { stories: Story[]; totals?: HomeTotals }) {
  const root = useRef<HTMLElement>(null);
  const covers = stories.filter((s) => s.coverUrl).slice(0, 5);
  // Stories load after mount, so reading which ones this device has opened
  // cannot mismatch a server render.
  const pick = dailyPick(stories, hasOpened);

  // Totals come from the server when the page loaded only its slice of the
  // shelf; summing `stories` would then count just that slice.
  const count = totals?.stories ?? stories.length;
  const chapters = totals?.chapters ?? stories.reduce((n, s) => n + s.contributionCount, 0);
  const forks = totals?.forks ?? stories.reduce((n, s) => n + Math.max(0, s.branchCount - 1), 0);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;
      const cards = gsap.utils.toArray<HTMLElement>('[data-fan-card]', el);
      const fan = el.querySelector<HTMLElement>('[data-fan]');
      if (!fan || !cards.length) return;

      // Dealt in, one at a time, from below.
      gsap.from(cards, {
        y: 160,
        opacity: 0,
        duration: 1.1,
        ease: 'power3.out',
        stagger: 0.09,
      });

      // Each card breathes on its own period, so the fan never moves as one
      // rigid block.
      cards.forEach((c, i) => {
        gsap.to(c, {
          yPercent: i % 2 ? -4 : 4,
          duration: 2.6 + i * 0.45,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: 1.4,
        });
      });

      // Leaning toward the pointer.
      const rx = gsap.quickTo(fan, 'rotationX', { duration: 0.8, ease: 'power3' });
      const ry = gsap.quickTo(fan, 'rotationY', { duration: 0.8, ease: 'power3' });
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 16);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 10);
      };
      el.addEventListener('pointermove', onMove);

      // Scattering as the hero leaves, and the copy rising away - on a wide
      // screen only. There the fan sits beside the headline at the top of the
      // page, so "the hero is leaving" means the reader has moved on. On a
      // phone the fan is stacked *below* the copy: by the time it is on
      // screen the hero is already half scrolled, so it arrived pre-scattered
      // at a quarter opacity and nobody ever saw the fan.
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        // Scattering as the hero leaves: the outer cards travel furthest.
        //
        // On a layer of its own, never the card. This used to tween the card's
        // opacity - the property the deal-in animates - and a scrubbed tween
        // records its starting values when it is created. That moment fell
        // inside the deal-in, while every card sat at opacity 0, so 0 became
        // the scatter's "top of the page" value: scroll down, scroll back up,
        // and all five covers vanished.
        const layers = gsap.utils.toArray<HTMLElement>('[data-fan-scatter]', el);
        layers.forEach((c, i) => {
          const side = i - (layers.length - 1) / 2;
          gsap.to(c, {
            x: `+=${side * 70}`,
            rotation: `+=${side * 6}`,
            opacity: 0.25,
            ease: 'none',
            scrollTrigger: {
              trigger: el,
              start: 'top top',
              end: 'bottom top',
              scrub: true,
            },
          });
        });

        // The copy rises away a little faster than the page, for depth.
        gsap.to('[data-hero-copy]', {
          yPercent: -14,
          opacity: 0.2,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true },
        });

      });
      return () => {
        el.removeEventListener('pointermove', onMove);
        mm.revert();
      };
    },
    { scope: root, dependencies: [covers.length], revertOnUpdate: true },
  );

  return (
    <section
      ref={root}
      className="relative mx-auto grid min-h-[calc(100svh-57px)] max-w-[1180px] items-center gap-14 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-8"
    >
      {/* A slow gold bloom behind the covers - the lamp in the room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-10%] top-[12%] h-[520px] w-[520px] rounded-full opacity-60 blur-[110px] animate-[bloom_9s_ease-in-out_infinite]"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 32%, transparent), transparent 65%)',
        }}
      />

      <div data-hero-copy className="relative flex flex-col items-start gap-7">
        <span className="label label-accent flex items-center gap-2">
          <span className="dot dot-live" aria-hidden />
          dành cho hội mọt truyện đủ mọi gu
        </span>

        <h1 className="display flex flex-col text-[clamp(2.6rem,6.4vw,5.4rem)] leading-[0.98]">
          <SpiritText as="span" text="Nghe truyện theo nhịp của bạn." className="block" />
          <SpiritText
            as="span"
            text="Kết chán thì tự viết lại."
            delay={0.55}
            className="block italic text-[var(--color-accent)] [font-variation-settings:'SOFT'_100,'WONK'_1]"
          />
        </h1>

        <p className="max-w-[50ch] text-[16px] leading-[1.7] text-[var(--color-muted)]">
          {BRAND} là chỗ tụ tập của hội mê truyện, từ{' '}
          <span className="text-[var(--color-ink)]">ngôn tình, trinh thám, kinh dị, tuổi học trò</span>{' '}
          tới truyện Trung trà xanh, trọng sinh. Nghe bằng giọng đọc AI, gặp cái kết làm mình tức thì
          rẽ nhánh viết kết mới,
          rủ bạn thân viết chung một trang y như Google Docs. Hông cần văn hay, chỉ cần lắm
          chuyện.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Magnetic>
            <Link href="/kham-pha" className="btn btn-primary btn-lg">
              Nghe thử liền
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <Link href="/cua-toi" className="btn btn-ghost btn-lg">
              Tui muốn viết
            </Link>
          </Magnetic>
        </div>

        {/* Real counts from the catalogue, not a marketing number. */}
        {count > 0 && (
          <p className="text-[13px] text-[var(--color-faint)]">
            <span className="text-[var(--color-ink)]">{count}</span> truyện ·{' '}
            <span className="text-[var(--color-ink)]">{chapters}</span> chương ·{' '}
            <span className="text-[var(--color-accent)]">⑂ {forks}</span> nhánh rẽ đang chờ bà
          </p>
        )}
      </div>

      <div className="relative flex flex-col items-center gap-10">
        <div className="relative h-[330px] w-full max-w-[520px] sm:h-[380px]" style={{ perspective: '1100px' }}>
          {/* `--spread` narrows the fan on a phone. At full width the outer
              cards sit 168px either side of centre, which on a 376px screen
              cut three of the five off at the edges. */}
          <div data-fan className="absolute inset-0 [--spread:0.55] [transform-style:preserve-3d] sm:[--spread:1]">
            {covers.map((s, i) => {
              const f = FAN[i + Math.floor((FAN.length - covers.length) / 2)] ?? FAN[2];
              return (
                // The slot holds the card's place in the fan; the card inside
                // is what moves. Animating the same transform that positions
                // it would have GSAP parse a 3D matrix back into parts and
                // fight the layout.
                <div
                  key={s.id}
                  className="absolute left-1/2 top-1/2 [transform-style:preserve-3d]"
                  style={{
                    transform: `translate(-50%, -50%) translate3d(calc(${f.x}px * var(--spread)), ${f.y}px, ${f.z}px) rotate(calc(${f.r}deg * var(--spread)))`,
                    zIndex: 10 - Math.abs(i - 2),
                  }}
                >
                <div data-fan-scatter className="[transform-style:preserve-3d]">
                <Link
                  href={`/doc/${s.id}`}
                  data-fan-card
                  className="group block w-[150px] sm:w-[178px]"
                  aria-label={s.title}
                >
                  <div className="cover aspect-[3/4] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.8)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(s.coverUrl!)} alt="" fetchPriority="high" decoding="async" />
                    <span className="scrim">
                      <span className="display line-clamp-2 block text-[14px] leading-tight text-white">
                        {s.title}
                      </span>
                    </span>
                  </div>
                </Link>
                </div>
                </div>
              );
            })}
          </div>
        </div>

        {pick && (
          <Link
            href={`/doc/${pick.id}/1`}
            className="card group relative z-20 flex w-full max-w-[420px] flex-col gap-3 p-4 backdrop-blur-md transition-colors hover:border-[var(--color-accent-line)]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] transition-transform group-hover:scale-110">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="ml-0.5">
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="label">Truyện hay hôm nay</span>
                <span className="display truncate text-[16px]">{pick.title} · Chương 1</span>
              </span>
            </div>
            <Waveform height={44} bars={48} />
          </Link>
        )}
      </div>
    </section>
  );
}
