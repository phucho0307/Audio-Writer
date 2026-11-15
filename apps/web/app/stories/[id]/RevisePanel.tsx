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
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
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
      const branch = await api.revise(story.id, name.trim() || undefined);
      await onChange();
      onBranch(branch.id);
      setNaming(false);
      setName('');
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
    <section className="flex flex-col gap-3 card p-4">
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
          {naming ? (
            <div className="flex flex-col gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3">
              <label className="font-mono text-[12px] uppercase tracking-wide text-[var(--color-muted)]">
                Tên bản sửa
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void revise()}
                maxLength={80}
                placeholder="ví dụ: sửa lỗi chính tả chương 3"
                className="field"
              />
              <p className="text-[11px] text-[var(--color-muted)]">
                Chỉ bạn thấy tên này, để phân biệt các bản sửa với nhau. Bỏ
                trống cũng được.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={revise}
                  disabled={busy !== null}
                  className="btn btn-primary btn-sm"
                >
                  {busy === 'revise' ? 'Đang tạo…' : 'Tạo bản sửa'}
                </button>
                <button
                  onClick={() => setNaming(false)}
                  className="btn btn-quiet btn-sm"
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNaming(true)}
              className="btn btn-ghost btn-sm self-start"
            >
              <span aria-hidden>⑂</span> Tạo bản sửa
            </button>
          )}
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
            className="self-start btn btn-primary btn-sm"
          >
            {busy === 'promote'
              ? 'Đang cập nhật…'
              : 'Dùng nhánh này làm bản chính'}
          </button>
        </>
      )}

      {error && <p className="text-[12px] text-[var(--color-son)]">{error}</p>}
    </section>
  );
}
