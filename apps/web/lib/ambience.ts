'use client';

/**
 * Whether a story is being read aloud right now.
 *
 * The atmosphere behind the page listens to this and leans in while narration
 * plays - the fog drifts a little faster and the lamp burns a little
 * brighter - so the room responds to the thing the product is actually for.
 * It settles back the moment the audio stops.
 *
 * A module-level counter rather than a boolean, because two players can exist
 * on one page (the chapter strip and the whole-story playlist) and a plain
 * flag would let whichever paused last switch the room off while the other was
 * still playing.
 */
let playing = 0;
const listeners = new Set<(live: boolean) => void>();

function emit(): void {
  const live = playing > 0;
  for (const fn of listeners) fn(live);
}

/** Called by a player when it starts or stops. Idempotent per player. */
export function setNarrating(id: string, live: boolean): void {
  const was = active.has(id);
  if (live === was) return;
  if (live) active.add(id);
  else active.delete(id);
  playing = active.size;
  emit();
}

const active = new Set<string>();

export function isNarrating(): boolean {
  return playing > 0;
}

export function onNarrating(fn: (live: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
