'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type Contribution } from '@/lib/api';

/**
 * One chapter, and its editor.
 *
 * Which chapter is open is owned by the page rather than this component, so
 * the contents list can open one directly - picking a chapter from the list is
 * how you get here, and that only works if something above both knows.
 */
export default function Chapter({
  chapter,
  inherited,
  isLast,
  canEdit,
  editing,
  onOpen,
  onClose,
  onChange,
}: {
  chapter: Contribution;
  inherited: boolean;
  isLast: boolean;
  canEdit: boolean;
  editing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(chapter.textPlain);
  const [titleDraft, setTitleDraft] = useState(chapter.title ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Reset from the server copy each time it opens, so a cancelled edit does
  // not come back when the chapter is opened again.
  useEffect(() => {
    if (!editing) return;
    setDraft(chapter.textPlain);
    setTitleDraft(chapter.title ?? '');
    setError(null);
    area.current?.focus();
  }, [editing, chapter.textPlain, chapter.title]);

  const dirty =
    draft !== chapter.textPlain || titleDraft !== (chapter.title ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.editChapter(chapter.id, {
        textPlain: draft,
        title: titleDraft.trim() || undefined,
      });
      await onChange();
      onClose();
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
      onClose();
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
              onClick={onOpen}
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
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="Tên chương (không bắt buộc)"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-3 py-1.5 text-[14px]"
          />
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(26, draft.split('\n').length + 4)}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-3 py-2 font-serif text-[16px] leading-[1.7]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !draft.trim() || !dirty}
              className="rounded-md bg-[var(--color-accent)] px-3.5 py-1.5 font-mono text-[12px] text-white disabled:opacity-40"
            >
              {busy ? 'đang lưu…' : 'lưu thay đổi'}
            </button>
            <button
              onClick={onClose}
              className="font-mono text-[12px] text-[var(--color-muted)] underline"
            >
              huỷ
            </button>
            {dirty && (
              <span className="font-mono text-[11px] text-amber-600">
                chưa lưu
              </span>
            )}
            <span className="font-mono text-[11px] text-[var(--color-muted)]">
              sửa lời thì phải tạo lại giọng đọc cho chương này
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

      {error && <p className="font-mono text-[11px] text-amber-600">{error}</p>}
    </div>
  );
}
