'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useProviders } from '@/lib/useAuth';
import { takeReturnPath } from '@/lib/auth';

/** Initials, for when Google has no avatar or the image fails to load. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  // Vietnamese names put the given name last, which is what people answer to.
  const last = parts[parts.length - 1] ?? '';
  return (parts.length > 1 ? parts[0][0] + last[0] : last.slice(0, 2))
    .toUpperCase();
}

export default function Account() {
  const { user, ready, signIn, signOut } = useAuth();

  // Back to where sign-in was started from, once the session is in.
  useEffect(() => {
    if (!ready || !user) return;
    const back = takeReturnPath();
    if (back && back !== window.location.pathname + window.location.search) {
      window.location.replace(back);
    }
  }, [ready, user]);
  const providers = useProviders();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // The API redirects here with ?auth_error=1 when a handshake fails. Strip it
  // once read, so a page refresh does not resurrect a stale complaint.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('auth_error')) {
      setError(true);
      url.searchParams.delete('auth_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Render nothing until the refresh call settles. Flashing "đăng nhập" at
  // someone who is already signed in is worse than a beat of empty space.
  if (!ready) return <span className="w-[76px]" aria-hidden />;

  if (!user) {
    if (error) {
      return (
        <button
          onClick={signIn}
          className="text-[12.5px] text-[var(--color-son)] underline underline-offset-4"
        >
          Đăng nhập thất bại · thử lại
        </button>
      );
    }
    // No credentials configured means the button cannot work; hiding it beats
    // offering something that dead-ends.
    if (providers && !providers.google) return null;

    return (
      <button onClick={signIn} className="btn btn-ghost btn-sm rounded-full">
        Đăng nhập
      </button>
    );
  }

  return (
    <div className="relative" ref={menu}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-1 transition-colors hover:bg-[var(--color-accent-soft)]"
      >
        {user.avatarUrl && !brokenAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            width={26}
            height={26}
            referrerPolicy="no-referrer"
            onError={() => setBrokenAvatar(true)}
            className="h-[26px] w-[26px] rounded-full object-cover"
          />
        ) : (
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[10px] font-semibold tracking-wide text-[var(--color-accent)]">
            {initials(user.displayName)}
          </span>
        )}
        <span className="hidden text-[12.5px] text-[var(--color-muted)] sm:inline">
          {user.displayName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="card absolute right-0 z-50 mt-2 w-56 overflow-hidden shadow-[0_18px_40px_-12px_rgb(0_0_0/0.6)]"
        >
          <div className="border-b border-[var(--color-line)] px-3.5 py-2.5">
            <div className="truncate text-[13px] font-medium">
              {user.displayName}
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate text-[11.5px] text-[var(--color-muted)]">
                @{user.handle}
              </span>
              {/* Admin is worth calling out because it changes what the buttons
                  on the page will do; plain membership is not news. */}
              {user.role === 'ADMIN' ? (
                <span className="label shrink-0 rounded-full bg-[var(--color-accent)] px-1.5 py-px text-[9px] text-[var(--color-on-accent)]">
                  admin
                </span>
              ) : (
                <span className="label shrink-0 text-[9px]">thành viên</span>
              )}
            </div>
          </div>
          <a
            role="menuitem"
            href={`/u/${user.handle}`}
            className="block px-3.5 py-2.5 text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
          >
            Trang của tôi
          </a>
          <a
            role="menuitem"
            href="/cai-dat"
            className="block px-3.5 py-2.5 text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
          >
            Cài đặt
          </a>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="w-full border-t border-[var(--color-line)] px-3.5 py-2.5 text-left text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
          >
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
