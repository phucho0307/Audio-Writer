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
      <div className="label flex items-center gap-2.5">
        {/* `depth` is 0-based - it is a position in the chain, not a
            chapter number. Everywhere it is shown to a reader it gets +1. */}
        <span>Chương {chapter.depth + 1}</span>
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
            here would rewrite somebody else's story.

            Always visible rather than hover-revealed: deleting the last
            chapter makes the one before it the last, and hunting for a hover
            target that moved is what made deleting a few feel impossible. */}
        {canEdit && !inherited && !editing && (
          <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
            <button onClick={onOpen} className="btn btn-quiet btn-sm">
              Sửa
            </button>
            {isLast &&
              (confirming ? (
                <>
                  {/* Deleting a chapter cannot be undone, so the confirmation
                      says which one rather than just "are you sure?" - the
                      sentence is the safeguard. */}
                  <span className="text-[12px] text-[var(--color-son)]">
                    Xoá chương {chapter.depth + 1}?
                  </span>
                  <button
                    onClick={remove}
                    disabled={busy}
                    className="btn btn-danger btn-sm"
                  >
                    {busy ? 'Đang xoá…' : 'Xoá'}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="btn btn-quiet btn-sm"
                  >
                    Huỷ
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="btn btn-quiet btn-sm hover:text-[var(--color-son)]"
                >
                  Xoá
                </button>
              ))}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5 rounded-[5px] border border-[var(--color-accent-line)] bg-[var(--color-surface)] p-3.5">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="Tên chương (không bắt buộc)"
            className="field"
          />
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(26, draft.split('\n').length + 4)}
            className="field resize-y font-serif text-[16.5px] leading-[1.75]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !draft.trim() || !dirty}
              className="btn btn-primary btn-sm"
            >
              {busy ? 'đang lưu…' : 'lưu thay đổi'}
            </button>
            <button onClick={onClose} className="btn btn-quiet btn-sm">
              Huỷ
            </button>
            {dirty && (
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-accent)]">
                <span className="dot dot-on" aria-hidden />
                chưa lưu
              </span>
            )}
            <span className="text-[11.5px] text-[var(--color-faint)]">
              Sửa lời thì phải tạo lại giọng đọc cho chương này
            </span>
          </div>
        </div>
      ) : (
        <>
          {chapter.title && (
            <h3 className="display text-[19px]">{chapter.title}</h3>
          )}
          <p className="whitespace-pre-wrap font-serif text-[17.5px] leading-[1.78]">
            {chapter.textPlain}
          </p>
        </>
      )}

      {error && <p className="text-[12px] text-[var(--color-son)]">{error}</p>}
    </div>
  );
}
