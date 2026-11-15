'use client';

import { useRef, type ReactNode } from 'react';
import { calm, gsap, useGSAP } from '@/lib/motion';

/**
 * Gives one object on the page some weight under the pointer.
 *
 * Used on the featured cover and nowhere else on purpose. A grid where every
 * card tilts is a demo; one object that responds is a centrepiece, and the
 * stillness of everything around it is what makes it read that way.
 *
 * `gsap.quickTo` rather than a tween per pointer event: it reuses one tween
 * and retargets it, so a pointer firing at the display's refresh rate does not
 * create a tween per frame. Rotation and the light position are both driven
 * from the same move, so the highlight tracks the face rather than sliding
 * across it.
 */
export default function Tilt({
  children,
  className,
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  /** Degrees at the far edge. */
  max?: number;
}) {
  const plate = useRef<HTMLDivElement>(null);
  const rx = useRef<((v: number) => void) | null>(null);
  const ry = useRef<((v: number) => void) | null>(null);

  useGSAP(
    () => {
      const el = plate.current;
      if (!el || calm()) return;
      const opts = { duration: 0.5, ease: 'power3' };
      rx.current = gsap.quickTo(el, 'rotationX', opts);
      ry.current = gsap.quickTo(el, 'rotationY', opts);
    },
    { scope: plate },
  );

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = plate.current;
    // A coarse pointer is a finger, and a finger is already touching the thing
    // it would be tilting, so there is nothing to preview.
    if (!el || e.pointerType === 'touch') return;

    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;

    ry.current?.(px * max * 2);
    rx.current?.(-py * max * 2);
    el.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--my', `${(py + 0.5) * 100}%`);
  }

  function rest() {
    rx.current?.(0);
    ry.current?.(0);
  }

  return (
    <div className={className} style={{ perspective: '900px' }}>
      <div
        ref={plate}
        onPointerMove={move}
        onPointerLeave={rest}
        className="h-full w-full [transform-style:preserve-3d]"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The light moving across the face, as a child of the framed element so its
 * own `overflow: hidden` clips it to the artwork.
 */
export function Sheen() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      style={{
        background:
          'radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 62%)',
        mixBlendMode: 'screen',
      }}
    />
  );
}
