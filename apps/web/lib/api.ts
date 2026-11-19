import { API } from './env';
import { ensureSession, getSnapshot, getToken, refresh } from './auth';

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

/** Where a reader stopped in a story, as the server keeps it. */
export type ServerProgress = {
  storyId: string;
  title: string;
  coverUrl: string | null;
  totalChapters: number;
  branchId: string | null;
  /** 0-based chapter. */
  depth: number;
  /** Seconds into the chapter's narration. */
  at: number;
  /** Epoch milliseconds. */
  updatedAt: number;
};

export type FollowState = { following: boolean; followers: number };

export type FollowedStory = {
  storyId: string;
  title: string;
  coverUrl: string | null;
  genres: string[];
  totalChapters: number;
  newChapters: number;
  /** 1-based chapter to open to read what is new. */
  firstNew: number;
  updatedAt: string;
};

export type ChapterComment = {
  id: string;
  body: string;
  createdAt: string;
  author: { handle: string; displayName: string; avatarUrl: string | null; premium?: boolean };
  mine: boolean;
  canDelete: boolean;
};

export type CommentPage = { total: number; items: ChapterComment[]; nextCursor: string | null };

export type RelatedStories = {
  /** `similar`: closest in what the story is about. `genre`: shares a genre. */
  basis: 'similar' | 'genre';
  stories: {
    id: string;
    title: string;
    coverUrl: string | null;
    genres: string[];
    contributionCount: number;
    authorName: string | null;
  }[];
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
  /** False while the site has paid chapters switched off (no checkout yet). */
  paidChapters?: boolean;
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

/**
 * Reads the chapter view repeats on every chapter.
 *
 * Moving to the next chapter mounts the page afresh, and it used to ask again
 * for the story, the whole branch and the branch's narration - round trips to
 * a database across an ocean, one after another, seconds before a single word
 * or sound. None of it changes between chapter 3 and chapter 4. Kept for a few
 * minutes per tab, per signed-in user (the branch read depends on who may see
 * which chapters), and dropped by any write, so nobody misses their own change.
 */
const reads = new Map<string, { at: number; data: Promise<unknown> }>();
const READ_MS = 5 * 60_000;

/**
 * Writes that change none of the remembered reads. Listening saves its place
 * every few seconds and narrating the next chapter is a POST: clearing
 * everything on those would throw away exactly the copies kept for moving on.
 */
const UNRELATED_WRITE = /^\/(me\/progress|comments|chapters\/[^/]+\/comments)|\/(view|follow|follow\/seen)$/;

function forgetChangedBy(path: string): void {
  if (UNRELATED_WRITE.test(path)) return;
  // A new narration changes the list of what has sound, and nothing else.
  const audio = /^\/audio\/branches\/([^/?]+)/.exec(path);
  if (audio) return forgetReads(`audio:${audio[1]}:`);
  forgetReads();
}

/** `fresh` skips the copy (and replaces it): the editor, which changes things without a POST. */
function remembered<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
  const k = `${getSnapshot().user?.id ?? '-'}|${key}`;
  const hit = reads.get(k);
  if (!fresh && hit && Date.now() - hit.at < READ_MS) return hit.data as Promise<T>;
  const data = load();
  reads.set(k, { at: Date.now(), data });
  data.catch(() => {
    if (reads.get(k)?.data === data) reads.delete(k);
  });
  return data;
}

/** Drop remembered reads whose key starts with `prefix` (all of them by default). */
export function forgetReads(prefix = ''): void {
  for (const k of [...reads.keys()]) {
    if (k.slice(k.indexOf('|') + 1).startsWith(prefix)) reads.delete(k);
  }
}

async function call<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && /^\/(stories|branches)/.test(path) && !path.endsWith('/view')) shelf = null;
  if (method !== 'GET') forgetChangedBy(path);
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
  premium?: boolean;
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

/** See apps/api/src/admin/admin.service.ts. Admins are never counted. */
export interface AdminStats {
  goal: number;
  /** Active on two or more different days in the last 30. */
  returning: number;
  users: number;
  newWeek: number;
  verified: number;
  active: { day: number; week: number; month: number };
  week: { listeners: number; comments: number; follows: number; ratings: number };
  signups: { handle: string; displayName: string; createdAt: string }[];
}

/** Catalogue-wide counts, for the front page. */
export type HomeTotals = { stories: number; chapters: number; forks: number; words: number };

/** The front page's slice of the shelf (GET /stories/home). */
export type HomeShelf = { covers: string[]; stories: Story[]; totals: HomeTotals };

export type PremiumStatus = {
  /** False until the owner has configured a bank account to be paid into. */
  enabled: boolean;
  price: number;
  days: number;
  perks: { aiFree: number; aiPremium: number; searchFree: number; searchPremium: number };
  premium: boolean;
  premiumUntil: string | null;
};

export type PremiumOrder = {
  code: string;
  amount: number;
  days: number;
  status: 'PENDING' | 'PAID' | 'UNDERPAID';
  paidAmount: number;
  expiresAt: string;
  qrUrl: string;
  bank: { code: string; account: string; name: string };
  premiumUntil: string | null;
};

export interface AdminPayments {
  active: number;
  paidCount: number;
  revenue: number;
  orders: {
    code: string;
    status: 'PAID' | 'UNDERPAID' | 'PENDING';
    amount: number;
    paidAmount: number;
    createdAt: string;
    paidAt: string | null;
    user: { handle: string; displayName: string; premiumUntil: string | null };
  }[];
  unmatched: { id: string; amount: number; content: string; receivedAt: string }[];
}

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

  getStory: (id: string, fresh = false) =>
    remembered(`story:${id}`, () => call<Story>(`/stories/${id}`), fresh),

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

  readBranch: (id: string, fresh = false) =>
    remembered(`branch:${id}`, () => call<BranchRead>(`/branches/${id}`), fresh),

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

  /** The owner's usage numbers. 404 for anyone who is not an admin. */
  adminStats: () => call<AdminStats>('/admin/stats'),
  adminPayments: () => call<AdminPayments>('/admin/payments'),
  adminActivatePremium: (code: string, transferId?: string) =>
    call<{ ok: true }>(`/admin/premium/${encodeURIComponent(code)}/activate`, {
      method: 'POST',
      body: JSON.stringify(transferId ? { transferId } : {}),
    }),

  /** Just what the front page draws: a few dozen stories instead of the whole shelf. */
  homeShelf: () => call<HomeShelf>('/stories/home'),

  premium: () => call<PremiumStatus>('/premium'),
  createPremiumOrder: () => call<PremiumOrder>('/premium/orders', { method: 'POST' }),
  premiumOrder: (code: string) => call<PremiumOrder>(`/premium/orders/${encodeURIComponent(code)}`),

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

  // ---- what a reader carries between visits

  progress: () => call<ServerProgress[]>('/me/progress'),
  saveProgress: (
    storyId: string,
    p: { branchId: string | null; depth: number; at: number; updatedAt: number },
    keepalive = false,
  ) =>
    call<{ ok: true }>(`/me/progress/${storyId}`, {
      method: 'PUT',
      body: JSON.stringify(p),
      // Lets the last position leave with the page when a tab is closed.
      keepalive,
    }),
  forgetProgress: (storyId: string) =>
    call<{ ok: true }>(`/me/progress/${storyId}`, { method: 'DELETE' }),

  followState: (storyId: string) => call<FollowState>(`/stories/${storyId}/follow`),
  follow: (storyId: string) => call<FollowState>(`/stories/${storyId}/follow`, { method: 'PUT' }),
  unfollow: (storyId: string) => call<FollowState>(`/stories/${storyId}/follow`, { method: 'DELETE' }),
  followSeen: (storyId: string) =>
    call<{ ok: true }>(`/stories/${storyId}/follow/seen`, { method: 'POST' }),
  myFollows: () => call<FollowedStory[]>('/me/follows'),

  comments: (chapterId: string, cursor?: string | null) =>
    call<CommentPage>(`/chapters/${chapterId}/comments${cursor ? `?cursor=${cursor}` : ''}`),
  addComment: (chapterId: string, body: string) =>
    call<ChapterComment>(`/chapters/${chapterId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  deleteComment: (id: string) => call<{ deleted: true }>(`/comments/${id}`, { method: 'DELETE' }),

  related: (storyId: string) => call<RelatedStories>(`/stories/${storyId}/related`),

  recordView: (storyId: string) =>
    call<{ viewCount: number }>(`/stories/${storyId}/view`, { method: 'POST' }),

  unlock: (storyId: string) =>
    call<Access>(`/stories/${storyId}/unlock`, { method: 'POST' }),

  wallet: () => call<Wallet>('/me/wallet'),

  voices: () =>
    call<{ available: boolean; voices: Voice[]; default: string }>(
      '/audio/voices',
    ),

  chapterAudio: (branchId: string, voice: string, fresh = false) =>
    // Encoded: self-hosted voice ids carry `:`, `#` and `@`, and an unencoded
    // `#` ends the URL right there - the server would never see the voice.
    remembered(`audio:${branchId}:${voice}`, () =>
      call<ChapterAudio[]>(`/audio/branches/${branchId}?voice=${encodeURIComponent(voice)}`),
    fresh),

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
