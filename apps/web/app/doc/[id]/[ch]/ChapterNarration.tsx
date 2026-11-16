'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, type RenderStatus, type Voice } from '@/lib/api';
import { awaitNarration, NarrationFailed } from '@/lib/narration';
import NarrationProgress from '@/app/NarrationProgress';
import VoicePicker from '@/app/VoicePicker';
import { setNarrating } from '@/lib/ambience';

/** Remembered per browser: a listener who turns it on wants it on tomorrow. */
const AUTO_KEY = 'aw-auto-next';
const VOICE_KEY = 'aw-voice';
const RATE_KEY = 'aw-rate';
/** Set just before moving on, read by the next chapter's player. */
const PLAY_ON_ARRIVAL = 'aw-play-on-arrival';
const COUNTDOWN = 5;

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

function mmss(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Narration for the chapter being read.
 *
 * The transport is ours rather than the browser's. `<audio controls>` renders
 * a different widget per browser, none of which can be themed, and all of
 * which are the loudest object on a page whose job is to be quiet - it sat
 * directly above the prose looking like a form control from another site.
 *
 * Voice and speed stay folded away until asked for, for the same reason.
 */
export default function ChapterNarration({
  branchId,
  depth,
  next,
}: {
  branchId: string;
  depth: number;
  /** The chapter after this one on the same branch, if the reader can open it. */
  next: { href: string; title: string } | null;
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
  const [rate, setRate] = useState(1.5);
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

  const audioRef = useRef<HTMLAudioElement>(null);

  // Identifies this player to the page's atmosphere. Leaving the chapter has
  // to release it, or navigating away mid-sentence would leave the room lit
  // for a story nothing is playing.
  const ambienceId = `chapter:${branchId}:${depth}`;
  useEffect(() => () => setNarrating(ambienceId, false), [ambienceId]);

  useEffect(() => {
    setAutoNext(load(AUTO_KEY) === '1');
    const r = Number(load(RATE_KEY));
    if ([1, 1.25, 1.5, 1.75, 2].includes(r)) setRate(r);
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

  // The countdown after a chapter ends. Cancelling or switching the setting
  // off clears it; reaching zero moves on.
  useEffect(() => {
    if (countdown === null || !next) return;
    if (countdown <= 0) {
      try {
        sessionStorage.setItem(PLAY_ON_ARRIVAL, `${branchId}:${depth + 1}`);
      } catch {}
      setCountdown(null);
      // Client-side, so the browser still counts the earlier tap on play as
      // permission to keep making sound.
      router.push(next.href);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, branchId, depth, router]);

  useEffect(() => {
    setUrl(null);
    setError(null);
    setAt(0);
    setLength(null);
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
  }, [branchId, depth, voice]);

  // Loading a source resets the rate, so it is reapplied per track.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }, [rate, url]);

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

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  function skip(by: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + by));
  }

  const label = voices.find((v) => v.id === voice)?.label ?? voice;
  // Everything the listener is shown is in heard time, not source time: at
  // 1.5x a nine-minute clip is six minutes, and six is the number that decides
  // whether they start it.
  const heardLength = length === null ? null : length / rate;
  const heardAt = at / rate;

  return (
    <section className="card flex flex-col gap-3 px-4 py-3">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          setNarrating(ambienceId, true);
        }}
        onPause={() => {
          setPlaying(false);
          setNarrating(ambienceId, false);
        }}
        onEnded={() => {
          setPlaying(false);
          setNarrating(ambienceId, false);
          if (autoNext && next) setCountdown(COUNTDOWN);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) =>
          setLength(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : null,
          )
        }
        onError={() => url && setError('Không tải được file âm thanh.')}
        className="hidden"
      />

      {url ? (
        <div className="flex items-center gap-3.5">
          <button
            onClick={toggle}
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
            className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-transform hover:scale-[1.06] active:scale-95"
          >
            {playing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6.5" y="5" width="4" height="14" rx="1" />
                <rect x="13.5" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="ml-0.5">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => skip(-15)}
            aria-label="Lùi 15 giây"
            title="Lùi 15 giây"
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
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="btn btn-quiet flex-none text-[11.5px]"
          >
            <span className="hidden max-w-[11ch] truncate sm:inline">
              {label}
            </span>
            <span className="tabular-nums">{rate}×</span>
            {autoNext && <span title="Tự chuyển chương đang bật">· tự chuyển</span>}
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
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
                Nghe chương này
              </button>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="btn btn-quiet text-[11.5px]"
              >
                {label} · {rate}×{autoNext ? ' · tự chuyển' : ''} <span aria-hidden>{open ? '▴' : '▾'}</span>
              </button>
            </>
          )}
        </div>
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-3">
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
          <div className="flex w-full cursor-pointer items-center gap-2.5 text-[12.5px] text-[var(--color-muted)]">
            <button
              type="button"
              role="switch"
              aria-checked={autoNext}
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
    </section>
  );
}
