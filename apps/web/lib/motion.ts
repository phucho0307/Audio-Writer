'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

/**
 * One place where the plugins are registered.
 *
 * Registering in each component means registering on every mount, and
 * `useGSAP` has to be registered too or its automatic cleanup does not run -
 * which is how ScrollTriggers survive a route change, pile up, and start
 * firing against elements that are no longer on the page.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger);

  // Positions are measured in pixels, and a web font landing after that
  // measurement moves everything below it. Re-measuring once the fonts are in
  // is the documented fix and the difference between triggers that fire where
  // they should and triggers that fire half a screen early.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

export const MOTION_KEY = 'aw-motion';
export const MOTION_EVENT = 'aw-motion-change';

export type MotionPref = 'full' | 'calm' | 'system';

/**
 * Three states, like the theme.
 *
 * The operating system's setting is the default and is honoured, because
 * animation genuinely makes some people ill. But it is a blunt switch - a
 * machine with Windows' "show animations" turned off asks every site for
 * stillness, including from someone who came here for the atmosphere - so the
 * reader can also say so explicitly, in either direction, and that answer wins
 * over the system's.
 */
export function motionPref(): MotionPref {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    if (v === 'full' || v === 'calm') return v;
  } catch {
    // Storage blocked. Fall through to the system setting.
  }
  return 'system';
}

/** True when this reader should be left in stillness. */
export function calm(): boolean {
  if (typeof window === 'undefined') return true;
  const pref = motionPref();
  if (pref === 'full') return false;
  if (pref === 'calm') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Write the choice, mirror it onto <html>, and tell the page. */
export function setMotionPref(pref: MotionPref): void {
  try {
    if (pref === 'system') localStorage.removeItem(MOTION_KEY);
    else localStorage.setItem(MOTION_KEY, pref);
  } catch {
    // The choice still applies for this page view, which is the useful half.
  }
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', pref);
  window.dispatchEvent(new Event(MOTION_EVENT));
}

export { gsap, ScrollTrigger, useGSAP };
