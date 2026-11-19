'use client';

import { useEffect, useState } from 'react';
import { calm, MOTION_EVENT, setMotionPref } from '@/lib/motion';

/**
 * Atmosphere on or off.
 *
 * Effects are on by default, whatever the operating system's reduced-motion
 * setting says (see calm() in lib/motion.ts). This is how a reader who finds
 * the drifting fog unpleasant switches it off, and the choice is remembered.
 *
 * Whichever way it is pressed it writes an explicit answer, so the control
 * always does what it looks like it does.
 */
export default function MotionToggle() {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setOn(!calm());
    sync();
    setReady(true);
    window.addEventListener(MOTION_EVENT, sync);
    return () => window.removeEventListener(MOTION_EVENT, sync);
  }, []);

  function flip() {
    setMotionPref(on ? 'calm' : 'full');
  }

  return (
    <button
      onClick={flip}
      aria-pressed={ready ? on : undefined}
      aria-label={on ? 'Tắt hiệu ứng nền' : 'Bật hiệu ứng nền'}
      title={on ? 'Tắt hiệu ứng nền' : 'Bật hiệu ứng nền'}
      className={`btn btn-quiet px-2 py-1.5 ${
        ready && on ? 'text-[var(--color-accent)]' : ''
      }`}
    >
      {/* Drifting smoke when it is on; a single flat line when it is not. */}
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden
      >
        {ready && on ? (
          <>
            <path d="M3 8.5c3-2.2 5.5 2.2 8.5 0s5.5 2.2 8.5 0" />
            <path d="M3 13c3-2.2 5.5 2.2 8.5 0s5.5 2.2 8.5 0" opacity="0.65" />
            <path d="M3 17.5c3-2.2 5.5 2.2 8.5 0s5.5 2.2 8.5 0" opacity="0.4" />
          </>
        ) : (
          <>
            <path d="M3 12h18" />
            <path d="M3 12h18" opacity="0" />
          </>
        )}
      </svg>
    </button>
  );
}
