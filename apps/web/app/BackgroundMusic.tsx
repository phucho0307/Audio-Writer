'use client';

import { useEffect, useRef, useState } from 'react';
import { isNarrating, onNarrating } from '@/lib/ambience';
import { useMusicChoice } from '@/lib/background-music';
import { pageVolumeIgnored } from '@/lib/page-volume';

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

/**
 * On iPhone the page cannot set `audio.volume`, so the music would play as
 * loud as the voice with the slider doing nothing. There, the element is
 * routed through Web Audio and its level set on a gain node, which iOS does
 * honour.
 *
 * Only the music goes this way, never the voice: iOS may suspend Web Audio
 * behind a locked screen, and losing the music there is acceptable where
 * losing the narration is not. It needs the files served with CORS (the R2
 * bucket allows this site), or the routed element plays silence.
 *
 * The AudioContext is created on the first tap anywhere, because iOS only
 * lets one start running inside a user gesture; the music itself starts
 * later, from the narration signal, outside any gesture.
 */
interface Graph {
  ctx: AudioContext;
  gain: GainNode | null;
  el: HTMLAudioElement | null;
}

export default function BackgroundMusic() {
  const { track, output: level } = useMusicChoice();
  const ref = useRef<HTMLAudioElement>(null);
  const [live, setLive] = useState(false);
  // How much of the music level is let through: ramps to 0 before a pause and back up after a play.
  const gain = useRef(0);
  const ramp = useRef(0);
  const fadeOut = useRef(FADE_OUT_MS);
  const [routed] = useState(pageVolumeIgnored);
  const graph = useRef<Graph | null>(null);

  useEffect(() => {
    if (!routed) return;
    const unlock = () => {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!graph.current) graph.current = { ctx: new Ctx(), gain: null, el: null };
      else if (graph.current.ctx.state !== 'running') void graph.current.ctx.resume();
    };
    document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    document.addEventListener('touchend', unlock, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', unlock, { capture: true });
      document.removeEventListener('touchend', unlock, { capture: true });
    };
  }, [routed]);

  /** Sets the music's level, through the gain node where the page cannot set it directly. */
  function setLevel(el: HTMLAudioElement, v: number) {
    if (!routed) {
      el.volume = v;
      return;
    }
    const g = graph.current;
    if (!g) return; // No tap yet, so no music either.
    // An element can be connected to Web Audio once in its life; a new
    // element (the track was cleared and chosen again) needs a new source.
    if (g.el !== el) {
      const gain = g.ctx.createGain();
      g.ctx.createMediaElementSource(el).connect(gain).connect(g.ctx.destination);
      g.gain = gain;
      g.el = el;
    }
    if (g.ctx.state !== 'running') void g.ctx.resume();
    g.gain!.gain.value = v;
  }

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
    // On iPhone, no music until the gain node exists: unrouted, it would play
    // at full volume over the voice.
    const want = live && track !== null && (!routed || graph.current !== null);
    const target = want ? 1 : 0;
    clearInterval(ramp.current);
    if (want && el.paused) {
      gain.current = 0;
      setLevel(el, 0);
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
      setLevel(el, Math.max(0, Math.min(1, level * gain.current)));
      if (t < 1) return;
      clearInterval(ramp.current);
      if (!want) el.pause();
    };
    ramp.current = window.setInterval(step, 30);
    step();
    return () => clearInterval(ramp.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setLevel reads refs only
  }, [live, track, level, routed]);

  if (!track) return null;
  return (
    <audio
      ref={ref}
      src={track.url}
      loop
      preload="none"
      // Required for Web Audio to hear a file from another origin; without
      // it the routed element would play silence.
      crossOrigin={routed ? 'anonymous' : undefined}
      aria-hidden
    />
  );
}
