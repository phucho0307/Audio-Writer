'use client';

import { useEffect, useRef } from 'react';
import { calm } from '@/lib/motion';

/**
 * A voice, drawn.
 *
 * Bars that move the way speech does - in phrases, with pauses - rather than
 * the uniform pulse of a music visualiser, because what this product plays is
 * a person (or a voice like one) telling a story. Two slow envelopes multiply
 * a fast one: the fast one is syllables, the slow ones are breath and phrase.
 *
 * Canvas rather than sixty DOM nodes, and it stops drawing when it is off
 * screen or the tab is hidden. Under reduced motion it draws one still frame.
 */
export default function Waveform({
  bars = 56,
  height = 64,
  className = '',
}: {
  bars?: number;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let visible = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const size = () => {
      const w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
    };
    size();

    // Re-read when the reader switches night and day. Read once, the bars
    // kept the dark theme's gold and grey on the paper background.
    let gold = '#c8a24e';
    let dim = '#2c313c';
    const readColours = () => {
      const css = getComputedStyle(document.documentElement);
      gold = css.getPropertyValue('--color-accent').trim() || gold;
      dim = css.getPropertyValue('--color-line-strong').trim() || dim;
    };
    readColours();
    const themes = new MutationObserver(() => {
      readColours();
      if (calm()) draw(9000);
    });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const draw = (t: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const gap = w / bars;
      const bw = Math.max(1.5 * dpr, gap * 0.48);

      for (let i = 0; i < bars; i++) {
        const x = i / bars;
        // Phrase and breath: slow envelopes that open and close the voice.
        const phrase = 0.55 + 0.45 * Math.sin(t * 0.0011 + x * 3.1);
        const breath = 0.6 + 0.4 * Math.sin(t * 0.0004 + x * 1.3 + 1.7);
        // Syllables: fast and jittery, different per bar.
        const syl =
          0.5 +
          0.5 *
            Math.abs(
              Math.sin(t * 0.009 + i * 1.7) * Math.cos(t * 0.0063 + i * 0.9),
            );
        const amp = Math.max(0.06, phrase * breath * syl);
        const bh = amp * h * 0.92;

        // The played part is gold, the rest waits in grey - a waveform that
        // is also a progress bar.
        const played = x < ((t * 0.00004) % 1);
        ctx.fillStyle = played ? gold : dim;
        ctx.globalAlpha = played ? 1 : 0.9;
        const r = bw / 2;
        const y = (h - bh) / 2;
        ctx.beginPath();
        ctx.roundRect(i * gap + (gap - bw) / 2, y, bw, bh, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const still = calm();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      draw(t);
    };

    if (still) draw(9000);
    else raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const onResize = () => {
      size();
      if (still) draw(9000);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      themes.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [bars, height]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`block w-full ${className}`}
      style={{ height }}
    />
  );
}
