'use client';

import { useEffect, useRef, useState } from 'react';

/** Text sizes for the chapter, in px; 19 is the designed default. */
const SIZES = [16, 17.5, 19, 21, 23.5];
const KEY = 'aw-text-size';

function apply(px: number) {
  document.documentElement.style.setProperty('--read-size', `${px}px`);
}

/**
 * "Aa": the size of the chapter text.
 *
 * Read aloud or read on a phone at arm's length, one size does not fit: the
 * prose was set at 19px for a laptop. The choice is kept per browser and
 * applied through one CSS variable, so nothing else on the page moves.
 */
export default function ReaderSettings() {
  const [size, setSize] = useState(19);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let kept = 19;
    try {
      const v = Number(localStorage.getItem(KEY));
      if (SIZES.includes(v)) kept = v;
    } catch {}
    setSize(kept);
    apply(kept);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function choose(px: number) {
    setSize(px);
    apply(px);
    try {
      localStorage.setItem(KEY, String(px));
    } catch {}
  }

  const i = SIZES.indexOf(size);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Cỡ chữ"
        title="Cỡ chữ"
        className="btn btn-quiet px-2 font-serif text-[14px]"
      >
        <span className="text-[11px]">A</span>
        <span className="text-[16px]">a</span>
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-30 mt-1.5 flex items-center gap-1 p-1.5 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.5)]">
          <button
            type="button"
            onClick={() => i > 0 && choose(SIZES[i - 1])}
            disabled={i <= 0}
            aria-label="Chữ nhỏ hơn"
            className="btn btn-quiet h-8 w-8 justify-center p-0 font-serif text-[13px]"
          >
            A−
          </button>
          <span className="w-12 text-center text-[11.5px] tabular-nums text-[var(--color-muted)]">
            {Math.round((size / 19) * 100)}%
          </span>
          <button
            type="button"
            onClick={() => i < SIZES.length - 1 && choose(SIZES[i + 1])}
            disabled={i >= SIZES.length - 1}
            aria-label="Chữ to hơn"
            className="btn btn-quiet h-8 w-8 justify-center p-0 font-serif text-[16px]"
          >
            A+
          </button>
        </div>
      )}
    </div>
  );
}
