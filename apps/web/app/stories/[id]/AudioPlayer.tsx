'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  type ChapterAudio,
  type RenderStatus,
  type Voice,
} from '@/lib/api';
import { awaitNarration, NarrationFailed } from '@/lib/narration';
import NarrationProgress from '@/app/NarrationProgress';
import VoicePicker from '@/app/VoicePicker';

function mmss(ms: number | null): string {
  if (!ms) return '--:--';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Narration for a branch: one chapter, or the whole story.
 *
 * "Whole story" is a playlist rather than one stitched file. Concatenating
 * server-side would mean ffmpeg and a re-render whenever a chapter changes,
 * and it would take away what a listener wants - skipping to chapter five.
 *
 * Styled to match the reader's narration strip: hairlines rather than a filled
 * panel, with voice and speed folded away until asked for. This sits on a page
 * that already has a composer, an AI panel and branch controls competing for
 * attention.
 */
export default function AudioPlayer({ branchId }: { branchId: string }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  // Empty until the server says which voice is the default. Guessing a name
  // here ties the page to one provider: under any other driver the guess is an
  // unknown voice, and the first request races the real one.
  const [voice, setVoice] = useState('');
  const [chapters, setChapters] = useState<ChapterAudio[] | null>(null);

  const [playing, setPlaying] = useState<number | null>(null);
  const [working, setWorking] = useState<number | 'all' | null>(null);
  /** The single chapter being made: where it is, and how long it should take. */
  const [job, setJob] = useState<{
    status: RenderStatus;
    estimatedMs: number | null;
    done: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Whole-story mode: keep going when a track ends. */
  const [continuous, setContinuous] = useState(false);
  const [rate, setRate] = useState(1.5);
  const [open, setOpen] = useState(false);
  /** Something has been queued, so keep checking for it to land. */
  const [watching, setWatching] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  // Transport state, read off the element rather than predicted. `playing`
  // above is which chapter is loaded; these are whether it is moving and
  // where it is up to.
  const [isPlaying, setIsPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState<number | null>(null);

  useEffect(() => {
    api
      .voices()
      .then((v) => {
        setVoices(v.voices);
        setVoice(v.default);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setChapters(null);
    if (!voice) return;
    api
      .chapterAudio(branchId, voice)
      .then(setChapters)
      .catch((e: Error) => setError(e.message));
  }, [branchId, voice]);

  async function refresh() {
    setChapters(await api.chapterAudio(branchId, voice));
  }

  function fail(e: unknown) {
    setError(
      e instanceof NarrationFailed
        ? e.message
        : e instanceof ApiError && e.code === 'TTS_RATE_LIMITED'
          ? 'Đã hết lượt đọc hôm nay. Thử lại sau.'
          : (e as Error).message,
    );
  }

  /** Chapters the reader may hear that have no audio yet. */
  const pending =
    chapters?.filter((c) => !c.locked && !c.url).length ?? 0;

  /**
   * Chapters arrive one at a time now, so the list has to keep updating.
   *
   * This is what makes whole-story narration usable: a listener starts on
   * chapter one while the rest are still being made, and each appears as it
   * lands. Rendering runs far ahead of listening - about half a minute of work
   * per six minutes of audio - so after the first chapter nobody waits again.
   */
  useEffect(() => {
    if (!watching) return;
    if (pending === 0) {
      setWatching(false);
      return;
    }
    const t = setInterval(() => {
      void refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, pending, branchId, voice]);

  /**
   * Start as soon as the first chapter exists.
   *
   * On a story with no narration at all, "play the whole thing" queues
   * everything and there is nothing to play yet. This picks it up the moment
   * the first one lands - roughly half a minute, rather than the twenty
   * minutes the whole branch takes.
   */
  useEffect(() => {
    if (!continuous || playing !== null || !chapters) return;
    const first = chapters.find((c) => c.url);
    if (first) setPlaying(first.depth);
  }, [continuous, playing, chapters]);

  async function playChapter(depth: number) {
    setError(null);
    const chapter = chapters?.find((c) => c.depth === depth);

    if (!chapter?.url) {
      setWorking(depth);
      setJob({ status: 'QUEUED', estimatedMs: null, done: false });
      try {
        // Queued, not performed. Waiting happens on the client so the request
        // returns immediately and nothing is lost if the page is closed.
        const ticket = await api.narrateChapter(branchId, depth, voice);
        setJob({ status: ticket.status, estimatedMs: ticket.estimatedMs, done: false });
        await awaitNarration(ticket, {
          onStatus: (status) =>
            setJob((j) => (j ? { ...j, status } : j)),
        });
        if (!ticket.cached) {
          setJob((j) => (j ? { ...j, done: true } : j));
          await new Promise((r) => setTimeout(r, 450));
        }
        await refresh();
      } catch (e) {
        fail(e);
        setWorking(null);
        setJob(null);
        return;
      }
      setWorking(null);
      setJob(null);
    }
    setPlaying(depth);
  }

  async function playAll() {
    setError(null);
    setWorking('all');
    try {
      // Every missing chapter is queued at once and at bulk priority, so a
      // reader elsewhere asking for a single chapter is not stuck behind two
      // hundred jobs. This returns in milliseconds; it used to run every
      // chapter in sequence inside the request.
      const res = await api.narrateBranch(branchId, voice);
      setChapters(res.chapters);
      setContinuous(true);
      if (res.queued > 0) setWatching(true);

      const first = res.chapters.find((c) => c.url);
      if (first) setPlaying(first.depth);
    } catch (e) {
      fail(e);
    } finally {
      setWorking(null);
    }
  }

  useEffect(() => {
    if (playing === null) return;
    const track = chapters?.find((c) => c.depth === playing);
    const el = audioRef.current;
    if (!track?.url || !el) return;

    // Relative on purpose: audio is written into the web app's public
    // directory and served by it, not by the API.
    el.src = track.url;
    // Loading a source resets the rate, so it is reapplied per track.
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
    void el.play().catch((err: Error) => {
      if (err.name !== 'NotAllowedError') {
        setError(`Không phát được: ${err.message}`);
      }
    });
  }, [playing, chapters, rate]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }, [rate]);

  function onEnded() {
    if (!continuous || playing === null || !chapters) {
      setPlaying(null);
      return;
    }
    const next = chapters.find((c) => c.depth > playing && c.url);
    if (next) setPlaying(next.depth);
    else {
      setContinuous(false);
      setPlaying(null);
    }
  }

  const ready = chapters?.filter((c) => c.url).length ?? 0;
  const total = chapters?.filter((c) => !c.locked).length ?? 0;
  const totalMs = chapters?.reduce((n, c) => n + (c.durationMs ?? 0), 0) ?? 0;

  return (
    <section className="flex flex-col gap-3 border-y border-[var(--color-line)] py-3.5">
      {/* At the top, the way the reader has it. Below the chapter list it sat
          off-screen the moment a story got long enough to need one. */}
      {/* Mounted whatever is playing, so a chapter change swaps the source
          instead of tearing down the element and losing the transport. */}
      <audio
        ref={audioRef}
        onEnded={onEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) =>
          setLength(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : null,
          )
        }
        onError={() => setError('Không tải được file âm thanh.')}
        className="hidden"
        preload="none"
      />

      {playing !== null && (
        <div className="flex items-center gap-3.5 rounded-[5px] bg-[var(--color-raised)] px-3 py-2.5">
          <button
            onClick={() => {
              const el = audioRef.current;
              if (!el) return;
              if (el.paused) void el.play().catch(() => {});
              else el.pause();
            }}
            aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] transition-transform hover:scale-[1.06] active:scale-95"
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6.5" y="5" width="4" height="14" rx="1" />
                <rect x="13.5" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="ml-0.5">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="flex-none text-[var(--color-accent)]">
                Chương {playing + 1}
              </span>
              <span className="min-w-0 truncate text-[var(--color-muted)]">
                {chapters?.find((c) => c.depth === playing)?.preview}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
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
              <span className="flex-none text-[11px] tabular-nums text-[var(--color-muted)]">
                {mmss(length === null ? null : ((length - at) / rate) * 1000)}
              </span>
            </div>
          </div>

          <button
            onClick={() => setPlaying(null)}
            aria-label="Đóng trình phát"
            className="btn btn-quiet flex-none px-1.5 text-[11.5px]"
          >
            Đóng
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={playAll}
          disabled={working !== null || total === 0}
          className="btn btn-primary btn-sm"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
          {working === 'all' ? 'Đang tạo giọng đọc…' : 'Nghe cả truyện'}
        </button>

        <span className="text-[12px] text-[var(--color-muted)]">
          {ready}/{total} chương
          {totalMs > 0 && ` · ${mmss(totalMs / rate)}`}
        </span>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="btn btn-quiet ml-auto text-[11.5px]"
        >
          {voices.find((v) => v.id === voice)?.label ?? voice} · {rate}×{' '}
          {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <VoicePicker voices={voices} value={voice} onChange={setVoice} />
          <div className="ml-auto flex items-center gap-2.5">
            {[1, 1.25, 1.5, 1.75, 2].map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={`font-mono text-[12px] tabular-nums transition-colors ${
                  rate === r
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col">
        {chapters?.map((c) => {
          const active = playing === c.depth;
          return (
            <li key={c.depth}>
              <button
                onClick={() => playChapter(c.depth)}
                disabled={c.locked || working !== null}
                className={`flex w-full items-baseline gap-3 py-1.5 text-left disabled:opacity-40 ${
                  active ? 'text-[var(--color-accent)]' : ''
                }`}
              >
                <span className="w-5 flex-none font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
                  {active ? '▶' : c.depth + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {c.locked ? '🔒 Chương bị khoá' : c.preview}
                </span>
                <span className="flex-none font-mono text-[12px] text-[var(--color-muted)]">
                  {working === c.depth
                    ? job && (
                        <NarrationProgress
                          compact
                          status={job.status}
                          estimatedMs={job.estimatedMs}
                          done={job.done}
                        />
                      )
                    : c.url
                      ? mmss(c.durationMs === null ? null : c.durationMs / rate)
                      : '—'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="font-mono text-[12px] text-[var(--color-accent)]">
          {error}
        </p>
      )}
    </section>
  );
}
