'use client';

import type { Voice } from '@/lib/api';

const ORDER = ['vieneu', 'edge-tts', 'gemini', 'piper'];

/**
 * Every voice in one row, house voices first.
 *
 * Grouped by engine (with "VieNeu" / "Microsoft" headings) while the engines
 * were being compared; a listener chooses a voice, not a vendor, so the
 * headings went and only the order is kept.
 */
export default function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: Voice[];
  value: string;
  onChange: (id: string) => void;
}) {
  const rank = (v: Voice) => {
    const i = ORDER.indexOf(v.provider ?? '');
    return i < 0 ? ORDER.length : i;
  };
  // Stable sort: within an engine, the order the API gives.
  const ordered = [...voices].sort((a, b) => rank(a) - rank(b));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" role="group" aria-label="Giọng đọc">
      {ordered.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          aria-pressed={value === v.id}
          className={`chip ${value === v.id ? 'chip-on' : ''}`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
