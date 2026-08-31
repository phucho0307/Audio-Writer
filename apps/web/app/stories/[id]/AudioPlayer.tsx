'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type ChapterAudio, type Voice } from '@/lib/api';

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
  const [voice, setVoice] = useState('Kore');
  const [chapters, setChapters] = useState<ChapterAudio[] | null>(null);

  const [playing, setPlaying] = useState<number | null>(null);
  const [working, setWorking] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Whole-story mode: keep going when a track ends. */
  const [continuous, setContinuous] = useState(false);
  const [rate, setRate] = useState(1.5);
  const [open, setOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

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
      e instanceof ApiError && e.code === 'TTS_RATE_LIMITED'
        ? 'Đã hết lượt đọc hôm nay. Thử lại sau.'
        : (e as Error).message,
    );
  }

  async function playChapter(depth: number) {
    setError(null);
    const chapter = chapters?.find((c) => c.depth === depth);

    if (!chapter?.url) {
      setWorking(depth);
      try {
        await api.narrateChapter(branchId, depth, voice);
        await refresh();
      } catch (e) {
        fail(e);
        setWorking(null);
        return;
      }
      setWorking(null);
    }
    setPlaying(depth);
  }

  async function playAll() {
    setError(null);
    setWorking('all');
    try {
      const res = await api.narrateBranch(branchId, voice);
      setChapters(res.chapters);
      if (res.stoppedAt !== null) {
        setError(
          `Mới đọc được ${res.narrated} chương thì hết lượt. Phần còn lại thử lại sau.`,
        );
      }
      const first = res.chapters.find((c) => c.url);
      if (first) {
        setContinuous(true);
        setPlaying(first.depth);
      }
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
      {playing !== null && (
        <div className="flex flex-col gap-1.5">
          <audio
            ref={audioRef}
            controls
            onEnded={onEnded}
            onError={() => setError('Không tải được file âm thanh.')}
            className="h-9 w-full"
            preload="none"
          />
          <div className="flex items-center gap-3 font-mono text-[10.5px] text-[var(--color-muted)]">
            <span>Chương {playing + 1}</span>
            <span className="opacity-40">·</span>
            <span className="min-w-0 truncate">
              {chapters?.find((c) => c.depth === playing)?.preview}
            </span>
            <button
              onClick={() => setPlaying(null)}
              className="ml-auto flex-none hover:text-[var(--color-accent)]"
            >
              đóng
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={playAll}
          disabled={working !== null || total === 0}
          className="font-mono text-[12px] text-[var(--color-accent)] hover:underline disabled:opacity-40"
        >
          {working === 'all' ? '♪ đang tạo giọng đọc…' : '♪ nghe cả truyện'}
        </button>

        <span className="font-mono text-[10.5px] text-[var(--color-muted)]">
          {ready}/{total} chương
          {totalMs > 0 && ` · ${mmss(totalMs / rate)}`}
        </span>

        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto font-mono text-[10.5px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          {voice} · {rate}× {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {voices.map((v) => (
              <button
                key={v.id}
                onClick={() => setVoice(v.id)}
                aria-pressed={voice === v.id}
                className={`text-[12px] transition-colors ${
                  voice === v.id
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            {[1, 1.25, 1.5, 1.75, 2].map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={`font-mono text-[11px] tabular-nums transition-colors ${
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
                <span className="w-5 flex-none font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
                  {active ? '▶' : c.depth + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {c.locked ? '🔒 Chương bị khoá' : c.preview}
                </span>
                <span className="flex-none font-mono text-[10.5px] text-[var(--color-muted)]">
                  {working === c.depth
                    ? 'đang đọc…'
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
        <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
    </section>
  );
}
