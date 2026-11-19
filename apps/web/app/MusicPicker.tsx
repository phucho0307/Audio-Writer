'use client';

import { chooseMusicLevel, chooseTrack, TRACKS, useMusicChoice } from '@/lib/background-music';

/** Music under the voice, in the player's settings. A list, not chips: there are too many to lay out. */
export default function MusicPicker() {
  const { track, level } = useMusicChoice();
  if (!TRACKS.length) return null;
  const pct = Math.round(level * 100);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-[var(--color-muted)]">
      <label htmlFor="music-track" className="flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" fill="currentColor" stroke="none" />
          <circle cx="17" cy="16" r="3" fill="currentColor" stroke="none" />
        </svg>
        Nhạc nền
      </label>
      <select
        id="music-track"
        value={track?.id ?? ''}
        onChange={(e) => chooseTrack(e.target.value || null)}
        className={`min-w-[180px] cursor-pointer rounded-full border bg-[var(--color-ground)] px-3 py-1 text-[12px] outline-none transition-colors focus-visible:border-[var(--color-accent)] ${
          track
            ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
            : 'border-[var(--color-line-strong)] text-[var(--color-ink)]'
        }`}
      >
        <option value="">Không có nhạc</option>
        {TRACKS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>

      {track && (
        <span className="flex flex-1 items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={level}
            aria-label="Âm lượng nhạc nền"
            aria-valuetext={`${pct}%`}
            onChange={(e) => chooseMusicLevel(Number(e.target.value))}
            className="scrub w-full max-w-[160px]"
            style={{ ['--pct' as string]: `${pct}%` }}
          />
          <span className="w-[4ch] text-right tabular-nums">{pct}%</span>
        </span>
      )}
    </div>
  );
}
