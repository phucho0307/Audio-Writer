'use client';

import { useState } from 'react';
import { resendVerification } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

/**
 * A thin line under the header for an email sign-up that has not clicked
 * its link. Nothing is blocked meanwhile; this only asks.
 */
export default function VerifyBanner() {
  const { user } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (!user || user.emailVerified !== false || hidden) return null;
  const email = user.email;

  async function resend() {
    setBusy(true);
    try {
      await resendVerification();
      setNote(`Đã gửi lại tới ${email}.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[var(--color-accent-line)] bg-[var(--color-accent-soft)]">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[13px] sm:px-8">
        <span>
          Kiểm tra hộp thư <strong>{email}</strong> để xác minh email.
        </span>
        {note ? (
          <span className="text-[var(--color-muted)]">{note}</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={busy}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            {busy ? 'Đang gửi…' : 'Gửi lại email'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Ẩn thông báo"
          className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
