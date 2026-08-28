'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type Voice } from '@/lib/api';

function mmss(ms: number | null): string {
  if (!ms) return '--:--';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Narration for the chapter being read.
 *
 * Kept to a thin strip. This sits directly above the prose, and a panel of
 * controls there competes with the thing the reader came for - so the voice
 * and speed settings stay hidden until asked for.
 */
export default function ChapterNarration({
  branchId,
  depth,
}: {
  branchId: string;
  depth: number;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState('Kore');
  const [url, setUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [rate, setRate] = useState(1.5);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setUrl(null);
    setDurationMs(null);
    setError(null);
    api
      .chapterAudio(branchId, voice)
      .then((all) => {
        const c = all.find((x) => x.depth === depth);
        setUrl(c?.url ?? null);
        setDurationMs(c?.durationMs ?? null);
      })
      .catch(() => {});
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
    setError(null);
    try {
      const clip = await api.narrateChapter(branchId, depth, voice);
      setUrl(clip.url);
      setDurationMs(clip.durationMs);
      setTimeout(() => void audioRef.current?.play().catch(() => {}), 60);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'TTS_RATE_LIMITED'
          ? 'Hết lượt tạo giọng đọc hôm nay.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-y border-[var(--color-line)] py-3.5">
      {url ? (
        <div className="flex flex-col gap-2.5">
          <audio
            ref={audioRef}
            controls
            src={url}
            preload="metadata"
            onError={() => setError('Không tải được file âm thanh.')}
            className="h-9 w-full"
          />
          <div className="flex items-center gap-3 font-mono text-[10.5px] text-[var(--color-muted)]">
            <span>{mmss(durationMs === null ? null : durationMs / rate)}</span>
            <span className="opacity-40">·</span>
            <span>{voice}</span>
            <button
              onClick={() => setOpen((v) => !v)}
              className="ml-auto hover:text-[var(--color-accent)]"
            >
              {rate}× {open ? '▴' : '▾'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={narrate}
            disabled={busy}
            className="font-mono text-[12px] text-[var(--color-accent)] hover:underline disabled:opacity-40"
          >
            {busy ? '♪ đang tạo giọng đọc…' : '♪ nghe chương này'}
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[10.5px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            {voice} · {rate}× {open ? '▴' : '▾'}
          </button>
        </div>
      )}

      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-0.5">
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

      {error && (
        <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
    </section>
  );
}
