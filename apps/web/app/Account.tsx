'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useProviders } from '@/lib/useAuth';

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
          className="font-mono text-[12px] text-[var(--color-accent)] underline underline-offset-4"
        >
          đăng nhập thất bại · thử lại
        </button>
      );
    }
    // No credentials configured means the button cannot work; hiding it beats
    // offering something that dead-ends.
    if (providers && !providers.google) return null;

    return (
      <button
        onClick={signIn}
        className="rounded-full border border-[var(--color-line)] px-3.5 py-1.5 font-mono text-[12px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      >
        đăng nhập
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
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-mono text-[10px] text-[var(--color-accent)]">
            {initials(user.displayName)}
          </span>
        )}
        <span className="hidden font-mono text-[12px] text-[var(--color-muted)] sm:inline">
          {user.displayName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg"
        >
          <div className="border-b border-[var(--color-line)] px-3.5 py-2.5">
            <div className="truncate text-[13px] font-medium">
              {user.displayName}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--color-muted)]">
              @{user.handle}
            </div>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="w-full px-3.5 py-2.5 text-left font-mono text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
          >
            đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
