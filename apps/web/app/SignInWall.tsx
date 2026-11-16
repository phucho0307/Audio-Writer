'use client';

import { useAuth } from '@/lib/useAuth';

/** Google's mark, so the button says which account it is about to use. */
export function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.4-9.800000000000001l-7.2 5.5C7.9 40.8 15.4 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 27.8c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1l-7.2-5.6C3 16.8 2.2 20.3 2.2 23.7s.8 6.9 2.2 9.7l7.2-5.6Z"
      />
      <path
        fill="#EA4335"
        d="M24 10.2c4.1 0 6.9 1.8 8.5 3.3l6.1-6C34.9 4 29.9 1.5 24 1.5 15.4 1.5 7.9 6.7 4.4 14l7.2 5.6c1.7-6 6.6-9.4 12.4-9.4Z"
      />
    </svg>
  );
}

/**
 * Asks for a sign-in without throwing away where the reader was going.
 *
 * Reading is public, so anyone hitting one of these arrived on purpose - they
 * clicked "rẽ nhánh" or opened their own shelf. Saying what they were trying
 * to do, rather than a bare "đăng nhập", is the difference between a prompt
 * and a wall.
 */
export function SignInPrompt({
  title,
  reason,
  compact = false,
}: {
  title: string;
  reason: string;
  compact?: boolean;
}) {
  const { signIn } = useAuth();

  return (
    <div
      className={`card reveal flex flex-col items-start gap-3 ${
        compact ? 'p-4' : 'p-7'
      }`}
    >
      <h2 className={compact ? 'text-[14px] font-medium' : 'display text-2xl'}>
        {title}
      </h2>
      <p className="max-w-[48ch] text-[13.5px] leading-relaxed text-[var(--color-muted)]">
        {reason}
      </p>
      <button onClick={() => signIn(reason)} className="btn btn-primary mt-1">
        Đăng nhập hoặc đăng ký
      </button>
    </div>
  );
}

/** Page-level gate. Renders nothing until the session check settles. */
export default function SignInWall({
  title,
  reason,
  children,
}: {
  title: string;
  reason: string;
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();

  // Showing the sign-in prompt for a beat to someone who is already signed in
  // is worse than showing nothing at all.
  if (!ready) return null;
  if (user) return <>{children}</>;

  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <SignInPrompt title={title} reason={reason} />
    </main>
  );
}
