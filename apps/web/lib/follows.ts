/**
 * A nudge between the follow button and the bell: the button says a follow
 * changed, the bell reloads. They live in different corners of the page and
 * share nothing else, so an event is lighter than a store.
 */
const EVENT = 'aw-follows';

export function followsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function onFollowsChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
