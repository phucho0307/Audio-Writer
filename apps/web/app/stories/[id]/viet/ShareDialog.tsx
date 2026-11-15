'use client';

import { useEffect, useState } from 'react';
import { api, type Room, type ShareSettings } from '@/lib/api';

type Role = 'EDITOR' | 'VIEWER';
const ROLE_LABEL: Record<Role, string> = { EDITOR: 'Người viết', VIEWER: 'Người xem' };

/**
 * "Chia sẻ", the way Google Docs does it.
 *
 * Two halves. People: invite by @username as a writer or a viewer, change
 * someone's role, remove them. General access: the room is restricted to
 * those people, or open to anyone with the link - as viewers or as writers -
 * with a copy button and a reset that makes the old link stop working.
 *
 * Owner-only; the server enforces it regardless.
 */
export default function ShareDialog({
  branchId,
  room,
  onRoomChange,
  onClose,
}: {
  branchId: string;
  room: Room;
  onRoomChange: (r: Room) => void;
  onClose: () => void;
}) {
  const [share, setShare] = useState<ShareSettings | null>(null);
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<Role>('EDITOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    api.share(branchId).then(setShare).catch((e: Error) => setError(e.message));
  }, [branchId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function run<T>(fn: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setError(null);
    try {
      then(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const link = share?.token ? `${window.location.origin}/moi/${share.token}` : '';
  const access: 'NONE' | Role = share?.linkAccess ?? 'NONE';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chia sẻ phòng viết"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-y-auto p-6 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
        <div className="flex items-center justify-between">
          <h2 className="display text-[22px]">Chia sẻ phòng viết</h2>
          <button onClick={onClose} aria-label="Đóng" className="btn btn-quiet px-2">
            ✕
          </button>
        </div>

        {/* ---- people ---- */}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const h = handle.trim().replace(/^@/, '');
            if (!h) return;
            void run(() => api.invite(branchId, h, role), (r) => {
              onRoomChange(r);
              setHandle('');
            });
          }}
        >
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Thêm người bằng @username"
            aria-label="Username người được mời"
            className="field min-w-0 flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-label="Quyền"
            className="field w-auto"
          >
            <option value="EDITOR">Người viết</option>
            <option value="VIEWER">Người xem</option>
          </select>
          <button type="submit" disabled={busy || !handle.trim()} className="btn btn-primary">
            Mời
          </button>
        </form>

        <div className="flex flex-col gap-1">
          <span className="label">Người có quyền truy cập</span>
          <ul className="flex flex-col">
            <li className="flex items-center gap-3 py-2 text-[14px]">
              <span className="min-w-0 flex-1 truncate">@{room.owner.handle}</span>
              <span className="text-[12.5px] text-[var(--color-faint)]">Chủ nhánh</span>
            </li>
            {room.collaborators.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-t border-[var(--color-line)] py-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate">@{c.handle}</span>
                <select
                  value={c.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() => api.invite(branchId, c.handle, e.target.value as Role), onRoomChange)
                  }
                  aria-label={`Quyền của @${c.handle}`}
                  className="field w-auto py-1 text-[13px]"
                >
                  <option value="EDITOR">Người viết</option>
                  <option value="VIEWER">Người xem</option>
                </select>
                <button
                  disabled={busy}
                  onClick={() => void run(() => api.revoke(branchId, c.id), onRoomChange)}
                  className="btn btn-quiet btn-sm hover:text-[var(--color-son)]"
                >
                  Gỡ
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* ---- general access ---- */}
        <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-4">
          <span className="label">Quyền truy cập chung</span>
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-raised)] text-[16px]">
              {access === 'NONE' ? '🔒' : '🔗'}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <select
                value={access === 'NONE' ? 'NONE' : 'LINK'}
                disabled={busy || !share}
                onChange={(e) =>
                  void run(
                    () => api.setShare(branchId, e.target.value === 'NONE' ? 'NONE' : 'VIEWER'),
                    setShare,
                  )
                }
                aria-label="Ai có thể mở phòng"
                className="field w-auto self-start py-1 text-[13.5px] font-medium"
              >
                <option value="NONE">Hạn chế</option>
                <option value="LINK">Bất kỳ ai có đường liên kết</option>
              </select>
              <span className="text-[12.5px] text-[var(--color-faint)]">
                {access === 'NONE'
                  ? 'Chỉ những người được thêm ở trên mới mở được phòng.'
                  : 'Ai có đường liên kết và đã đăng nhập đều vào được phòng.'}
              </span>
            </div>
            {access !== 'NONE' && (
              <select
                value={access}
                disabled={busy}
                onChange={(e) => void run(() => api.setShare(branchId, e.target.value as Role), setShare)}
                aria-label="Quyền của người có đường liên kết"
                className="field w-auto py-1 text-[13px]"
              >
                <option value="VIEWER">{ROLE_LABEL.VIEWER}</option>
                <option value="EDITOR">{ROLE_LABEL.EDITOR}</option>
              </select>
            )}
          </div>

          {access !== 'NONE' && link && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input readOnly value={link} aria-label="Đường liên kết" className="field min-w-0 flex-1 text-[12.5px]" onFocus={(e) => e.target.select()} />
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    });
                  }}
                  className="btn btn-primary"
                >
                  {copied ? 'Đã chép ✓' : 'Sao chép liên kết'}
                </button>
              </div>
              {confirmReset ? (
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="text-[var(--color-son)]">
                    Liên kết cũ sẽ hết hiệu lực, ai vào bằng nó sẽ mất quyền.
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => void run(() => api.resetShare(branchId), (s) => { setShare(s); setConfirmReset(false); })}
                    className="btn btn-danger btn-sm"
                  >
                    Đặt lại
                  </button>
                  <button onClick={() => setConfirmReset(false)} className="btn btn-quiet btn-sm">
                    Huỷ
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmReset(true)} className="btn btn-quiet btn-sm self-start">
                  Đặt lại liên kết
                </button>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-[12.5px] text-[var(--color-son)]">{error}</p>}

        <div className="flex justify-end">
          <button onClick={onClose} className="btn btn-ghost">
            Xong
          </button>
        </div>
      </div>
    </div>
  );
}
