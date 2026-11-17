import { API } from './env';
import { ensureSession, getToken, refresh } from './auth';

export { API };

export type DiscoveryResult = {
  id: string;
  title: string;
  coverUrl: string | null;
  genres: string[];
  contributionCount: number;
  viewCount: number;
  ratingCount: number;
  ratingSum: number;
  authorName: string | null;
  summary: string;
  moods: string[];
  ending: 'HE' | 'SE' | 'OE' | 'UNKNOWN';
  why: string;
};

export type Discovery = {
  understood: { query: string; genres: string[]; moods: string[]; tropes: string[]; ending: string };
  results: DiscoveryResult[];
  coverage: { withCard: number; total: number };
};

export type RatingSummary = {
  average: number | null;
  count: number;
  mine: number | null;
  canRate: boolean;
  reason: 'SIGN_IN' | 'READ_FIRST' | 'OWN_STORY' | null;
};

export type Story = {
  id: string;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  coverCredit?: CoverCredit | null;
  textSource?: TextSource | null;
  genres: string[];
  language: string;
  status: string;
  wordCount: number;
  contributionCount: number;
  branchCount: number;
  forkedByOthers?: number;
  viewCount: number;
  /** Reader ratings: the average is shown only once there are enough. */
  ratingCount?: number;
  ratingSum?: number;
  freeChapters: number;
  unlockPrice: number;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  allowForks: boolean;
  mainBranchId: string | null;
  createdAt: string;
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
  isDraft: boolean;
  owner?: { handle: string; displayName: string };
  _count?: { contributions: number };
};

export type CoverCredit = {
  provider: 'Pexels';
  sourceUrl: string;
  photographer?: string;
  photographerUrl?: string;
  licenseUrl: string;
};

export type TextSource = {
  authorId: string;
  authorName: string;
  name: string;
  url: string;
  importedAt: string;
  license?: { name: string; url: string };
  changes?: string;
  collectionId?: 'chinese-drama';
  translator?: string | null;
};

export type CoverCandidate = {
  id: string;
  previewUrl: string;
  description: string;
  credit: CoverCredit;
  recommended: boolean;
};

export type CoverSuggestions = {
  searchId: string;
  source: 'library' | 'pexels';
  candidates: CoverCandidate[];
  hasMore: boolean;
};

export type CoverUpdate = Pick<Story, 'coverUrl' | 'coverCredit'>;

export type MyBranch = {
  id: string;
  name: string;
  depth: number;
  forkedAtDepth: number | null;
  updatedAt: string;
  _count: { contributions: number };
  story: {
    id: string;
    title: string;
    coverUrl: string | null;
    genres: string[];
    owner: { handle: string; displayName: string };
  };
};

export type Contribution = {
  id: string;
  /** The editor's document; older chapters hold only a placeholder here. */
  content?: unknown;
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

export type DraftState = {
  branchId: string;
  text: string;
  wordCount: number;
  version: number;
  updatedAt: string | null;
};

export type Collaborator = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'EDITOR' | 'VIEWER';
  since: string;
};

export type ShareSettings = {
  linkAccess: 'EDITOR' | 'VIEWER' | null;
  token: string | null;
};

export type Room = {
  owner: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  collaborators: Collaborator[];
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

export type Voice = {
  id: string;
  label: string;
  /** Which engine speaks it - `gemini` or `piper` - so the picker can group. */
  provider?: string;
};

export type ChapterAudio = {
  depth: number;
  contributionId: string;
  url: string | null;
  durationMs: number | null;
  preview: string;
  locked: boolean;
};

export type RenderStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

/**
 * What asking for narration returns now.
 *
 * The API answers in milliseconds with a job rather than blocking for the ~28
 * seconds a chapter takes to synthesise. `cached: true` means the audio was
 * already there and no work was queued, so `url` is filled in and `jobId` is
 * null.
 */
export type NarrationTicket = {
  jobId: string | null;
  status: RenderStatus;
  url: string | null;
  durationMs: number | null;
  cached: boolean;
  /** Rough synthesis time, for the progress bar. Null when nothing was queued. */
  estimatedMs: number | null;
};

export type NarrationJobState = {
  jobId: string;
  status: RenderStatus;
  url: string | null;
  error: string | null;
};

export type NarrateResult = {
  queued: number;
  alreadyHad: number;
  chapters: ChapterAudio[];
};

/**
 * The branch readers land on.
 *
 * Not always the root: revising a published story promotes a copy, and from
 * then on the root is history. Everything that used to reach for `isRoot`
 * goes through here so the answer cannot differ between pages.
 */
export function mainBranch(story: Story): BranchSummary | undefined {
  return (
    (story.mainBranchId
      ? story.branches.find((b) => b.id === story.mainBranchId)
      : undefined) ?? story.branches.find((b) => b.isRoot)
  );
}

/**
 * Same answer as `mainBranch`, but works on a list row too.
 *
 * The shelf query only carries the root branch, so a story whose main has been
 * promoted elsewhere would resolve to the wrong one; `mainBranchId` is on the
 * story itself and is right either way.
 */
export function mainBranchId(story: Story): string | undefined {
  return story.mainBranchId ?? mainBranch(story)?.id ?? story.branches[0]?.id;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function authHeaders(extra?: HeadersInit, multipart = false): HeadersInit {
  const token = getToken();
  return {
    ...(!multipart ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/**
 * `retry` guards against a loop: if the refreshed token is also rejected,
 * something is wrong that another round trip will not fix.
 */
/**
 * The public shelf, kept for a minute per tab.
 *
 * The front page and Khám phá both ask for the whole catalogue, and moving
 * between them used to download it again each time. A write to a story or a
 * branch drops the copy, so a writer who has just published sees it.
 */
let shelf: { at: number; data: Promise<Story[]> } | null = null;
const SHELF_MS = 60_000;

async function call<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && /^\/(stories|branches)/.test(path) && !path.endsWith('/view')) shelf = null;
  await ensureSession();
  const res = await fetch(API + path, {
    ...init,
    headers: authHeaders(init?.headers, init?.body instanceof FormData),
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

/** The signed-in user's own settings. */
export type MyProfile = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  bio: string | null;
  handleChangedAt: string | null;
  /** When the handle may next be changed; null if it may be changed now. */
  nextHandleChangeAt: string | null;
};

/** What anyone sees on /u/[handle]. */
export type PublicProfile = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  stories: {
    id: string;
    title: string;
    synopsis: string | null;
    coverUrl: string | null;
    genres: string[];
    contributionCount: number;
    viewCount: number;
  }[];
};

export const api = {
  /** The public shelf: PUBLIC stories only, works signed out. */
  listStories: (): Promise<Story[]> => {
    if (shelf && Date.now() - shelf.at < SHELF_MS) return shelf.data;
    const data = call<Story[]>('/stories');
    shelf = { at: Date.now(), data };
    // A failed load is not worth remembering.
    data.catch(() => {
      if (shelf?.data === data) shelf = null;
    });
    return data;
  },

  /** Your own workspace: every story you own, drafts included. */
  myStories: () => call<Story[]>('/stories?mine=true'),

  /** Branches I wrote in other people's stories. */
  myBranches: () => call<MyBranch[]>('/me/branches'),

  getStory: (id: string) => call<Story>(`/stories/${id}`),

  uploadCover: (id: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return call<CoverUpdate>(`/stories/${id}/cover/upload`, { method: 'POST', body });
  },

  suggestCovers: (id: string, hint = '', page = 1) =>
    call<CoverSuggestions>(`/stories/${id}/cover/suggest`, {
      method: 'POST', body: JSON.stringify({ hint, page }),
    }),

  selectCover: (id: string, searchId: string, candidateId: string) =>
    call<CoverUpdate>(`/stories/${id}/cover/select`, {
      method: 'POST', body: JSON.stringify({ searchId, candidateId }),
    }),

  removeCover: (id: string) =>
    call<CoverUpdate>(`/stories/${id}/cover`, { method: 'DELETE' }),

  createStory: (body: {
    title: string;
    genres?: string[];
    language?: string;
    visibility?: 'PRIVATE' | 'PUBLIC';
    allowForks?: boolean;
  }) =>
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

  /** An editable copy of the published version. */
  revise: (storyId: string, name?: string) =>
    call<BranchSummary>(`/stories/${storyId}/revise`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),

  /** Only a branch nobody reads: not the live one, and not forked from. */
  deleteBranch: (branchId: string) =>
    call<{ deleted: boolean; id: string }>(`/branches/${branchId}`, {
      method: 'DELETE',
    }),

  /** Back to private. Takes the story private too if this is the live one. */
  unpublishBranch: (branchId: string) =>
    call<{ unpublished: boolean; id: string; storyWentPrivate: boolean }>(
      `/branches/${branchId}/unpublish`,
      { method: 'POST' },
    ),

  /** Make a branch the one readers land on. */
  promote: (branchId: string) =>
    call<{ promoted: boolean; branchId: string }>(
      `/branches/${branchId}/promote`,
      { method: 'POST' },
    ),

  /** Owner-only, and refused once someone has forked from this chapter. */
  editChapter: (
    contributionId: string,
    body: { textPlain?: string; title?: string; content?: unknown },
  ) =>
    call<Contribution>(`/contributions/${contributionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Only the last chapter of a branch. */
  deleteChapter: (contributionId: string) =>
    call<{ deleted: boolean; id: string; branchDeleted?: boolean; branchId?: string }>(`/contributions/${contributionId}`, {
      method: 'DELETE',
    }),

  commit: (
    branchId: string,
    body: {
      textPlain: string;
      authorType: 'HUMAN' | 'AI';
      modelName?: string;
      modelProvider?: string;
      content?: unknown;
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

  /**
   * Forking carries its first chapter, so a branch only exists once there is
   * something in it. Clicking "rẽ nhánh" no longer creates anything.
   */
  fork: (
    branchId: string,
    body: {
      atDepth: number;
      name?: string;
      textPlain: string;
      authorType: 'HUMAN' | 'AI';
      title?: string;
      modelProvider?: string;
      modelName?: string;
      content?: unknown;
    },
  ) =>
    call<BranchSummary>(`/branches/${branchId}/fork`, {
      method: 'POST',
      body: JSON.stringify({
        content: { type: 'doc', text: body.textPlain },
        ...body,
      }),
    }),

  /** `fresh` skips the answer other readers already got and uses a quota turn. */
  suggest: (branchId: string, count = 4, fresh = false) =>
    call<PlotOption[]>(`/ai/branches/${branchId}/suggest`, {
      method: 'POST',
      body: JSON.stringify({ count, fresh }),
    }),

  quota: () => call<Quota>('/ai/quota'),

  /** The reading list and the craft notes behind the generator. */

  // --------------------------------------------------------------- drafts
  //
  // The draft itself travels over the WebSocket, not through here. These are
  // the things around it: who may be in the room, what the text is for anyone
  // not holding a socket, and the two actions that end a drafting session.

  draft: (branchId: string) =>
    call<DraftState>(`/branches/${branchId}/draft`),

  draftPresence: (branchId: string) =>
    call<{ count: number; people: { handle: string }[] }>(
      `/branches/${branchId}/draft/presence`,
    ),

  room: (branchId: string) =>
    call<Room>(`/branches/${branchId}/draft/collaborators`),

  /** The room's general access: restricted, or anyone with the link. */
  share: (branchId: string) =>
    call<ShareSettings>(`/branches/${branchId}/draft/share`),

  setShare: (branchId: string, access: 'NONE' | 'VIEWER' | 'EDITOR') =>
    call<ShareSettings>(`/branches/${branchId}/draft/share`, {
      method: 'PUT',
      body: JSON.stringify({ access }),
    }),

  resetShare: (branchId: string) =>
    call<ShareSettings>(`/branches/${branchId}/draft/share/reset`, { method: 'POST' }),

  /** Open a share link: joins the room at the link's level. */
  myProfile: () => call<MyProfile>('/me/profile'),

  updateProfile: (patch: { displayName?: string; handle?: string; bio?: string | null }) =>
    call<MyProfile>('/me/profile', { method: 'PATCH', body: JSON.stringify(patch) }),

  /** `image` is a data: URL of an already cropped, shrunken square. */
  setAvatar: (image: string) =>
    call<MyProfile>('/me/avatar', { method: 'PUT', body: JSON.stringify({ image }) }),

  clearAvatar: () => call<MyProfile>('/me/avatar', { method: 'DELETE' }),

  checkHandle: (handle: string) =>
    call<{ handle: string; available: boolean; problem: string | null }>(
      `/me/handle-check?handle=${encodeURIComponent(handle)}`,
    ),

  profile: (handle: string) =>
    call<PublicProfile>(`/users/${encodeURIComponent(handle)}`),

  joinShare: (token: string) =>
    call<{ storyId: string; branchId: string; role: 'OWNER' | 'EDITOR' | 'VIEWER' }>(
      `/share/${encodeURIComponent(token)}/join`,
      { method: 'POST' },
    ),

  invite: (branchId: string, handle: string, role: 'EDITOR' | 'VIEWER') =>
    call<Room>(`/branches/${branchId}/draft/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ handle, role }),
    }),

  revoke: (branchId: string, userId: string) =>
    call<Room>(`/branches/${branchId}/draft/collaborators/${userId}`, {
      method: 'DELETE',
    }),

  /**
   * Publish the room. `branchId` in the answer is where the chapter actually
   * went: the room's own branch for its owner, or - for an invited writer -
   * a branch of their own split from it, with `forked` set.
   */
  commitDraft: (branchId: string, title?: string) =>
    call<Contribution & { forked: boolean }>(
      `/branches/${branchId}/draft/commit`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  /** The model writes into the room; nothing comes back but a byte count. */
  draftAi: (
    branchId: string,
    opts: { paragraphs?: number; pov?: 'first' | 'third_limited' } = {},
  ) =>
    call<{ written: number }>(`/branches/${branchId}/draft/ai`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  /** AI story search: a request in the reader's own words. */
  discover: (q: string, previous?: string) =>
    call<Discovery>('/discover', {
      method: 'POST',
      body: JSON.stringify({ q, ...(previous ? { previous } : {}) }),
    }),

  /** Average (null until enough readers rated), count, and the caller's own. */
  storyRating: (storyId: string) => call<RatingSummary>(`/stories/${storyId}/rating`),
  rateStory: (storyId: string, stars: number) =>
    call<RatingSummary>(`/stories/${storyId}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ stars }),
    }),
  unrateStory: (storyId: string) =>
    call<RatingSummary>(`/stories/${storyId}/rating`, { method: 'DELETE' }),

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
    // Encoded: self-hosted voice ids carry `:`, `#` and `@`, and an unencoded
    // `#` ends the URL right there - the server would never see the voice.
    call<ChapterAudio[]>(
      `/audio/branches/${branchId}?voice=${encodeURIComponent(voice)}`,
    ),

  /** Mode one: queue a single chapter. Returns a job, not a clip. */
  narrateChapter: (branchId: string, depth: number, voice: string) =>
    call<NarrationTicket>(`/audio/branches/${branchId}/chapters/${depth}`, {
      method: 'POST',
      body: JSON.stringify({ voice }),
    }),

  narrationJob: (jobId: string) =>
    call<NarrationJobState>(`/audio/jobs/${jobId}`),

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
