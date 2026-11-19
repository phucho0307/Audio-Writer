'use client';

import { useRef, type ElementType, type ReactNode } from 'react';
import { calm, gsap, lowPower, useGSAP } from '@/lib/motion';

/**
 * Brings a block up out of the dark as it is reached.
 *
 * The hidden state is set by GSAP at runtime, never in CSS. That ordering is
 * the whole trick: with JavaScript the block is hidden a frame before it
 * animates, and without JavaScript - or with it broken - the page is plain
 * text that is simply visible, rather than a screen of invisible divs.
 *
 * `useGSAP` reverts everything and kills the ScrollTrigger on unmount, which
 * matters on an app that changes route without reloading.
 */
export default function Reveal({
  children,
  as: Tag = 'div',
  className,
  delay = 0,
  stagger = 0.06,
  y = 16,
  blur = true,
  /** Animate each direct child in turn instead of the block as one piece. */
  childrenStagger = false,
  deps = [],
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: number;
  y?: number;
  blur?: boolean;
  childrenStagger?: boolean;
  /**
   * Values that change what is inside.
   *
   * Content that arrives from the network after mount is the trap here: the
   * trigger gets built against an empty container, measures it wherever a
   * zero-height box happens to sit, and then never fires - leaving the block
   * on opacity 0 with the content invisible underneath. Listing the dependency
   * rebuilds and re-measures it once the content is really there.
   */
  deps?: unknown[];
}) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || calm()) return;

      const targets =
        childrenStagger && el.children.length > 0
          ? (Array.from(el.children) as HTMLElement[])
          : el;

      gsap.from(targets, {
        opacity: 0,
        y,
        // A touch of blur reads as something resolving out of fog rather than
        // a box sliding in, which is the difference between this site and a
        // dashboard.
        // Not on a phone: animating a filter repaints the element every frame,
        // which across a grid of covers is the scroll stutter.
        filter: blur && !lowPower() ? 'blur(7px)' : 'none',
        duration: 0.85,
        delay,
        stagger: childrenStagger ? stagger : 0,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          // Just inside the fold: an element that animates only once fully on
          // screen has already been read by the time it moves.
          start: 'top 88%',
          toggleActions: 'play none none none',
          once: true,
        },
      });
    },
    { scope: root, dependencies: deps, revertOnUpdate: true },
  );

  return (
    <Tag ref={root} className={className}>
      {children}
    </Tag>
  );
}
