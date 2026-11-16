'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { resetPassword, signIn } from '@/lib/auth';

/** Where the password-reset email's button lands: choose a new password. */
export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Kept in memory, out of the address bar and its history.
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
    window.history.replaceState(null, '', '/dat-lai-mat-khau');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError('Hai lần nhập mật khẩu chưa khớp.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token ?? '', password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-5 px-5 py-16">
      <span className="label label-accent">Đặt lại mật khẩu</span>
      {done ? (
        <>
          <h1 className="display text-[2rem] leading-tight">Đã đổi mật khẩu.</h1>
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            Bạn đã được đăng nhập. Các thiết bị khác đã bị đăng xuất để an toàn.
          </p>
          <Link href="/kham-pha" className="btn btn-primary self-start">
            Đi tới Khám phá
          </Link>
        </>
      ) : token === '' ? (
        <>
          <h1 className="display text-[2rem] leading-tight">Liên kết không đầy đủ.</h1>
          <p className="text-[15px] text-[var(--color-muted)]">Mở lại liên kết trong email, hoặc yêu cầu liên kết mới.</p>
          <button type="button" onClick={() => signIn(undefined, 'forgot')} className="btn btn-primary self-start">
            Yêu cầu liên kết mới
          </button>
        </>
      ) : (
        <>
          <h1 className="display text-[2rem] leading-tight">Chọn mật khẩu mới.</h1>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between text-[12.5px] text-[var(--color-muted)]">
                Mật khẩu mới <span className="text-[11px] text-[var(--color-faint)]">ít nhất 8 ký tự</span>
              </span>
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                autoFocus
                className="field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-[var(--color-muted)]">Nhập lại</span>
              <input
                type={show ? 'text' : 'password'}
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
                required
                className="field"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Hiện mật khẩu
            </label>
            {error && (
              <p role="alert" className="text-[13px] text-[var(--color-son)]">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy || password.length < 8 || !again} className="btn btn-primary">
              {busy ? 'Đang lưu…' : 'Lưu mật khẩu mới'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
