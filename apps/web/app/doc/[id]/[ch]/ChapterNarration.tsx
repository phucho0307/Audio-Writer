'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ApiError, api, forgetReads, type RenderStatus, type Voice } from '@/lib/api';
import { awaitNarration, NarrationFailed } from '@/lib/narration';
import NarrationProgress from '@/app/NarrationProgress';
import VoicePicker from '@/app/VoicePicker';
import MusicPicker from '@/app/MusicPicker';
import { setNarrating } from '@/lib/ambience';
import { forgetProgress, progressOf, saveProgress } from '@/lib/progress';
import { thumbUrl } from '@/lib/thumb';
import { BRAND } from '@/lib/brand';

/** Remembered per browser: a listener who turns it on wants it on tomorrow. */
const AUTO_KEY = 'aw-auto-next';
const VOICE_KEY = 'aw-voice';
const RATE_KEY = 'aw-rate';
const VOLUME_KEY = 'aw-volume';
/** Set just before moving on, read by the next chapter's player. */
const PLAY_ON_ARRIVAL = 'aw-play-on-arrival';
const COUNTDOWN = 5;
/**
 * Start making the next chapter's narration once this much of this one has
 * been heard. Early on purpose: a chapter takes over a minute to narrate, and
 * at 1.5x a five-minute chapter is over in about three. Half a minute in,
 * someone is listening rather than sampling.
 */
const AHEAD_AFTER_SECONDS = 30;
const SKIP_SECONDS = 15;
/** How often a playing chapter writes its position down. */
const SAVE_EVERY_SECONDS = 5;

/**
 * Sleep timer. Kept for the tab's session rather than in the component, so
 * "30 minutes" survives the move to the next chapter when chapters change by
 * themselves - which is exactly when someone falling asleep needs it.
 */
type Sleep = { kind: 'time'; until: number; minutes: number } | { kind: 'chapter' };
const SLEEP_KEY = 'aw-sleep';
const SLEEP_MINUTES = [15, 30, 45, 60];
const SPEAKER = 'M4 9h4l5-4v14l-5-4H4z';
const WAVES = 'M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12';
const MUTED = 'M16 9l5 6M21 9l-5 6';

/** The voice fades over the last seconds instead of stopping mid-word at full volume. */
const FADE_SECONDS = 10;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function loadSleep(): Sleep | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SLEEP_KEY) ?? 'null') as Sleep | null;
    if (s?.kind === 'chapter') return s;
    if (s?.kind === 'time' && s.until > Date.now()) return s;
  } catch {}
  return null;
}
function storeSleep(s: Sleep | null) {
  try {
    if (s) sessionStorage.setItem(SLEEP_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SLEEP_KEY);
  } catch {}
}

function mmss(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PLAY = <path d="M8 5.5v13l11-6.5-11-6.5Z" />;
const PAUSE = (
  <>
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </>
);
const MOON = <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />;

/**
 * Narration for the chapter being read.
 *
 * The transport is ours rather than the browser's. `<audio controls>` renders
 * a different widget per browser, none of which can be themed, and all of
 * which are the loudest object on a page whose job is to be quiet - it sat
 * directly above the prose looking like a form control from another site.
 *
 * Voice, speed, auto-advance and the sleep timer stay folded away until
 * asked for, for the same reason.
 *
 * It also remembers. The position is written down as the chapter plays, so
 * coming back - tomorrow, or on another device when signed in - starts at
 * the sentence that was playing, not at the top of the story.
 */
export default function ChapterNarration({
  story,
  branchId,
  branchParam,
  depth,
  chapterTitle,
  next,
  prevHref,
}: {
  story: { id: string; title: string; coverUrl: string | null; totalChapters: number };
  branchId: string;
  /** The fork named in the URL, or null on the story's main line. */
  branchParam: string | null;
  depth: number;
  chapterTitle: string;
  /** The chapter after this one on the same branch, if the reader can open it. */
  next: { href: string; title: string } | null;
  prevHref: string | null;
}) {
  const router = useRouter();
  // Off by default: moving someone to another page uninvited is only fine
  // once they have asked for it.
  const [autoNext, setAutoNext] = useState(false);
  /** Seconds left before moving on; null when no move is pending. */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  // Empty until the server says which voice is the default. Guessing a name
  // here ties the page to one provider: under any other driver the guess is an
  // unknown voice, and the first request races the real one.
  const [voice, setVoice] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  // 1x: the Edge voices already read at a natural pace. (1.5x was the default
  // when Gemini narrated, which reads much slower.)
  const [rate, setRate] = useState(1);
  /**
   * The listener's level, 0-1, and mute kept apart from it, so unmuting comes
   * back to where it was. What the element plays at is this times `fade`.
   */
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  /** The sleep timer's fade-out, 1 the rest of the time. It scales the level rather than replacing it. */
  const [fade, setFade] = useState(1);
  /** Queued behind other work, or actually being synthesised right now. */
  const [stage, setStage] = useState<RenderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [estimatedMs, setEstimatedMs] = useState<number | null>(null);
  /** Held briefly at 100% so the bar is seen to finish before it disappears. */
  const [finished, setFinished] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transport state, read from the element rather than predicted, so a stall
  // or a seek by the browser cannot put the bar out of step with the sound.
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState<number | null>(null);

  const [sleep, setSleep] = useState<Sleep | null>(null);
  /** Seconds left on a timed sleep, for the display. */
  const [sleepLeft, setSleepLeft] = useState<number | null>(null);
  /** The timer just went off; said once, until the listener plays again. */
  const [slept, setSlept] = useState(false);
  /** Where this chapter was picked back up from, shown until it plays. */
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  /** The player has scrolled out of sight: show the small one. */
  const [offscreen, setOffscreen] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  /** A position to return to once the audio knows how long it is. */
  const resumeAt = useRef<number | null>(null);
  const lastSaved = useRef(0);

  // Identifies this player to the page's atmosphere. Leaving the chapter has
  // to release it, or navigating away mid-sentence would leave the room lit
  // for a story nothing is playing.
  const ambienceId = `chapter:${branchId}:${depth}`;
  useEffect(() => () => setNarrating(ambienceId, false, true), [ambienceId]);

  useEffect(() => {
    setAutoNext(load(AUTO_KEY) === '1');
    const r = Number(load(RATE_KEY));
    if ([1, 1.25, 1.5, 1.75, 2].includes(r)) setRate(r);
    const kept = load(VOLUME_KEY);
    const vol = kept === null ? NaN : Number(kept);
    if (vol >= 0 && vol <= 1) setVolume(vol);
    setSleep(loadSleep());
    api
      .voices()
      .then((v) => {
        setVoices(v.voices);
        const kept = load(VOICE_KEY);
        setVoice(kept && v.voices.some((x) => x.id === kept) ? kept : v.default);
      })
      .catch(() => {});
  }, []);

  function chooseVoice(v: string) {
    setVoice(v);
    save(VOICE_KEY, v);
  }
  function chooseRate(r: number) {
    setRate(r);
    save(RATE_KEY, String(r));
  }
  function chooseVolume(v: number) {
    const level = Math.max(0, Math.min(1, v));
    setVolume(level);
    setMuted(level === 0);
    save(VOLUME_KEY, String(level));
  }
  const toggleMute = useCallback(() => {
    // Unmuting at zero would be silent: give it a level to come back to.
    setMuted((m) => {
      if (m && volume === 0) {
        setVolume(0.5);
        save(VOLUME_KEY, '0.5');
      }
      return !m;
    });
  }, [volume]);
  function toggleAutoNext() {
    const on = !autoNext;
    setAutoNext(on);
    save(AUTO_KEY, on ? '1' : '0');
    if (!on) setCountdown(null);
  }
  function chooseSleep(s: Sleep | null) {
    setSleep(s);
    storeSleep(s);
    setSlept(false);
    if (!s) setFade(1);
  }

  /** Write down where the listener is: this chapter, or the one they are about to start. */
  const remember = useCallback(
    (chapter: number, seconds: number) => {
      saveProgress({
        storyId: story.id,
        title: story.title,
        coverUrl: story.coverUrl,
        branchId: branchParam,
        chapter,
        totalChapters: story.totalChapters,
        at: seconds,
      });
    },
    [story.id, story.title, story.coverUrl, story.totalChapters, branchParam],
  );

  // Arriving here because the previous chapter ended: carry on listening.
  // The flag names this exact chapter, so a stale one from another tab or
  // an old visit cannot start sound on a page nobody asked to hear.
  const arrivedToPlay = useRef(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PLAY_ON_ARRIVAL) === `${branchId}:${depth}`) {
        sessionStorage.removeItem(PLAY_ON_ARRIVAL);
        arrivedToPlay.current = true;
      }
    } catch {}
  }, [branchId, depth]);

  /** Go to another chapter and keep the sound going there. */
  const playAt = useCallback(
    (href: string, targetDepth: number) => {
      try {
        sessionStorage.setItem(PLAY_ON_ARRIVAL, `${branchId}:${targetDepth}`);
      } catch {}
      // Client-side, so the browser still counts the earlier tap on play as
      // permission to keep making sound.
      router.push(href);
    },
    [branchId, router],
  );

  // The countdown after a chapter ends. Cancelling or switching the setting
  // off clears it; reaching zero moves on.
  useEffect(() => {
    if (countdown === null || !next) return;
    if (countdown <= 0) {
      setCountdown(null);
      playAt(next.href, depth + 1);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, depth, playAt]);

  useEffect(() => {
    setUrl(null);
    setError(null);
    setAt(0);
    setLength(null);
    setResumedFrom(null);
    lastSaved.current = 0;
    // Left part-way through this very chapter: go back there, not to 0:00.
    const kept = progressOf(story.id);
    resumeAt.current =
      !arrivedToPlay.current &&
      kept &&
      kept.chapter === depth + 1 &&
      (kept.branchId ?? null) === (branchParam ?? null) &&
      kept.at > 3
        ? kept.at
        : null;
    if (!voice) return;
    api
      .chapterAudio(branchId, voice)
      .then((all) => {
        const c = all.find((x) => x.depth === depth);
        setUrl(c?.url ?? null);
        if (arrivedToPlay.current) {
          arrivedToPlay.current = false;
          if (c?.url) setTimeout(() => void audioRef.current?.play().catch(() => {}), 60);
          else void narrate();
        }
      })
      .catch(() => {});
    // narrate reads the current voice, which is in the dependencies already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, depth, voice, story.id, branchParam]);

  /**
   * Have the next chapter ready before this one ends.
   *
   * Moving on used to start everything from nothing: load the page's data,
   * find there is no narration yet, queue it, wait ten seconds or more while
   * the voice is made (over a minute). Someone listening with the screen off heard a long
   * silence between every chapter. So, once this chapter has been playing a
   * little while, the next one's narration is made (only then: one tapped and
   * left costs nothing) and the data its page needs is fetched. Arriving finds
   * both waiting, and the sound picks up within a moment.
   */
  const preparedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!next || !voice || !url || !playing || !length) return;
    if (at < Math.min(AHEAD_AFTER_SECONDS, length / 2)) return;
    const key = `${branchId}:${depth + 1}:${voice}`;
    if (preparedFor.current === key) return;
    preparedFor.current = key;
    router.prefetch(next.href);
    void api.getStory(story.id).catch(() => {});
    void api.readBranch(branchId).catch(() => {});
    void (async () => {
      try {
        const all = await api.chapterAudio(branchId, voice);
        if (all.some((c) => c.depth === depth + 1 && c.url)) return;
        const ticket = await api.narrateChapter(branchId, depth + 1, voice);
        await awaitNarration(ticket, {});
        // The copy kept from before says there is nothing to play yet.
        forgetReads(`audio:${branchId}:`);
        await api.chapterAudio(branchId, voice);
      } catch {
        // Not ready in advance is only the old behaviour: it is made on arrival.
      }
    })();
  }, [next, voice, url, playing, length, at, branchId, depth, story.id, router]);

  // Loading a source resets the rate, so it is reapplied per track.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }, [rate, url]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume * fade;
    el.muted = muted;
  }, [volume, muted, fade, url]);

  // The sleep timer. Wall-clock, so it runs whether or not sound is playing
  // - "30 minutes" means half an hour from now, as on any radio.
  useEffect(() => {
    if (sleep?.kind !== 'time') {
      setSleepLeft(null);
      return;
    }
    const tick = () => {
      const el = audioRef.current;
      const left = (sleep.until - Date.now()) / 1000;
      if (left <= 0) {
        el?.pause();
        setFade(1);
        setCountdown(null);
        setSleep(null);
        storeSleep(null);
        setSlept(true);
        return;
      }
      setSleepLeft(left);
      setFade(left <= FADE_SECONDS ? Math.max(0.05, left / FADE_SECONDS) : 1);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [sleep]);

  async function narrate() {
    setBusy(true);
    setStage('QUEUED');
    setEstimatedMs(null);
    setFinished(false);
    setError(null);
    try {
      // Returns a job, not a clip. The wait happens here rather than in the
      // request, so nothing is lost if the reader navigates away - the audio
      // is still being made and will be there when they come back.
      const ticket = await api.narrateChapter(branchId, depth, voice);
      setEstimatedMs(ticket.estimatedMs);
      const clip = await awaitNarration(ticket, { onStatus: setStage });
      forgetReads(`audio:${branchId}:`);
      if (!ticket.cached) {
        setFinished(true);
        await new Promise((r) => setTimeout(r, 450));
      }
      setUrl(clip.url);
      setTimeout(() => void audioRef.current?.play().catch(() => {}), 60);
    } catch (e) {
      setError(
        e instanceof NarrationFailed
          ? e.message
          : e instanceof ApiError && e.code === 'TTS_RATE_LIMITED'
            ? 'Hết lượt tạo giọng đọc hôm nay.'
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setStage(null);
      setFinished(false);
    }
  }

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const skip = useCallback((by: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + by));
  }, []);

  function restart() {
    const el = audioRef.current;
    if (el) el.currentTime = 0;
    setAt(0);
    setResumedFrom(null);
  }

  // Space and the arrow keys, while there is something to play. Only then:
  // without audio, Space is how a reader pages down, and that is left alone.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        // A focused button or link takes Space for itself.
        if (e.key === ' ' && (tag === 'BUTTON' || tag === 'A')) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skip(-SKIP_SECONDS);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skip(SKIP_SECONDS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, toggle, skip, toggleMute]);

  // Lock screen, headphone buttons, car display: the title and cover, and
  // play / pause / skip / next chapter without unlocking the phone.
  const nav = useRef({ next, prevHref, depth, playAt });
  nav.current = { next, prevHref, depth, playAt };
  useEffect(() => {
    if (!url || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: chapterTitle,
        artist: story.title,
        album: BRAND,
        artwork: story.coverUrl
          ? [{ src: new URL(thumbUrl(story.coverUrl), window.location.origin).href, sizes: '480x640' }]
          : [],
      });
    } catch {}
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // An action this browser does not know: the rest still work.
      }
    };
    set('play', () => void audioRef.current?.play().catch(() => {}));
    set('pause', () => audioRef.current?.pause());
    set('seekbackward', (d) => skip(-(d.seekOffset ?? SKIP_SECONDS)));
    set('seekforward', (d) => skip(d.seekOffset ?? SKIP_SECONDS));
    set('seekto', (d) => {
      if (audioRef.current && typeof d.seekTime === 'number') audioRef.current.currentTime = d.seekTime;
    });
    set('nexttrack', () => {
      const n = nav.current;
      if (n.next) n.playAt(n.next.href, n.depth + 1);
    });
    set('previoustrack', () => {
      const n = nav.current;
      const el = audioRef.current;
      // As on any player: back goes to the start first, then to the chapter before.
      if (el && el.currentTime > 5) el.currentTime = 0;
      else if (n.prevHref) n.playAt(n.prevHref, n.depth - 1);
    });
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'] as const) {
        set(a, null);
      }
    };
  }, [url, chapterTitle, story.title, story.coverUrl, skip]);

  function reportPosition(el: HTMLAudioElement) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: el.duration,
        playbackRate: el.playbackRate,
        position: Math.min(el.currentTime, el.duration),
      });
    } catch {}
  }

  // Whether the full player is in view; when it is not, the small one shows.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting), {
      // The sticky header covers the top 56px.
      rootMargin: '-56px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const label = voices.find((v) => v.id === voice)?.label ?? voice;
  // Everything the listener is shown is in heard time, not source time: at
  // 1.5x a nine-minute clip is six minutes, and six is the number that decides
  // whether they start it.
  const heardLength = length === null ? null : length / rate;
  const heardAt = at / rate;
  const sleepLabel =
    sleep?.kind === 'chapter' ? 'hết chương' : sleepLeft !== null ? mmss(sleepLeft) : null;

  const mini =
    url && offscreen && (playing || at > 0) && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="region"
            aria-label="Trình phát thu gọn"
            className="mini-player fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-40 px-3 sm:bottom-4 sm:px-5"
          >
            <div className="relative mx-auto flex max-w-[42rem] items-center gap-3 overflow-hidden rounded-[10px] border border-[var(--color-line-strong)] bg-[color-mix(in_oklab,var(--color-surface)_94%,transparent)] px-3 py-2 shadow-[0_8px_30px_rgb(0_0_0/0.35)] backdrop-blur-xl">
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[2px] origin-left bg-[var(--color-accent)]"
                style={{ transform: `scaleX(${length ? at / length : 0})` }}
              />
              <button
                onClick={toggle}
                aria-label={playing ? 'Tạm dừng' : 'Phát'}
                className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] transition-transform active:scale-95"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={playing ? '' : 'ml-0.5'}>
                  {playing ? PAUSE : PLAY}
                </svg>
              </button>
              <button
                type="button"
                onClick={() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="flex min-w-0 flex-1 flex-col text-left"
                title="Về trình phát"
              >
                <span className="truncate text-[13px] font-medium">{chapterTitle}</span>
                <span className="truncate text-[11px] text-[var(--color-muted)]">
                  {story.title}
                  {sleepLabel ? ` · tắt sau ${sleepLabel}` : ''}
                </span>
              </button>
              <span className="flex-none text-[11.5px] tabular-nums text-[var(--color-muted)]">
                {mmss(heardAt)} / {mmss(heardLength)}
              </span>
              <button onClick={() => skip(-SKIP_SECONDS)} aria-label="Lùi 15 giây" className="btn btn-quiet hidden px-1.5 text-[11.5px] sm:inline-flex">
                −15s
              </button>
              <button onClick={() => skip(SKIP_SECONDS)} aria-label="Tới 15 giây" className="btn btn-quiet hidden px-1.5 text-[11.5px] sm:inline-flex">
                +15s
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section ref={sectionRef} className="card flex flex-col gap-3 px-4 py-3">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onPlay={(e) => {
          setPlaying(true);
          setSlept(false);
          setResumedFrom(null);
          setNarrating(ambienceId, true);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
          reportPosition(e.currentTarget);
        }}
        onPause={(e) => {
          setPlaying(false);
          setNarrating(ambienceId, false, e.currentTarget.ended);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          // Fires at the end of the track as well; `onEnded` then overrules it.
          remember(depth + 1, e.currentTarget.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          setNarrating(ambienceId, false, true);
          // Finished: the place to come back to is the next chapter - or
          // nowhere, when that was the last one.
          if (next) remember(depth + 2, 0);
          else if (depth + 1 >= story.totalChapters) forgetProgress(story.id);
          else remember(depth + 1, 0);
          if (sleep?.kind === 'chapter') {
            chooseSleep(null);
            setSlept(true);
            return;
          }
          if (autoNext && next) setCountdown(COUNTDOWN);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setAt(el.currentTime);
          if (!el.paused && Math.abs(el.currentTime - lastSaved.current) >= SAVE_EVERY_SECONDS) {
            lastSaved.current = el.currentTime;
            remember(depth + 1, el.currentTime);
            reportPosition(el);
          }
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const d = Number.isFinite(el.duration) ? el.duration : null;
          setLength(d);
          // Back to where this chapter was left - unless that was its last
          // seconds, which is as good as finished.
          const back = resumeAt.current;
          resumeAt.current = null;
          if (back !== null && d !== null && back < d - 3) {
            el.currentTime = back;
            setAt(back);
            setResumedFrom(back);
            lastSaved.current = back;
          }
        }}
        onSeeked={(e) => reportPosition(e.currentTarget)}
        onRateChange={(e) => reportPosition(e.currentTarget)}
        onError={() => url && setError('Không tải được file âm thanh.')}
        className="hidden"
      />

      {url ? (
        <div className="flex items-center gap-3.5">
          <button
            onClick={toggle}
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
            title="Phát / dừng (phím Space)"
            className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-transform hover:scale-[1.06] active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={playing ? '' : 'ml-0.5'}>
              {playing ? PAUSE : PLAY}
            </svg>
          </button>

          <button
            onClick={() => skip(-SKIP_SECONDS)}
            aria-label="Lùi 15 giây"
            title="Lùi 15 giây (phím ←)"
            className="btn btn-quiet hidden px-1.5 text-[11.5px] sm:inline-flex"
          >
            −15s
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="w-[38px] flex-none text-right text-[11.5px] tabular-nums text-[var(--color-muted)]">
              {mmss(heardAt)}
            </span>
            <input
              type="range"
              min={0}
              max={length ?? 0}
              step={0.5}
              value={at}
              disabled={length === null}
              aria-label="Vị trí nghe"
              onChange={(e) => {
                const el = audioRef.current;
                if (el) el.currentTime = Number(e.target.value);
                setAt(Number(e.target.value));
              }}
              className="scrub min-w-0 flex-1"
              style={{
                ['--pct' as string]: `${length ? (at / length) * 100 : 0}%`,
              }}
            />
            <span className="w-[38px] flex-none text-[11.5px] tabular-nums text-[var(--color-muted)]">
              {mmss(heardLength)}
            </span>
          </div>

          <button
            onClick={() => skip(SKIP_SECONDS)}
            aria-label="Tới 15 giây"
            title="Tới 15 giây (phím →)"
            className="btn btn-quiet hidden px-1.5 text-[11.5px] sm:inline-flex"
          >
            +15s
          </button>

          {/* Desktop only: on phones the hardware buttons set the level, and
              iOS ignores a page's volume anyway. The panel has it too.
              The slider opens on hover or focus: the card is a reading
              column wide, and a standing slider squeezed the seek bar to
              nothing. */}
          <div className="group/vol hidden flex-none items-center md:flex">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}
              aria-pressed={muted}
              title={`${muted ? 'Bật tiếng' : 'Tắt tiếng'} (phím M)`}
              className="btn btn-quiet px-1"
            >
              <VolumeIcon level={muted ? 0 : volume} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Âm lượng"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
              onChange={(e) => chooseVolume(Number(e.target.value))}
              className="scrub w-0 opacity-0 transition-[width,opacity] duration-150 group-hover/vol:w-[72px] group-hover/vol:opacity-100 group-focus-within/vol:w-[72px] group-focus-within/vol:opacity-100 motion-reduce:transition-none"
              style={{ ['--pct' as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>

          {/* Speed only. The voice's name and "tự chuyển" used to sit here
              too, and in a card a reading column wide they took 230px and
              left the seek bar 11. They are in the tooltip and the panel. */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Tuỳ chỉnh: giọng đọc, tốc độ, âm lượng, nhạc nền, hẹn giờ"
            title={`${label} · ${rate}×${autoNext ? ' · tự chuyển chương' : ''}`}
            className="btn btn-pill flex-none"
          >
            <SettingsIcon />
            <span className="hidden sm:inline">Tuỳ chỉnh</span>
            {sleepLabel && (
              <span className="flex items-center gap-1 text-[var(--color-accent)]" title="Hẹn giờ tắt đang bật">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  {MOON}
                </svg>
                <span className="tabular-nums">{sleepLabel}</span>
              </span>
            )}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {busy ? (
            <NarrationProgress
              status={stage}
              estimatedMs={estimatedMs}
              done={finished}
            />
          ) : (
            <>
              {/* Held until the server has said which voice to use: asked
                  for with no voice, the request fails as "Unknown voice". */}
              <button onClick={narrate} disabled={!voice} className="btn btn-primary btn-sm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  {PLAY}
                </svg>
                Nghe chương này
              </button>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="btn btn-pill"
              >
                <SettingsIcon />
                Giọng {label} · {rate}×{sleepLabel ? ` · tắt sau ${sleepLabel}` : ''}
              </button>
            </>
          )}
        </div>
      )}

      {resumedFrom !== null && !playing && (
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--color-muted)]">
          Nghe tiếp từ <span className="tabular-nums text-[var(--color-ink)]">{mmss(resumedFrom / rate)}</span>, chỗ
          bạn dừng lần trước.
          <button type="button" onClick={restart} className="text-[var(--color-accent)] hover:underline">
            Nghe lại từ đầu
          </button>
        </p>
      )}

      {slept && (
        <p role="status" className="text-[12.5px] text-[var(--color-muted)]">
          Đã tắt theo hẹn giờ. Vị trí đang nghe được giữ lại, bấm phát để nghe tiếp.
        </p>
      )}

      {countdown !== null && next && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[5px] border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] px-3 py-2 text-[13px]"
        >
          <span className="min-w-0 flex-1">
            Hết chương. Sang <span className="font-medium">{next.title}</span> sau{' '}
            <span className="tabular-nums text-[var(--color-accent)]">{countdown}s</span>
          </span>
          <button onClick={() => setCountdown(0)} className="btn btn-primary btn-sm">
            Nghe luôn
          </button>
          <button onClick={() => setCountdown(null)} className="btn btn-quiet btn-sm">
            Huỷ
          </button>
        </div>
      )}

      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--color-line)] pt-3">
          <VoicePicker voices={voices} value={voice} onChange={chooseVoice} />
          <div className="flex w-full items-center gap-1 text-[12.5px] text-[var(--color-muted)]" role="group" aria-label="Tốc độ đọc">
            <span className="mr-1">Tốc độ</span>
            {[1, 1.25, 1.5, 1.75, 2].map((r) => (
              <button
                key={r}
                onClick={() => chooseRate(r)}
                aria-pressed={rate === r}
                className={`rounded-[3px] px-1.5 py-1 text-[11.5px] tabular-nums transition-colors ${
                  rate === r
                    ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {r}×
              </button>
            ))}
          </div>

          <div className="flex w-full items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}
              aria-pressed={muted}
              className="btn btn-quiet flex items-center gap-1.5 px-1"
            >
              <VolumeIcon level={muted ? 0 : volume} />
              Âm lượng
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Âm lượng"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
              onChange={(e) => chooseVolume(Number(e.target.value))}
              className="scrub w-full max-w-[220px]"
              style={{ ['--pct' as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
            <span className="w-[4ch] text-right tabular-nums">{Math.round((muted ? 0 : volume) * 100)}%</span>
          </div>

          <MusicPicker />

          <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-[var(--color-muted)]" role="group" aria-label="Hẹn giờ tắt">
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                {MOON}
              </svg>
              Hẹn giờ tắt
            </span>
            <button type="button" onClick={() => chooseSleep(null)} aria-pressed={sleep === null} className={`chip text-[11.5px] ${sleep === null ? 'chip-on' : ''}`}>
              Không
            </button>
            {SLEEP_MINUTES.map((m) => {
              const on = sleep?.kind === 'time' && sleep.minutes === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => chooseSleep({ kind: 'time', until: Date.now() + m * 60_000, minutes: m })}
                  aria-pressed={on}
                  className={`chip text-[11.5px] ${on ? 'chip-on' : ''}`}
                >
                  {m} phút
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => chooseSleep({ kind: 'chapter' })}
              aria-pressed={sleep?.kind === 'chapter'}
              className={`chip text-[11.5px] ${sleep?.kind === 'chapter' ? 'chip-on' : ''}`}
            >
              Hết chương này
            </button>
            {sleepLeft !== null && (
              <span className="tabular-nums text-[var(--color-accent)]">còn {mmss(sleepLeft)}</span>
            )}
          </div>

          <div className="flex w-full cursor-pointer items-center gap-2.5 text-[12.5px] text-[var(--color-muted)]">
            <button
              type="button"
              role="switch"
              aria-checked={autoNext}
              aria-label="Tự chuyển chương"
              onClick={toggleAutoNext}
              className={`relative h-[18px] w-[32px] flex-none rounded-full transition-colors ${
                autoNext ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${
                  autoNext ? 'left-[16px]' : 'left-[2px]'
                }`}
              />
            </button>
            <span onClick={toggleAutoNext}>
              Tự chuyển chương · nghe hết thì sang chương tiếp
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[12px] text-[var(--color-son)]">{error}</p>
      )}

      {mini}
    </section>
  );
}

/** A speaker with waves for the level: none when silent, one when low, two above half. */
function VolumeIcon({ level }: { level: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={SPEAKER} fill="currentColor" stroke="none" />
      {level === 0 ? (
        <path d={MUTED} />
      ) : (
        <path d={level > 0.5 ? WAVES : WAVES.split('M').slice(0, 2).join('M')} />
      )}
    </svg>
  );
}

/** Sliders: reads as "settings" without the gear's "system preferences" weight. */
function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}
