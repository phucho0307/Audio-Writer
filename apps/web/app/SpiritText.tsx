'use client';

import { useMemo, useRef, type ElementType } from 'react';
import { calm, gsap, useGSAP } from '@/lib/motion';

/**
 * A heading that surfaces letter by letter.
 *
 * Split by grapheme, not by code unit. Vietnamese stacks a tone mark on a
 * vowel that may already carry a diacritic, and when those arrive decomposed a
 * naive `split('')` tears the mark off its letter and scatters it across the
 * line - the one way a text effect can turn a Vietnamese headline into
 * nonsense. `Intl.Segmenter` keeps each written character whole.
 *
 * The real text stays in the accessibility tree through `aria-label`, and
 * every piece of the split is hidden from it, so a screen reader hears one
 * heading rather than forty letters.
 */
export default function SpiritText({
  text,
  as: Tag = 'h1',
  className,
  delay = 0,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
}) {
  const root = useRef<HTMLElement>(null);

  // Words hold the line breaks; letters inside them do the moving.
  const words = useMemo(() => {
    const split = (s: string): string[] => {
      if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const seg = new Intl.Segmenter('vi', { granularity: 'grapheme' });
        return [...seg.segment(s)].map((g) => g.segment);
      }
      return [...s];
    };
    return text.split(' ').map(split);
  }, [text]);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;

      gsap.from(el.querySelectorAll('[data-ch]'), {
        opacity: 0,
        yPercent: 55,
        filter: 'blur(10px)',
        duration: 0.9,
        delay,
        ease: 'power3.out',
        // From the start of the line outwards, slightly uneven, so it reads as
        // something arriving rather than a wipe.
        stagger: { each: 0.028, from: 'start' },
      });
    },
    { scope: root },
  );

  return (
    <Tag ref={root} className={className} aria-label={text}>
      {words.map((chars, w) => (
        <span
          key={w}
          aria-hidden
          // Each word is its own inline-block so the line still wraps between
          // words and never inside one.
          className="inline-block whitespace-nowrap"
        >
          {chars.map((c, i) => (
            <span key={i} data-ch className="inline-block will-change-transform">
              {c}
            </span>
          ))}
          {w < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </Tag>
  );
}
