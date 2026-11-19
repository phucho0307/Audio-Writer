'use client';

import { useEffect, useRef, useState } from 'react';
import { isNarrating, onNarrating } from '@/lib/ambience';
import { useMusicChoice } from '@/lib/background-music';

/**
 * The chosen music, playing whenever a story is being read aloud.
 *
 * Mounted once in the layout rather than in each player, for two reasons:
 * there are two players (the chapter strip and the whole-story playlist) and
 * either can be the one talking; and the layout outlives a page, so moving to
 * the next chapter does not restart the song.
 *
 * It follows narration through the same signal the fog does. When the
 * listener pauses, the music goes with the voice at once. Only when a chapter
 * runs out (and the next may be about to start) does it wait a few seconds
 * before deciding narration is really over, then fade out.
 */
const LINGER_MS = 4_000;
const FADE_IN_MS = 1_200;
const FADE_OUT_MS = 1_200;
/** Out on a pause: quick enough to feel like the same button, not a cut. */
const PAUSE_FADE_MS = 200;

export default function BackgroundMusic() {
  const { track, level } = useMusicChoice();
  const ref = useRef<HTMLAudioElement>(null);
  const [live, setLive] = useState(false);
  // How much of `level` is let through: ramps to 0 before a pause and back up after a play.
  const gain = useRef(0);
  const ramp = useRef(0);
  const fadeOut = useRef(FADE_OUT_MS);

  useEffect(() => {
    setLive(isNarrating());
    let linger: ReturnType<typeof setTimeout> | undefined;
    const stop = onNarrating((on, gap) => {
      clearTimeout(linger);
      if (on) setLive(true);
      else if (gap) {
        linger = setTimeout(() => {
          fadeOut.current = FADE_OUT_MS;
          setLive(false);
        }, LINGER_MS);
      } else {
        fadeOut.current = PAUSE_FADE_MS;
        setLive(false);
      }
    });
    return () => {
      clearTimeout(linger);
      stop();
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = live && track !== null;
    const target = want ? 1 : 0;
    clearInterval(ramp.current);
    if (want && el.paused) {
      gain.current = 0;
      el.volume = 0;
      void el.play().catch(() => {});
    }
    const from = gain.current;
    const start = performance.now();
    const ms = want ? FADE_IN_MS : fadeOut.current;
    // A timer, not animation frames: those stop in a hidden tab or behind a
    // locked screen, which is exactly where a listener pauses from, and the
    // music would then play on with nothing to stop it.
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      gain.current = from + (target - from) * t;
      el.volume = Math.max(0, Math.min(1, level * gain.current));
      if (t < 1) return;
      clearInterval(ramp.current);
      if (!want) el.pause();
    };
    ramp.current = window.setInterval(step, 30);
    step();
    return () => clearInterval(ramp.current);
  }, [live, track, level]);

  if (!track) return null;
  return <audio ref={ref} src={track.url} loop preload="none" aria-hidden />;
}
