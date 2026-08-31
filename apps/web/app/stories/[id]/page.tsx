'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AudioPlayer from './AudioPlayer';
import PublishPanel from './PublishPanel';
import Chapter from './Chapter';
import RevisePanel from './RevisePanel';
import {
  mainBranchId,
  ApiError,
  api,
  streamProse,
  type BranchRead,
  type PlotOption,
  type Quota,
  type Story,
  type Wallet,
} from '@/lib/api';

const GENRES = [
  'ngoại tình',
  'kinh dị',
  'lãng mạn',
  'hành động',
  'trinh thám',
  'huyền bí',
  'tâm lý',
  'hài hước',
];

export default function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // A fork lands here with ?branch=, so the writer opens on their own branch
  // rather than the original they just diverged from.
  const wanted = useSearchParams().get('branch');

  const [story, setStory] = useState<Story | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needGenres, setNeedGenres] = useState(false);
  const [options, setOptions] = useState<PlotOption[] | null>(null);
  // Short by default. The writer should stay ahead of the AI, not react to it.
  const [paragraphs, setParagraphs] = useState<1 | 2 | 3>(1);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [paywall, setPaywall] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editGenres, setEditGenres] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which chapter the contents list has opened for editing. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);

  const draftRef = useRef<HTMLTextAreaElement>(null);

  const loadStory = useCallback(async () => {
    const s = await api.getStory(id);
    setStory(s);
    setBranchId(
      (b) =>
        b ??
        (wanted && s.branches.some((x) => x.id === wanted)
          ? wanted
          : (mainBranchId(s) ?? null)),
    );
  }, [id, wanted]);

  useEffect(() => {
    loadStory().catch((e: Error) => setError(e.message));
    api.quota().then(setQuota).catch(() => {});
    api.wallet().then(setWallet).catch(() => {});
    api.recordView(id).catch(() => {});
  }, [loadStory, id]);

  useEffect(() => {
    if (!branchId) return;
    api
      .readBranch(branchId)
      .then(setRead)
      .catch((e: Error) => setError(e.message));
  }, [branchId]);

  async function refresh() {
    await loadStory();
    if (branchId) setRead(await api.readBranch(branchId));
  }

  // -------------------------------------------------------------------------

  async function commit(authorType: 'HUMAN' | 'AI') {
    if (!branchId || !draft.trim()) return;
    setBusy('commit');
    setError(null);
    try {
      await api.commit(branchId, {
        textPlain: draft.trim(),
        authorType,
        ...(authorType === 'AI'
          ? { modelProvider: 'gemini', modelName: 'gemini-2.5-flash' }
          : {}),
      });
      setDraft('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runStream(path: string, label: string) {
    setBusy(label);
    setError(null);
    setNeedGenres(false);
    setPaywall(null);
    setDraft('');
    try {
      await streamProse(path, { paragraphs }, (chunk) =>
        setDraft((d) => d + chunk),
      );
      draftRef.current?.focus();
    } catch (e) {
      handleAiError(e);
    } finally {
      setBusy(null);
      api.quota().then(setQuota).catch(() => {});
    }
  }

  function handleAiError(e: unknown) {
    if (e instanceof ApiError && e.code === 'GENRES_REQUIRED') {
      setNeedGenres(true);
      return;
    }
    if (e instanceof ApiError && e.code === 'AI_QUOTA_EXCEEDED') {
      setPaywall(e.message);
      return;
    }
    setError((e as Error).message);
  }

  async function suggest() {
    if (!branchId) return;
    setBusy('suggest');
    setError(null);
    setPaywall(null);
    try {
      setOptions(await api.suggest(branchId, 4));
    } catch (e) {
      handleAiError(e);
    } finally {
      setBusy(null);
      api.quota().then(setQuota).catch(() => {});
    }
  }

  /** Choosing a direction forks the branch - the story keeps both futures. */
  async function takeOption(opt: PlotOption) {
    if (!branchId || !read) return;
    setBusy('fork');
    try {
      const branch = await api.fork(branchId, {
        atDepth: read.branch.depth,
        name: opt.title.slice(0, 40),
      });
      setOptions(null);
      setBranchId(branch.id);
      setDraft(opt.firstLine + '\n\n');
      await loadStory();
      draftRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function unlock() {
    setBusy('unlock');
    setError(null);
    try {
      await api.unlock(id);
      if (branchId) setRead(await api.readBranch(branchId));
      setWallet(await api.wallet());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setPricing(patch: { freeChapters?: number; unlockPrice?: number }) {
    await api.updateStory(id, patch);
    await loadStory();
  }

  /** A branch nobody reads. The API refuses the live one and any that have
   * been forked from, so failures show rather than being guessed at here. */
  async function removeBranch(id: string) {
    setBusy('branch');
    setError(null);
    try {
      await api.deleteBranch(id);
      setConfirmBranch(null);
      if (branchId === id) setBranchId(mainBranchId(story!) ?? null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirmBranch(null);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api.deleteStory(id);
      window.location.href = '/';
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function addGenres(genres: string[]) {
    await api.updateStory(id, { genres });
    setNeedGenres(false);
    await loadStory();
  }

  /** Saves the title, or silently drops the edit if it is unchanged or empty. */
  async function saveTitle() {
    const next = titleDraft?.trim();
    setTitleDraft(null);
    if (!next || !story || next === story.title) return;

    // Optimistic: renaming should feel instant, and a failure just restores.
    const previous = story.title;
    setStory({ ...story, title: next });
    try {
      await api.updateStory(id, { title: next });
    } catch (e) {
      setStory((s) => (s ? { ...s, title: previous } : s));
      setError((e as Error).message);
    }
  }

  // -------------------------------------------------------------------------

  if (error && !story) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          ← Về trang chủ
        </Link>
      </main>
    );
  }

  if (!story || !read) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-[var(--color-muted)]">Đang tải…</p>
      </main>
    );
  }

  const empty = read.contributions.length === 0;

  // The branch readers land on is frozen once the story is public - changing a
  // chapter under them is what a revision is for. Unlike the fork-inheritance
  // rule, this one is knowable here, so the controls are hidden rather than
  // offered and refused.
  const liveBranchId = mainBranchId(story) ?? null;
  const frozen =
    story.visibility !== 'PRIVATE' && branchId === liveBranchId;
  const chaptersEditable = read.access.isOwner && !frozen;
  // Grey the AI out when it is spent, rather than letting a click fail. Writing
  // by hand stays available regardless - that is the point of the cap.
  const aiSpent = quota !== null && !quota.unlimited && quota.totalRemaining === 0;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      {/* ---- header ---- */}
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← tất cả truyện
        </Link>
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveTitle();
              }
              if (e.key === 'Escape') setTitleDraft(null);
            }}
            aria-label="Tên truyện"
            className="w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] px-2 py-1 font-serif text-3xl tracking-tight outline-none"
          />
        ) : (
          <button
            onClick={() => setTitleDraft(story.title)}
            title="Bấm để sửa tên"
            className="group -mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-[var(--color-accent-soft)]"
          >
            <h1 className="font-serif text-3xl tracking-tight">
              {story.title}
            </h1>
            <span className="font-mono text-[11px] text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100">
              sửa
            </span>
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {story.genres.map((g) => (
            <span
              key={g}
              className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] text-[var(--color-accent)]"
            >
              {g}
            </span>
          ))}
          <button
            onClick={() => setEditGenres((v) => !v)}
            className="rounded-full border border-dashed border-[var(--color-line)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {story.genres.length ? 'sửa thể loại' : '+ thể loại'}
          </button>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {story.wordCount} từ
          </span>
        </div>

        {editGenres && (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
            {GENRES.map((g) => {
              const on = story.genres.includes(g);
              return (
                <button
                  key={g}
                  onClick={() =>
                    addGenres(
                      on
                        ? story.genres.filter((x) => x !== g)
                        : [...story.genres, g],
                    )
                  }
                  className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- branch switcher ---- */}
      {story.branches.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-muted)]">
            Nhánh · {story.branches.length}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {story.branches.map((b) => {
              const live = b.id === liveBranchId;
              const mine = read.access.isOwner;
              return (
                <span
                  key={b.id}
                  className={`group/br flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] ${
                    b.id === branchId
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-accent)]'
                  }`}
                >
                  <button onClick={() => setBranchId(b.id)}>
                    {live ? `${b.isRoot ? 'main' : b.name} · đang đăng` : b.name}
                    {b.isDraft && (
                      <span className="ml-1.5 font-mono text-[10px] opacity-70">
                        riêng tư
                      </span>
                    )}
                    {b.forkedAtDepth !== null && (
                      <span className="ml-1.5 font-mono text-[10px] opacity-60">
                        ⑂{b.forkedAtDepth}
                      </span>
                    )}
                  </button>

                  {/* The live branch is the published story; removing it would
                      leave readers with nothing. */}
                  {mine && !live && (
                    confirmBranch === b.id ? (
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        <button
                          onClick={() => void removeBranch(b.id)}
                          disabled={busy !== null}
                          className="text-red-500 underline disabled:opacity-40"
                        >
                          {busy === 'branch' ? 'đang xoá…' : 'xoá?'}
                        </button>
                        <button
                          onClick={() => setConfirmBranch(null)}
                          className="underline opacity-70"
                        >
                          huỷ
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmBranch(b.id)}
                        aria-label={`Xoá nhánh ${b.name}`}
                        className="font-mono text-[13px] leading-none opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover/br:opacity-100"
                      >
                        ×
                      </button>
                    )
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- contents ---- */}
      {read.contributions.length > 1 && (
        <section className="flex flex-col">
          <h2 className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-2 font-mono text-[11px] uppercase tracking-widest text-[var(--color-muted)]">
            <span>Mục lục</span>
            {chaptersEditable && (
              <span className="normal-case tracking-normal opacity-70">
                bấm vào chương để sửa
              </span>
            )}
          </h2>

          <ol className="flex flex-col">
            {read.contributions.map((c) => (
              <li key={c.id}>
                {/* An anchor, not a route: the chapters are already on this
                    page, and navigating away would lose the editor state. */}
                <a
                  href={`#chuong-${c.depth + 1}`}
                  onClick={() => {
                    // Picking a chapter from the list is how you choose what
                    // to edit; the anchor still does the scrolling.
                    if (chaptersEditable && c.branchId === branchId) {
                      setEditingId(c.id);
                    }
                  }}
                  className="group flex items-baseline gap-4 border-b border-[var(--color-line)] py-2.5 transition-colors"
                >
                  <span className="w-7 flex-none font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
                    {c.depth + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] transition-colors group-hover:text-[var(--color-accent)]">
                    {c.title ?? c.textPlain.split('\n')[0].slice(0, 60)}
                  </span>
                  <span className="flex flex-none items-baseline gap-3 font-mono text-[10.5px] text-[var(--color-muted)]">
                    {c.authorType === 'AI' && (
                      <span className="text-[var(--color-accent)]">AI</span>
                    )}
                    {c.branchId !== branchId && (
                      <span className="opacity-60">kế thừa</span>
                    )}
                    <span className="opacity-60">{c.wordCount} từ</span>
                  </span>
                </a>
              </li>
            ))}

            {read.access.lockedCount > 0 && (
              <li className="flex items-baseline gap-4 border-b border-[var(--color-line)] py-2.5 opacity-50">
                <span className="w-7 flex-none font-mono text-[12px]">🔒</span>
                <span className="flex-1 text-[14px] text-[var(--color-muted)]">
                  Còn {read.access.lockedCount} chương chưa mở khoá
                </span>
              </li>
            )}
          </ol>
        </section>
      )}

      {/* ---- the story ---- */}
      <article className="flex flex-col gap-5">
        {empty && (
          <p className="text-sm text-[var(--color-muted)]">
            Chưa có gì. Viết đoạn đầu tiên, hoặc để AI mở đầu giúp bạn.
          </p>
        )}
        {read.contributions.map((c, i) => (
          <Chapter
            key={c.id}
            chapter={c}
            inherited={c.branchId !== branchId}
            isLast={i === read.contributions.length - 1}
            canEdit={chaptersEditable}
            editing={editingId === c.id}
            onOpen={() => setEditingId(c.id)}
            onClose={() => setEditingId(null)}
            onChange={refresh}
          />
        ))}
      </article>

      {/* ---- locked chapters ---- */}
      {read.access.lockedCount > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-amber-500 bg-[var(--color-surface)] p-4">
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              Còn {read.access.lockedCount} chương nữa
            </span>
            <span className="text-[13px] text-[var(--color-muted)]">
              {read.access.freeChapters} chương đầu luôn miễn phí. Mở khoá để
              đọc tiếp và rẽ nhánh từ bất kỳ chương nào.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={unlock}
              disabled={busy !== null}
              className="rounded-md bg-amber-600 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === 'unlock'
                ? 'Đang mở khoá…'
                : `Mở khoá · ${read.access.unlockPrice} credit`}
            </button>
            <span className="font-mono text-[11px] text-[var(--color-muted)]">
              bạn có {wallet?.readCredits ?? 0} credit
            </span>
            {(wallet?.readCredits ?? 0) < read.access.unlockPrice && (
              <button
                onClick={async () => setWallet(await api.buyReadCredits(20))}
                className="rounded-md border border-[var(--color-line)] px-3 py-1.5 font-mono text-[11px] hover:border-[var(--color-accent)]"
              >
                nạp 20 · dev
              </button>
            )}
          </div>
        </section>
      )}

      {/* ---- narration ---- */}
      {!empty && branchId && <AudioPlayer branchId={branchId} />}

      {/* ---- plot options ---- */}
      {options && (
        <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-accent)]">
              Chọn hướng đi · mỗi lựa chọn tạo một nhánh mới
            </span>
            <button
              onClick={() => setOptions(null)}
              className="font-mono text-[11px] text-[var(--color-muted)] hover:underline"
            >
              đóng
            </button>
          </div>
          <div className="grid gap-2.5">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => takeOption(o)}
                disabled={busy !== null}
                className="flex flex-col gap-1.5 rounded-md border border-[var(--color-line)] p-3 text-left transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
              >
                <span className="font-medium">{o.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {o.tone}
                </span>
                <span className="text-[13px] text-[var(--color-muted)]">
                  {o.pitch}
                </span>
                <span className="font-serif text-[13px] italic opacity-80">
                  “{o.firstLine}”
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- paywall ---- */}
      {paywall && (
        <section className="flex flex-col gap-3 rounded-lg border border-amber-500 bg-[var(--color-surface)] p-4">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{paywall}</span>
            <span className="text-[13px] text-[var(--color-muted)]">
              Viết tiếp bằng tay thì không giới hạn — và thường ra truyện hay
              hơn. Lượt AI sẽ được cấp lại lúc nửa đêm.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setPaywall(null);
                draftRef.current?.focus();
              }}
              className="rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white"
            >
              Tự viết tiếp
            </button>
            <button
              onClick={async () => {
                setQuota(await api.grantCredits(10));
                setPaywall(null);
              }}
              className="rounded-md border border-amber-500 px-3.5 py-2 text-sm text-amber-700 dark:text-amber-400"
            >
              Mua 10 lượt · dev
            </button>
          </div>
        </section>
      )}

      {/* ---- genre gate ---- */}
      {needGenres && (
        <section className="flex flex-col gap-2.5 rounded-lg border border-amber-500 bg-[var(--color-surface)] p-4">
          <span className="text-sm">
            Chọn ít nhất một thể loại để AI biết viết theo hướng nào.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {GENRES.map((g) => (
              <button
                key={g}
                onClick={() => addGenres([...story.genres, g])}
                className="rounded-full border border-[var(--color-line)] px-3 py-1 text-[13px] text-[var(--color-muted)] hover:border-[var(--color-accent)]"
              >
                {g}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- writer: pricing ---- */}
      {read.access.isOwner && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[var(--color-muted)]">
            <span>{story.viewCount} lượt xem</span>
            <span>·</span>
            <span>
              {story.unlockPrice > 0
                ? `${story.freeChapters} chương đầu miễn phí · ${story.unlockPrice} credit`
                : 'toàn bộ miễn phí'}
            </span>
            <button
              onClick={() => setShowPricing((v) => !v)}
              className="underline hover:text-[var(--color-accent)]"
            >
              {showPricing ? 'đóng' : 'đặt giá'}
            </button>
            {(wallet?.balance ?? 0) > 0 && (
              <span className="text-[var(--color-accent)]">
                đã kiếm {wallet?.balance} credit
              </span>
            )}
          </div>

          {showPricing && (
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <p className="text-[13px] text-[var(--color-muted)]">
                Truyện vẫn luôn lan truyền được: các chương đầu không bao giờ bị
                khoá, ai cũng đọc và rẽ nhánh được. Chỉ phần sau mới tính phí.
              </p>

              <label className="flex items-center gap-3 text-[13px]">
                <span className="w-40">Số chương miễn phí</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={story.freeChapters}
                  onChange={(e) =>
                    setPricing({ freeChapters: Number(e.target.value) })
                  }
                  className="w-20 rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-2 py-1 font-mono"
                />
              </label>

              <label className="flex items-center gap-3 text-[13px]">
                <span className="w-40">Giá mở khoá (credit)</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={story.unlockPrice}
                  onChange={(e) =>
                    setPricing({ unlockPrice: Number(e.target.value) })
                  }
                  className="w-20 rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-2 py-1 font-mono"
                />
                <span className="font-mono text-[11px] text-[var(--color-muted)]">
                  0 = miễn phí hoàn toàn
                </span>
              </label>

              {story.unlockPrice > 0 && (
                <p className="font-mono text-[11px] text-[var(--color-muted)]">
                  bạn nhận {Math.round((story.unlockPrice * 70) / 100)} credit
                  mỗi lượt mở khoá (70%)
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {read.access.isOwner && (
        <PublishPanel story={story} onChange={loadStory} />
      )}

      {read.access.isOwner && (
        <RevisePanel
          story={story}
          branchId={branchId}
          onBranch={setBranchId}
          onChange={refresh}
        />
      )}

      {/* Its own block rather than a link among the pricing controls, where it
          was both hard to find and one slip away from an accidental click. */}
      {read.access.isOwner && (
        <section className="flex flex-col gap-3 rounded-lg border border-red-500/40 bg-[var(--color-surface)] p-4">
          <div>
            <div className="text-[13px] font-medium">Xoá truyện</div>
            <p className="text-[12px] text-[var(--color-muted)]">
              Xoá cả {story.contributionCount} chương, mọi nhánh và giọng đọc.
              Không khôi phục được.
            </p>
          </div>

          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-red-600 dark:text-red-400">
                Chắc chắn xoá “{story.title}”?
              </span>
              <button
                onClick={remove}
                disabled={busy !== null}
                className="rounded-md bg-red-600 px-3 py-1.5 font-mono text-[12px] text-white disabled:opacity-40"
              >
                {busy === 'delete' ? 'đang xoá…' : 'xoá vĩnh viễn'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="font-mono text-[12px] text-[var(--color-muted)] underline"
              >
                huỷ
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="self-start rounded-md border border-red-500/60 px-3 py-1.5 font-mono text-[12px] text-red-600 transition-colors hover:bg-red-600 hover:text-white dark:text-red-400"
            >
              xoá truyện
            </button>
          )}
        </section>
      )}

      {/* ---- composer ---- */}
      <section className="flex flex-col gap-3">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          placeholder="Viết tiếp câu chuyện…"
          className="w-full resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 font-serif text-[16px] leading-[1.75] outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => commit('HUMAN')}
            disabled={!draft.trim() || busy !== null}
            className="rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy === 'commit' ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>

          {draft.trim() && (
            <button
              onClick={() => commit('AI')}
              disabled={busy !== null}
              className="rounded-md border border-[var(--color-line)] px-3.5 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-40"
            >
              Lưu thay đổi · ghi nhận AI viết
            </button>
          )}

          <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />

          {/* How much the AI writes per turn. Short keeps the writer in charge. */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              đoạn
            </span>
            <div className="flex overflow-hidden rounded-md border border-[var(--color-line)]">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setParagraphs(n)}
                  aria-pressed={paragraphs === n}
                  className={`px-2.5 py-1.5 font-mono text-[12px] transition-colors ${
                    paragraphs === n
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {empty ? (
            <button
              onClick={() =>
                runStream(`/ai/stories/${id}/seed`, 'seed')
              }
              disabled={busy !== null || aiSpent}
              className="rounded-md border border-[var(--color-accent)] px-3.5 py-2 text-sm text-[var(--color-accent)] disabled:opacity-40"
            >
              {busy === 'seed' ? 'AI đang viết…' : '✦ AI viết mở đầu'}
            </button>
          ) : (
            <>
              <button
                onClick={() =>
                  runStream(`/ai/branches/${branchId}/continue`, 'continue')
                }
                disabled={busy !== null || aiSpent}
                className="rounded-md border border-[var(--color-accent)] px-3.5 py-2 text-sm text-[var(--color-accent)] disabled:opacity-40"
              >
                {busy === 'continue' ? 'AI đang viết…' : '✦ AI viết tiếp'}
              </button>
              <button
                onClick={suggest}
                disabled={busy !== null || aiSpent}
                className="rounded-md border border-[var(--color-line)] px-3.5 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-40"
              >
                {busy === 'suggest' ? 'Đang nghĩ…' : 'Bí ý tưởng?'}
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="font-mono text-[13px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {quota && (
          <p className="font-mono text-[11px] text-[var(--color-muted)]">
            {quota.unlimited ? (
              <>khoá riêng · không giới hạn lượt AI</>
            ) : (
              <>
                <span
                  className={
                    quota.totalRemaining === 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[var(--color-accent)]'
                  }
                >
                  {quota.totalRemaining}
                </span>{' '}
                lượt AI còn lại hôm nay
                {quota.creditsRemaining > 0 && (
                  <> · {quota.creditsRemaining} lượt đã mua</>
                )}
                {' · '}
                {quota.usedToday}/{quota.dailyLimit} đã dùng
              </>
            )}
          </p>
        )}
      </section>
    </main>
  );
}
