import { useSyncExternalStore } from 'react';
import { api } from './api';
import { getSnapshot as authSnapshot, subscribe as subscribeAuth } from './auth';

/**
 * Where the reader stopped in each story.
 *
 * Kept on the device first: it works signed out, offline, and before any
 * request has finished. For a signed-in reader it is also copied to the
 * server, and merged back newest-wins, so a story started on the phone is
 * waiting at the same sentence on the laptop.
 */
export type Progress = {
  storyId: string;
  title: string;
  coverUrl: string | null;
  /** A fork being read; null is the story's main line. */
  branchId: string | null;
  /** 1-based, as in the URL. */
  chapter: number;
  totalChapters: number;
  /** Seconds into the chapter's narration; 0 when only reading. */
  at: number;
  updatedAt: number;
};

const KEY = 'aw-progress';
const OPENED = 'aw-opened';
/** Stories remembered on a device; the oldest fall off. */
const KEEP = 40;
/** A position is sent to the server at most this often per story. */
const PUSH_EVERY_MS = 15_000;

type Store = Record<string, Progress>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Store) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  const kept = Object.values(store)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept.map((p) => [p.storyId, p]))));
  } catch {
    // Storage full or blocked: resuming is a convenience, not worth an error.
  }
  emit();
}

// ------------------------------------------------------------ subscriptions

const listeners = new Set<() => void>();
let snapshot: Progress[] | null = null;
const EMPTY: Progress[] = [];

function emit(): void {
  snapshot = null;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // Another tab moved on: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

function current(): Progress[] {
  snapshot ??= Object.values(read()).sort((a, b) => b.updatedAt - a.updatedAt);
  return snapshot;
}

/** Every story in progress on this device, most recent first. Re-renders on change. */
export function useProgress(): Progress[] {
  return useSyncExternalStore(subscribe, current, () => EMPTY);
}

export function progressOf(storyId: string): Progress | null {
  return read()[storyId] ?? null;
}

/** The link that puts the reader back where they were. */
export function resumeHref(p: Pick<Progress, 'storyId' | 'chapter' | 'branchId'>): string {
  return `/doc/${p.storyId}/${p.chapter}${p.branchId ? `?branch=${p.branchId}` : ''}`;
}

// ------------------------------------------------------------------ writing

export function saveProgress(p: Omit<Progress, 'updatedAt'>): void {
  const entry: Progress = { ...p, at: Math.max(0, Math.round(p.at)), updatedAt: Date.now() };
  const store = read();
  store[p.storyId] = entry;
  write(store);
  markOpened(p.storyId);
  schedulePush(entry);
}

/** The story is finished, or the reader took it off the list. */
export function forgetProgress(storyId: string): void {
  const store = read();
  if (!(storyId in store)) return;
  delete store[storyId];
  write(store);
  pending.delete(storyId);
  if (authSnapshot().user) void api.forgetProgress(storyId).catch(() => {});
}

// ---- "has opened a chapter", which outlives finishing the story

function openedIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPENED) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function markOpened(storyId: string): void {
  const ids = openedIds();
  if (ids[0] === storyId) return;
  try {
    localStorage.setItem(OPENED, JSON.stringify([storyId, ...ids.filter((id) => id !== storyId)].slice(0, 200)));
  } catch {}
}

/** Whether a chapter of this story was opened on this device - signed in or not. */
export function hasOpened(storyId: string): boolean {
  return openedIds().includes(storyId);
}

// --------------------------------------------------------------- the server

const pending = new Map<string, Progress>();
const lastPush = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function push(p: Progress, keepalive = false): void {
  lastPush.set(p.storyId, Date.now());
  void api
    .saveProgress(
      p.storyId,
      { branchId: p.branchId, depth: p.chapter - 1, at: p.at, updatedAt: p.updatedAt },
      keepalive,
    )
    .catch(() => {});
}

function flush(keepalive = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!authSnapshot().user) {
    pending.clear();
    return;
  }
  for (const p of pending.values()) push(p, keepalive);
  pending.clear();
}

/** Throttled: the player reports a position every few seconds, the server needs it far less often. */
function schedulePush(p: Progress): void {
  if (!authSnapshot().user) return;
  const since = Date.now() - (lastPush.get(p.storyId) ?? 0);
  if (since >= PUSH_EVERY_MS) {
    pending.delete(p.storyId);
    push(p);
    return;
  }
  pending.set(p.storyId, p);
  timer ??= setTimeout(() => flush(), PUSH_EVERY_MS - since);
}

let mergedFor: string | null = null;

/**
 * Bring this device and the server into agreement, once per sign-in: the
 * newer position wins in each direction.
 */
async function merge(userId: string): Promise<void> {
  if (mergedFor === userId) return;
  mergedFor = userId;
  let remote;
  try {
    remote = await api.progress();
  } catch {
    mergedFor = null; // try again on the next change
    return;
  }
  const store = read();
  const seen = new Set<string>();
  let changed = false;
  for (const r of remote) {
    seen.add(r.storyId);
    const local = store[r.storyId];
    if (!local || local.updatedAt < r.updatedAt) {
      store[r.storyId] = {
        storyId: r.storyId,
        title: r.title,
        coverUrl: r.coverUrl,
        branchId: r.branchId,
        chapter: r.depth + 1,
        totalChapters: r.totalChapters,
        at: r.at,
        updatedAt: r.updatedAt,
      };
      changed = true;
    } else if (local.updatedAt > r.updatedAt) {
      push(local);
    }
  }
  // Started while signed out, or on this device only.
  for (const p of Object.values(store)) if (!seen.has(p.storyId)) push(p);
  if (changed) write(store);
}

if (typeof window !== 'undefined') {
  const onAuth = () => {
    const user = authSnapshot().user;
    if (user) void merge(user.id);
    else mergedFor = null;
  };
  subscribeAuth(onAuth);
  onAuth();
  // The last few seconds of listening, sent as the tab goes away.
  window.addEventListener('pagehide', () => flush(true));
}
