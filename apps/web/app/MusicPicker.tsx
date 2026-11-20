'use client';

import { chooseMusicLevel, chooseTrack, setMusicOn, TRACKS, useMusicChoice } from '@/lib/background-music';

/**
 * Music under the voice, in the player's settings: a switch, the track, and
 * its level. On by default; the switch is how a listener who wants only the
 * voice turns it off, and the track they had stays selected for later.
 * A list rather than chips for the track: there are too many to lay out.
 */
export default function MusicPicker() {
  const { chosen, on, level } = useMusicChoice();
  if (!TRACKS.length) return null;
  const pct = Math.round(level * 100);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-[var(--color-muted)]">
      <span className="flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" fill="currentColor" stroke="none" />
          <circle cx="17" cy="16" r="3" fill="currentColor" stroke="none" />
        </svg>
        Nhạc nền
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? 'Tắt nhạc nền' : 'Bật nhạc nền'}
        onClick={() => setMusicOn(!on)}
        className={`relative h-[18px] w-[32px] flex-none rounded-full transition-colors ${
          on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${
            on ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </button>

      <select
        id="music-track"
        aria-label="Bài nhạc nền"
        value={chosen.id}
        onChange={(e) => {
          chooseTrack(e.target.value);
          // Picking a track is asking to hear it.
          if (!on) setMusicOn(true);
        }}
        className={`min-w-[170px] cursor-pointer rounded-full border bg-[var(--color-ground)] px-3 py-1 text-[12px] outline-none transition-colors focus-visible:border-[var(--color-accent)] ${
          on
            ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
            : 'border-[var(--color-line-strong)] text-[var(--color-faint)]'
        }`}
      >
        {TRACKS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>

      {on && (
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
