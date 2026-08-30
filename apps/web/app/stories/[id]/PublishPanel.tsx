'use client';

import { useState } from 'react';
import { ApiError, api, type Story } from '@/lib/api';

type Visibility = Story['visibility'];

const LABEL: Record<Visibility, string> = {
  PRIVATE: 'Riêng tư',
  UNLISTED: 'Chỉ qua link',
  PUBLIC: 'Công khai',
};

const BLURB: Record<Visibility, string> = {
  PRIVATE: 'Chỉ mình bạn thấy truyện này.',
  UNLISTED: 'Ai có link đều đọc được, nhưng truyện không xuất hiện ở Khám phá.',
  PUBLIC: 'Truyện hiện ở Khám phá, ai cũng đọc được.',
};

export default function PublishPanel({
  story,
  onChange,
}: {
  story: Story;
  onChange: () => Promise<void> | void;
}) {
  // Undeclared until the writer answers. Pre-selecting "cho phép" here would
  // reintroduce exactly the silent default the API now refuses to accept.
  const [forks, setForks] = useState<boolean | null>(story.allowForks);
  const [busy, setBusy] = useState<Visibility | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPrivate = story.visibility === 'PRIVATE';
  const undeclared = forks === null;

  async function apply(visibility: Visibility) {
    setBusy(visibility);
    setError(null);
    try {
      await api.updateStory(story.id, {
        visibility,
        // Only send it when the writer actually chose, so unpublishing does not
        // quietly commit them to a policy they never picked.
        ...(forks !== null ? { allowForks: forks } : {}),
      });
      await onChange();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : (e as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }

  async function setForkPolicy(next: boolean) {
    setForks(next);
    setError(null);
    // Already published: this is a live setting, so save it immediately.
    if (!isPrivate) {
      try {
        await api.updateStory(story.id, { allowForks: next });
        await onChange();
      } catch (e) {
        setForks(story.allowForks);
        setError((e as Error).message);
      }
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">
              {LABEL[story.visibility]}
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isPrivate ? 'bg-[var(--color-muted)]' : 'bg-emerald-500'
              }`}
              aria-hidden
            />
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
            {BLURB[story.visibility]}
          </p>
        </div>
      </div>

      <div className="border-t border-[var(--color-line)] pt-3">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
          rẽ nhánh
        </p>

        <div className="flex flex-col gap-1.5">
          {[
            {
              value: true,
              title: 'Cho phép người khác rẽ nhánh',
              hint: 'Người đọc có thể viết tiếp theo hướng của họ.',
            },
            {
              value: false,
              title: 'Không cho phép',
              hint: 'Chỉ bạn viết tiếp. Các nhánh đã có vẫn giữ nguyên.',
            },
          ].map((opt) => (
            <label
              key={String(opt.value)}
              className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors ${
                forks === opt.value
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-line)] hover:border-[var(--color-muted)]'
              }`}
            >
              <input
                type="radio"
                name={`forks-${story.id}`}
                checked={forks === opt.value}
                onChange={() => void setForkPolicy(opt.value)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-[13px]">{opt.title}</span>
                <span className="block text-[11px] text-[var(--color-muted)]">
                  {opt.hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        {undeclared && (
          <p className="mt-2 font-mono text-[11px] text-amber-600">
            chọn một mục để đăng truyện
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
        {isPrivate ? (
          <>
            <button
              onClick={() => void apply('PUBLIC')}
              disabled={undeclared || busy !== null}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[12px] text-white transition-opacity disabled:opacity-40"
            >
              {busy === 'PUBLIC' ? 'đang đăng…' : 'đăng công khai'}
            </button>
            <button
              onClick={() => void apply('UNLISTED')}
              disabled={undeclared || busy !== null}
              className="rounded-md border border-[var(--color-line)] px-3 py-1.5 font-mono text-[12px] transition-colors hover:border-[var(--color-accent)] disabled:opacity-40"
            >
              {busy === 'UNLISTED' ? 'đang đăng…' : 'chỉ qua link'}
            </button>
          </>
        ) : (
          <button
            onClick={() => void apply('PRIVATE')}
            disabled={busy !== null}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 font-mono text-[12px] text-[var(--color-muted)] transition-colors hover:border-amber-500 hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            {busy === 'PRIVATE' ? 'đang gỡ…' : 'gỡ xuống'}
          </button>
        )}
      </div>

      {error && (
        <p className="font-mono text-[11px] text-red-500">{error}</p>
      )}
    </section>
  );
}
