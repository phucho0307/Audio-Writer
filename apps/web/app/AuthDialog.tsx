'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AuthError,
  closeSignIn,
  getDialog,
  getServerDialog,
  setSignInMode,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  subscribeDialog,
} from '@/lib/auth';
import { useProviders } from '@/lib/useAuth';
import { BRAND } from '@/lib/brand';
import { GoogleMark } from './SignInWall';

/**
 * Sign in / sign up, over whatever the reader was doing.
 *
 * Opened by `signIn(reason)` from anywhere - tapping a star, forking a
 * chapter, the account button - so nobody is sent away from the page to
 * create an account and has to find their way back. Mounted once, in the
 * layout.
 */
export default function AuthDialog() {
  const d = useSyncExternalStore(subscribeDialog, getDialog, getServerDialog);
  const providers = useProviders();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const signup = d.mode === 'signup';

  useEffect(() => {
    if (!d.open) return;
    setError(null);
    const t = setTimeout(() => first.current?.focus(), 30);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSignIn();
      // Keep Tab inside the dialog.
      if (e.key === 'Tab' && box.current) {
        const items = box.current.querySelectorAll<HTMLElement>('button, input, a[href]');
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [d.open, d.mode]);

  if (!d.open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (signup) await signUpWithPassword(email, password, name);
      else await signInWithPassword(email, password);
      setPassword('');
    } catch (err) {
      const ae = err as AuthError;
      setError(ae.message);
      // "Already registered" is not a dead end: offer the other tab.
      if (ae.code === 'EMAIL_TAKEN') setSignInMode('signin');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        onClick={closeSignIn}
        className="auth-scrim absolute inset-0 bg-[color-mix(in_oklab,var(--color-ground)_55%,black_45%)] backdrop-blur-sm"
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="auth-card relative flex max-h-[92dvh] w-full max-w-[420px] flex-col gap-5 overflow-y-auto rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-ground)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-xl sm:p-7"
      >
        <button
          type="button"
          onClick={closeSignIn}
          aria-label="Đóng"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <div className="flex flex-col gap-1.5 pr-8">
          <h2 id="auth-title" className="display text-[1.7rem] leading-tight">
            {signup ? 'Tạo tài khoản' : `Đăng nhập ${BRAND}`}
          </h2>
          <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">
            {(signup ? d.reason?.replace(/^Đăng nhập để/, 'Tạo tài khoản để') : d.reason) ?? (signup ? 'Để chấm sao, rẽ nhánh và viết truyện của riêng bạn.' : 'Chào mừng bạn quay lại.')}
          </p>
        </div>

        {providers?.google && (
          <>
            <button type="button" onClick={signInWithGoogle} className="btn btn-ghost w-full justify-center">
              <GoogleMark />
              Tiếp tục với Google
            </button>
            <div className="flex items-center gap-3 text-[11.5px] text-[var(--color-faint)]" aria-hidden>
              <span className="h-px flex-1 bg-[var(--color-line)]" />
              hoặc dùng email
              <span className="h-px flex-1 bg-[var(--color-line)]" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {signup && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-[var(--color-muted)]">Tên hiển thị</span>
              <input
                ref={first}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="nickname"
                required
                className="field"
                placeholder="Ví dụ: Lan Nhi"
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-[var(--color-muted)]">Email</span>
            <input
              ref={signup ? undefined : first}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              required
              className="field"
              placeholder="ban@email.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between text-[12.5px] text-[var(--color-muted)]">
              Mật khẩu
              {signup && <span className="text-[11px] text-[var(--color-faint)]">ít nhất 8 ký tự</span>}
            </span>
            <span className="relative flex">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined}
                maxLength={128}
                required
                className="field w-full pr-16"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-pressed={show}
                className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-[11.5px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                {show ? 'Ẩn' : 'Hiện'}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-[12.5px] text-[var(--color-son)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password || (signup && (!name.trim() || password.length < 8))}
            className="btn btn-primary mt-1 w-full justify-center"
          >
            {busy ? 'Đang xử lý…' : signup ? 'Tạo tài khoản' : 'Đăng nhập'}
          </button>
        </form>

        <p className="text-center text-[13px] text-[var(--color-muted)]">
          {signup ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
          <button
            type="button"
            onClick={() => { setError(null); setSignInMode(signup ? 'signin' : 'signup'); }}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            {signup ? 'Đăng nhập' : 'Đăng ký'}
          </button>
        </p>
      </div>
    </div>
  );
}
