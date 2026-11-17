'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ApiError, api, type RenderStatus, type Voice } from '@/lib/api';
import { awaitNarration, NarrationFailed } from '@/lib/narration';
import NarrationProgress from '@/app/NarrationProgress';
import VoicePicker from '@/app/VoicePicker';
import { setNarrating } from '@/lib/ambience';
import { forgetProgress, progressOf, saveProgress } from '@/lib/progress';
import { thumbUrl } from '@/lib/thumb';
import { BRAND } from '@/lib/brand';

/** Remembered per browser: a listener who turns it on wants it on tomorrow. */
const AUTO_KEY = 'aw-auto-next';
const VOICE_KEY = 'aw-voice';
const RATE_KEY = 'aw-rate';
/** Set just before moving on, read by the next chapter's player. */
const PLAY_ON_ARRIVAL = 'aw-play-on-arrival';
const COUNTDOWN = 5;
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
  useEffect(() => () => setNarrating(ambienceId, false), [ambienceId]);

  useEffect(() => {
    setAutoNext(load(AUTO_KEY) === '1');
    const r = Number(load(RATE_KEY));
    if ([1, 1.25, 1.5, 1.75, 2].includes(r)) setRate(r);
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
    if (!s && audioRef.current) audioRef.current.volume = 1;
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

  // Loading a source resets the rate, so it is reapplied per track.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }, [rate, url]);

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
        if (el) {
          el.pause();
          el.volume = 1;
        }
        setCountdown(null);
        setSleep(null);
        storeSleep(null);
        setSlept(true);
        return;
      }
      setSleepLeft(left);
      if (el) el.volume = left <= FADE_SECONDS ? Math.max(0.05, left / FADE_SECONDS) : 1;
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
  }, [url, toggle, skip]);

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
          setNarrating(ambienceId, false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          // Fires at the end of the track as well; `onEnded` then overrules it.
          remember(depth + 1, e.currentTarget.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          setNarrating(ambienceId, false);
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

          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="btn btn-quiet flex-none text-[11.5px]"
          >
            <span className="hidden max-w-[11ch] truncate md:inline">
              {label}
            </span>
            <span className="tabular-nums">{rate}×</span>
            {autoNext && <span className="hidden sm:inline" title="Tự chuyển chương đang bật">· tự chuyển</span>}
            {sleepLabel && (
              <span className="flex items-center gap-1 text-[var(--color-accent)]" title="Hẹn giờ tắt đang bật">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  {MOON}
                </svg>
                <span className="tabular-nums">{sleepLabel}</span>
              </span>
            )}
            <span aria-hidden>{open ? '▴' : '▾'}</span>
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
                className="btn btn-quiet text-[11.5px]"
              >
                {label} · {rate}×{autoNext ? ' · tự chuyển' : ''}
                {sleepLabel ? ` · tắt sau ${sleepLabel}` : ''} <span aria-hidden>{open ? '▴' : '▾'}</span>
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
          <div className="ml-auto flex items-center gap-1">
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
