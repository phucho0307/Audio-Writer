'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  type BranchRead,
  type Contribution,
  type Story,
} from '@/lib/api';

/**
 * Choosing where to diverge.
 *
 * The whole screen exists to make one decision legible: everything up to the
 * chapter you pick stays as it was, and everything after it becomes yours. The
 * original is never touched, which is the thing people need to believe before
 * they will touch someone else's story at all.
 */
export default function ForkPicker({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [story, setStory] = useState<Story | null>(null);
  const [read, setRead] = useState<BranchRead | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStory(id);
        setStory(s);
        const root = s.branches.find((b) => b.isRoot);
        if (root) setRead(await api.readBranch(root.id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  async function fork() {
    if (!read || picked === null) return;
    setBusy(true);
    setError(null);
    try {
      const branch = await api.fork(read.branch.id, {
        atDepth: picked,
        name: `nhánh từ chương ${picked + 1}`,
      });
      window.location.href = `/stories/${id}?branch=${branch.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error && !story) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href="/kham-pha" className="mt-4 inline-block text-sm underline">
          ← Quay lại
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

  const chapters: Contribution[] = read.contributions;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-9 px-6 py-10">
      <Link
        href="/kham-pha"
        className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
      >
        ← khám phá
      </Link>

      {/* ---- story header ---- */}
      <header className="flex gap-5">
        {story.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.coverUrl}
            alt=""
            className="h-[164px] w-[118px] flex-none rounded-lg object-cover"
          />
        )}
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl leading-tight tracking-tight">
            {story.title}
          </h1>
          <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">
            {story.synopsis}
          </p>
          <div className="mt-auto flex flex-wrap gap-1">
            {story.genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] text-[var(--color-accent)]"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ---- the question ---- */}
      <div className="flex flex-col gap-1.5 border-l-2 border-[var(--color-accent)] pl-4">
        <h2 className="font-serif text-xl">Chương nào nên rẽ hướng khác?</h2>
        <p className="text-[13px] text-[var(--color-muted)]">
          Chọn chương cuối cùng bạn muốn giữ. Mọi thứ sau đó bạn viết lại.
        </p>
      </div>

      {/* ---- chapter list ---- */}
      <ol className="flex flex-col gap-2">
        {chapters.map((c, i) => {
          const kept = picked !== null && i <= picked;
          const rewritten = picked !== null && i > picked;
          const isPick = picked === i;

          return (
            <li key={c.id}>
              <button
                onClick={() => setPicked(isPick ? null : i)}
                aria-pressed={isPick}
                className={`flex w-full gap-3.5 rounded-lg border p-3.5 text-left transition-colors ${
                  isPick
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : rewritten
                      ? 'border-dashed border-[var(--color-line)] opacity-45'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full font-mono text-[12px] ${
                    kept
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'border border-[var(--color-line)] text-[var(--color-muted)]'
                  }`}
                >
                  {i + 1}
                </span>

                <span className="flex min-w-0 flex-col gap-1">
                  <span className="line-clamp-2 font-serif text-[15px] leading-relaxed">
                    {c.textPlain.split('\n')[0]}
                  </span>
                  {isPick && (
                    <span className="font-mono text-[11px] text-[var(--color-accent)]">
                      ⑂ nhánh của bạn bắt đầu ngay sau chương này
                    </span>
                  )}
                  {rewritten && (
                    <span className="font-mono text-[11px] text-[var(--color-muted)]">
                      bạn sẽ viết lại phần này
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ---- commit ---- */}
      <div className="sticky bottom-4 flex flex-col gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-lg">
        {picked === null ? (
          <p className="text-[13px] text-[var(--color-muted)]">
            Chọn một chương ở trên để bắt đầu.
          </p>
        ) : (
          <p className="text-[13px] text-[var(--color-muted)]">
            Giữ lại <strong className="text-[var(--color-ink)]">chương 1–{picked + 1}</strong>
            , viết tiếp từ{' '}
            <strong className="text-[var(--color-ink)]">chương {picked + 2}</strong>.
            Bản gốc của {story.owner?.displayName ?? 'tác giả'} không thay đổi.
          </p>
        )}

        <button
          onClick={fork}
          disabled={picked === null || busy}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-35"
        >
          {busy ? 'Đang tạo nhánh…' : '⑂ Rẽ nhánh và viết tiếp'}
        </button>

        {error && (
          <p className="font-mono text-[12px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
