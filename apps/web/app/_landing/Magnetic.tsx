'use client';

import { useRef, type ReactNode } from 'react';
import { calm, gsap, useGSAP } from '@/lib/motion';

/**
 * Pulls its child toward the pointer, a little, and lets it spring back.
 *
 * For the two or three calls to action on the landing page and nothing else -
 * a button that leans toward you is an invitation, and an invitation repeated
 * on every control is noise. `quickTo` retargets one tween per axis rather
 * than creating one per pointer event.
 */
export default function Magnetic({
  children,
  strength = 0.35,
  className = '',
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const x = useRef<((v: number) => void) | null>(null);
  const y = useRef<((v: number) => void) | null>(null);

  useGSAP(
    () => {
      if (!el.current || calm()) return;
      x.current = gsap.quickTo(el.current, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.45)' });
      y.current = gsap.quickTo(el.current, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.45)' });
    },
    { scope: el },
  );

  return (
    <span
      ref={el}
      className={`inline-block ${className}`}
      onPointerMove={(e) => {
        if (e.pointerType === 'touch' || !el.current) return;
        const r = el.current.getBoundingClientRect();
        x.current?.((e.clientX - (r.left + r.width / 2)) * strength);
        y.current?.((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.current?.(0);
        y.current?.(0);
      }}
    >
      {children}
    </span>
  );
}
