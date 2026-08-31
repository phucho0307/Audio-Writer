'use client';

import { useState } from 'react';
import { ApiError, api, mainBranch, type Story } from '@/lib/api';

/**
 * The revise → promote loop for a published story.
 *
 * Published chapters are frozen, so this is the only route to fixing one. It
 * appears on the main branch (where the writer discovers they cannot edit) and
 * on a revision (where the useful action is putting it live).
 */
export default function RevisePanel({
  story,
  branchId,
  onBranch,
  onChange,
}: {
  story: Story;
  branchId: string | null;
  onBranch: (id: string) => void;
  onChange: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<'revise' | 'promote' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const main = mainBranch(story);
  const isPublic = story.visibility !== 'PRIVATE';
  const onMain = branchId !== null && branchId === main?.id;

  // A private story is editable in place, so none of this applies.
  if (!isPublic) return null;

  async function revise() {
    setBusy('revise');
    setError(null);
    try {
      const branch = await api.revise(story.id);
      await onChange();
      onBranch(branch.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function promote() {
    if (!branchId) return;
    setBusy('promote');
    setError(null);
    try {
      await api.promote(branchId);
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      {onMain ? (
        <>
          <div>
            <div className="text-[13px] font-medium">Truyện đã đăng</div>
            <p className="text-[12px] text-[var(--color-muted)]">
              Chương đã đăng không sửa trực tiếp được — người đang đọc sẽ thấy
              truyện đổi giữa chừng. Tạo một bản sửa, chỉnh thoải mái, rồi dùng
              nó làm bản chính. Viết chương mới thì vẫn bình thường.
            </p>
          </div>
          <button
            onClick={revise}
            disabled={busy !== null}
            className="self-start rounded-md border border-[var(--color-line)] px-3 py-1.5 font-mono text-[12px] transition-colors hover:border-[var(--color-accent)] disabled:opacity-40"
          >
            {busy === 'revise' ? 'đang tạo…' : '⑂ tạo bản sửa'}
          </button>
        </>
      ) : (
        <>
          <div>
            <div className="text-[13px] font-medium">Bản sửa</div>
            <p className="text-[12px] text-[var(--color-muted)]">
              Nhánh này chưa ai đọc. Sửa xong, dùng nó làm bản chính để thay bản
              đang đăng. Bản cũ vẫn được giữ lại.
            </p>
          </div>
          <button
            onClick={promote}
            disabled={busy !== null}
            className="self-start rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[12px] text-white disabled:opacity-40"
          >
            {busy === 'promote' ? 'đang cập nhật…' : 'dùng nhánh này làm bản chính'}
          </button>
        </>
      )}

      {error && <p className="font-mono text-[11px] text-red-500">{error}</p>}
    </section>
  );
}
