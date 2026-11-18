import { api, type NarrationTicket, type RenderStatus } from './api';

export class NarrationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrationFailed';
  }
}

export interface AwaitOptions {
  /** Called on every state change, so the button can say what is happening. */
  onStatus?: (status: RenderStatus) => void;
  /** Give up after this long. A chapter takes about half a minute. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Wait for a queued narration to land.
 *
 * Narration is a job now, not a response: the API returns in milliseconds and
 * the audio appears later. Polling rather than a socket because there is one
 * of these at a time per reader and it lasts under a minute - a websocket for
 * that would be more moving parts than the problem deserves.
 *
 * The interval opens at half a second and eases out to three, so an already
 * running job is picked up almost immediately while a long queue is not
 * hammered.
 */
export async function awaitNarration(
  ticket: NarrationTicket,
  opts: AwaitOptions = {},
): Promise<{ url: string; durationMs: number | null }> {
  const { onStatus, timeoutMs = 45 * 60_000, signal } = opts;

  // Already narrated: nothing was queued.
  if (ticket.url) {
    onStatus?.('COMPLETE');
    return { url: ticket.url, durationMs: ticket.durationMs };
  }
  if (!ticket.jobId) {
    throw new NarrationFailed('Không tạo được bản đọc.');
  }

  onStatus?.(ticket.status);

  const deadline = Date.now() + timeoutMs;
  let wait = 500;
  let last: RenderStatus = ticket.status;

  while (Date.now() < deadline) {
    await sleep(wait, signal);
    wait = Math.min(Math.round(wait * 1.4), 3000);

    const state = await api.narrationJob(ticket.jobId);
    if (state.status !== last) {
      last = state.status;
      onStatus?.(state.status);
    }

    if (state.status === 'COMPLETE' && state.url) {
      return { url: state.url, durationMs: null };
    }
    if (state.status === 'FAILED' || state.status === 'CANCELLED') {
      throw new NarrationFailed(state.error ?? 'Tạo bản đọc thất bại.');
    }
  }

  // Not a failure - the job is still queued, most likely behind a whole-branch
  // narration or waiting out the provider's daily limit. The audio will appear
  // on its own; the reader just should not be left watching a spinner.
  throw new NarrationFailed(
    'Bản đọc vẫn đang trong hàng đợi. Quay lại sau ít phút nhé.',
  );
}
