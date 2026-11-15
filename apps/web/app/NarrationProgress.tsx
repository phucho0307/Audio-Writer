'use client';

import { useEffect, useRef, useState } from 'react';
import type { RenderStatus } from '@/lib/api';

/**
 * A progress bar for work whose progress nobody can actually measure.
 *
 * The synthesiser reports nothing between "started" and "done", so this is a
 * model of the wait rather than a reading of it - and it is shaped around how
 * waiting feels rather than around being linear:
 *
 * - **It moves at once.** A bar that sits at zero reads as broken. It opens at a
 *   few percent before the server has even answered.
 * - **It runs fast early and slows down.** Covering most of the distance in the
 *   first stretch makes the whole wait feel shorter than an even crawl to the
 *   same end, and the slow tail is where a wait feels "nearly done".
 * - **It never finishes on its own.** The curve approaches 94% and stops. Only
 *   the job completing takes it to 100, so it cannot claim to be done early and
 *   then sit there - which is the one thing that makes a fake bar feel fake.
 * - **It never goes backwards,** even when the estimate arrives late or the job
 *   leaves the queue.
 *
 * The estimate comes from the server, per driver and per chapter length, and
 * only sets how quickly the curve rises.
 */

const QUEUE_CEILING = 0.14;
const RUN_CEILING = 0.94;
const OPENING = 0.04;

function message(p: number, status: RenderStatus | null, done: boolean) {
  if (done) return 'Xong rồi';
  if (status === 'QUEUED') return 'Đang xếp hàng…';
  if (p < 0.3) return 'Đang chuẩn bị giọng đọc…';
  if (p < 0.62) return 'Đang đọc chương truyện…';
  if (p < 0.85) return 'Đang hoàn thiện âm thanh…';
  return 'Sắp xong rồi…';
}

export default function NarrationProgress({
  status,
  estimatedMs,
  done = false,
  compact = false,
}: {
  status: RenderStatus | null;
  estimatedMs: number | null;
  done?: boolean;
  /** A thin inline bar for a row in a chapter list. */
  compact?: boolean;
}) {
  const [p, setP] = useState(OPENING);
  const startedAt = useRef(performance.now());
  const runningSince = useRef<number | null>(null);
  const floor = useRef(OPENING);

  useEffect(() => {
    if (status === 'RUNNING' && runningSince.current === null) {
      runningSince.current = performance.now();
    }
  }, [status]);

  useEffect(() => {
    if (done) {
      setP(1);
      return;
    }
    const expected = Math.max(estimatedMs ?? 45_000, 5_000);

    const tick = () => {
      const now = performance.now();
      let next: number;

      if (runningSince.current === null) {
        // In the queue: creep, but stay low. Nothing is being made yet, and a
        // bar that is half full before work starts has nowhere left to go.
        const t = now - startedAt.current;
        next = OPENING + (QUEUE_CEILING - OPENING) * (1 - Math.exp(-t / 8_000));
      } else {
        // Rising exponential: ~85% of the way at the estimate, ~93% at twice it,
        // and asymptotic after that.
        const t = now - runningSince.current;
        const from = Math.max(floor.current, QUEUE_CEILING);
        next = from + (RUN_CEILING - from) * (1 - Math.exp((-2.3 * t) / expected));
      }

      if (runningSince.current === null) floor.current = Math.max(floor.current, next);
      setP((prev) => Math.max(prev, next));
    };

    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [estimatedMs, done]);

  const pct = Math.round(p * 100);
  const bar = (
    <div
      role="progressbar"
      aria-label="Tiến độ tạo giọng đọc"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`overflow-hidden rounded-full bg-[var(--color-line)] ${
        compact ? 'h-[3px] w-16' : 'h-1 w-full'
      }`}
    >
      <div
        className={`h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out motion-reduce:transition-none ${
          done ? '' : 'animate-pulse motion-reduce:animate-none'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        {bar}
        <span className="w-8 text-right tabular-nums">{pct}%</span>
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[12px] text-[var(--color-muted)]">
        <span aria-live="polite">{message(p, status, done)}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      {bar}
    </div>
  );
}
