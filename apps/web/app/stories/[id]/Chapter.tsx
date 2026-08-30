'use client';

import { useState } from 'react';
import { ApiError, api, type Contribution } from '@/lib/api';

/**
 * One chapter, with the controls to fix or remove it.
 *
 * Editing is refused by the API once someone has forked from this chapter,
 * which cannot be known from here - so the buttons stay offered and the
 * refusal is shown when it happens. Hiding them pre-emptively would need the
 * fork graph on every render to save a click that is almost never wasted.
 */
export default function Chapter({
  chapter,
  inherited,
  isLast,
  canEdit,
  onChange,
}: {
  chapter: Contribution;
  inherited: boolean;
  isLast: boolean;
  canEdit: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = draft !== null;

  function open() {
    setDraft(chapter.textPlain);
    setTitleDraft(chapter.title ?? '');
    setError(null);
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.editChapter(chapter.id, {
        textPlain: draft,
        title: titleDraft.trim() || undefined,
      });
      setDraft(null);
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteChapter(chapter.id);
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id={`chuong-${chapter.depth + 1}`}
      className="group/ch flex scroll-mt-6 flex-col gap-1.5"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
        <span>#{chapter.depth}</span>
        <span
          className={
            chapter.authorType === 'AI'
              ? 'text-[var(--color-accent)]'
              : undefined
          }
        >
          {chapter.authorType === 'AI'
            ? `AI · ${chapter.modelName ?? ''}`
            : 'bạn'}
        </span>
        {inherited && <span className="opacity-60">· kế thừa</span>}

        {/* Inherited chapters belong to the branch they came from; editing one
            here would rewrite somebody else's story. */}
        {canEdit && !inherited && !editing && (
          <span className="ml-auto flex items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/ch:opacity-100">
            <button
              onClick={open}
              className="normal-case underline hover:text-[var(--color-ink)]"
            >
              sửa
            </button>
            {isLast &&
              (confirming ? (
                <>
                  <span className="normal-case text-red-500">xoá chương?</span>
                  <button
                    onClick={remove}
                    disabled={busy}
                    className="normal-case text-red-500 underline disabled:opacity-40"
                  >
                    {busy ? 'đang xoá…' : 'xoá'}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="normal-case underline"
                  >
                    huỷ
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="normal-case underline hover:text-red-500"
                >
                  xoá
                </button>
              ))}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="Tên chương (không bắt buộc)"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-3 py-1.5 text-[14px]"
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(24, draft.split('\n').length + 4)}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-3 py-2 font-serif text-[16px] leading-[1.7]"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[12px] text-white disabled:opacity-40"
            >
              {busy ? 'đang lưu…' : 'lưu'}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="font-mono text-[12px] text-[var(--color-muted)] underline"
            >
              huỷ
            </button>
            <span className="font-mono text-[11px] text-[var(--color-muted)]">
              sửa xong sẽ phải tạo lại giọng đọc cho chương này
            </span>
          </div>
        </div>
      ) : (
        <>
          {chapter.title && (
            <h3 className="font-serif text-[19px]">{chapter.title}</h3>
          )}
          <p className="whitespace-pre-wrap font-serif text-[17px] leading-[1.75]">
            {chapter.textPlain}
          </p>
        </>
      )}

      {error && (
        <p className="font-mono text-[11px] text-amber-600">{error}</p>
      )}
    </div>
  );
}
