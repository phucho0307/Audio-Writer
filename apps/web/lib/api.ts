import { API } from './env';
import { getToken, refresh } from './auth';

export { API };

export type Story = {
  id: string;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  genres: string[];
  language: string;
  status: string;
  wordCount: number;
  contributionCount: number;
  branchCount: number;
  viewCount: number;
  freeChapters: number;
  unlockPrice: number;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  allowForks: boolean;
  updatedAt: string;
  owner?: { handle: string; displayName: string };
  branches: BranchSummary[];
};

export type BranchSummary = {
  id: string;
  name: string;
  isRoot: boolean;
  depth: number;
  forkedAtDepth: number | null;
  forkedFromBranchId: string | null;
  lineage: string[];
  owner?: { handle: string; displayName: string };
  _count?: { contributions: number };
};

export type Contribution = {
  id: string;
  branchId: string;
  depth: number;
  title: string | null;
  authorType: 'HUMAN' | 'AI';
  textPlain: string;
  wordCount: number;
  createdAt: string;
  modelName: string | null;
  author: { handle: string; displayName: string } | null;
};

export type Access = {
  freeChapters: number;
  unlockPrice: number;
  unlocked: boolean;
  isOwner: boolean;
  lockedCount: number;
};

export type Wallet = {
  readCredits: number;
  earned: number;
  paidOut: number;
  balance: number;
};

export type BranchRead = {
  branch: BranchSummary & {
    story: { id: string; title: string; genres: string[]; language: string };
  };
  contributions: Contribution[];
  ownedCount: number;
  text: string;
  access: Access;
};

export type PlotOption = {
  id: string;
  title: string;
  pitch: string;
  tone: string;
  firstLine: string;
};

export type Quota = {
  dailyLimit: number;
  usedToday: number;
  freeRemaining: number;
  creditsRemaining: number;
  totalRemaining: number;
  unlimited: boolean;
  resetsAt: string;
};

export type Voice = { id: string; label: string };

export type ChapterAudio = {
  depth: number;
  contributionId: string;
  url: string | null;
  durationMs: number | null;
  preview: string;
  locked: boolean;
};

export type NarrateResult = {
  narrated: number;
  alreadyHad: number;
  stoppedAt: number | null;
  reason: string | null;
  chapters: ChapterAudio[];
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/**
 * `retry` guards against a loop: if the refreshed token is also rejected,
 * something is wrong that another round trip will not fix.
 */
async function call<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: authHeaders(init?.headers),
    credentials: 'include',
    cache: 'no-store',
  });

  // The access token lasts fifteen minutes and is gone after any page load, so
  // a 401 is the expected state rather than an error. Renew and repeat once;
  // the caller never sees it.
  if (res.status === 401 && retry) {
    const token = await refresh();
    if (token) return call<T>(path, init, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.message ?? res.statusText,
      body.code,
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  /** The public shelf: PUBLIC stories only, works signed out. */
  listStories: () => call<Story[]>('/stories'),

  /** Your own workspace: every story you own, drafts included. */
  myStories: () => call<Story[]>('/stories?mine=true'),

  getStory: (id: string) => call<Story>(`/stories/${id}`),

  createStory: (body: { title: string; genres?: string[]; language?: string }) =>
    call<Story>('/stories', { method: 'POST', body: JSON.stringify(body) }),

  updateStory: (
    id: string,
    body: {
      genres?: string[];
      title?: string;
      freeChapters?: number;
      unlockPrice?: number;
      visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
      status?: 'DRAFTING' | 'COMPLETE' | 'ARCHIVED';
      allowForks?: boolean;
    },
  ) =>
    call<Story>(`/stories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteStory: (id: string) =>
    call<{ deleted: boolean; id: string }>(`/stories/${id}`, {
      method: 'DELETE',
    }),

  readBranch: (id: string) => call<BranchRead>(`/branches/${id}`),

  commit: (
    branchId: string,
    body: {
      textPlain: string;
      authorType: 'HUMAN' | 'AI';
      modelName?: string;
      modelProvider?: string;
    },
  ) =>
    call<Contribution>(`/branches/${branchId}/contributions`, {
      method: 'POST',
      body: JSON.stringify({
        // The editor is a plain textarea for now. The schema stores structure
        // and flat text separately, so swapping in TipTap later only changes
        // what goes in `content`.
        content: { type: 'doc', text: body.textPlain },
        ...body,
      }),
    }),

  fork: (branchId: string, body: { atDepth: number; name?: string }) =>
    call<BranchSummary>(`/branches/${branchId}/fork`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  suggest: (branchId: string, count = 4) =>
    call<PlotOption[]>(`/ai/branches/${branchId}/suggest`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  quota: () => call<Quota>('/ai/quota'),

  recordView: (storyId: string) =>
    call<{ viewCount: number }>(`/stories/${storyId}/view`, { method: 'POST' }),

  unlock: (storyId: string) =>
    call<Access>(`/stories/${storyId}/unlock`, { method: 'POST' }),

  wallet: () => call<Wallet>('/me/wallet'),

  voices: () =>
    call<{ available: boolean; voices: Voice[]; default: string }>(
      '/audio/voices',
    ),

  chapterAudio: (branchId: string, voice: string) =>
    call<ChapterAudio[]>(`/audio/branches/${branchId}?voice=${voice}`),

  /** Mode one: narrate a single chapter. */
  narrateChapter: (branchId: string, depth: number, voice: string) =>
    call<{ url: string; durationMs: number; cached: boolean }>(
      `/audio/branches/${branchId}/chapters/${depth}`,
      { method: 'POST', body: JSON.stringify({ voice }) },
    ),

  /** Mode two: narrate every chapter that does not have audio yet. */
  narrateBranch: (branchId: string, voice: string) =>
    call<NarrateResult>(`/audio/branches/${branchId}`, {
      method: 'POST',
      body: JSON.stringify({ voice }),
    }),

  /** Dev-only stand-in for checkout. */
  buyReadCredits: (amount = 20) =>
    call<Wallet>('/me/credits/grant', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  /** Dev-only stand-in for checkout. */
  grantCredits: (amount = 10) =>
    call<Quota>('/ai/quota/grant', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
};

/**
 * Consumes one of the SSE prose endpoints, invoking `onChunk` as text arrives
 * so the editor fills in progressively instead of sitting blank for 3 seconds.
 */
export async function streamProse(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  retry = true,
): Promise<void> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  });

  // Safe to repeat: nothing has been read off the stream yet, and no
  // contribution is written until the prose comes back.
  if (res.status === 401 && retry) {
    const token = await refresh();
    if (token) return streamProse(path, body, onChunk, false);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.message ?? res.statusText, err.code);
  }
  if (!res.body) throw new ApiError(500, 'no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const lines = frame.split(/\r?\n/);
      const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
      const data = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
      if (!data) continue;

      if (event === 'chunk') onChunk(JSON.parse(data) as string);
      if (event === 'error') {
        throw new ApiError(500, (JSON.parse(data) as { message: string }).message);
      }
    }
  }
}
