'use client';

import type { Voice } from '@/lib/api';

const GROUPS: { provider: string; title: string }[] = [
  { provider: 'gemini', title: 'Gemini' },
  { provider: 'piper', title: 'Piper · thử nghiệm' },
];

/**
 * Voices grouped by the engine that speaks them.
 *
 * The list mixes a cloud provider with a self-hosted one while the second is
 * being judged, and a flat row of thirteen names gives no hint which is which.
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
  const known = new Set(GROUPS.map((g) => g.provider));
  const groups = [
    ...GROUPS,
    // Anything from an engine this list does not know about still shows up.
    ...[...new Set(voices.map((v) => v.provider ?? ''))]
      .filter((p) => !known.has(p))
      .map((p) => ({ provider: p, title: p || 'Khác' })),
  ]
    .map((g) => ({
      ...g,
      items: voices.filter((v) => (v.provider ?? '') === g.provider),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.provider} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="w-full font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)] sm:w-28">
            {g.title}
          </span>
          {g.items.map((v) => (
            <button
              key={v.id}
              onClick={() => onChange(v.id)}
              aria-pressed={value === v.id}
              className={`text-[12px] transition-colors ${
                value === v.id
                  ? 'font-medium text-[var(--color-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
