'use client';

import { useAuth } from '@/lib/useAuth';

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
      className={`flex flex-col items-start gap-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] ${
        compact ? 'p-4' : 'p-6'
      }`}
    >
      <h2 className={compact ? 'text-[14px] font-medium' : 'font-serif text-xl'}>
        {title}
      </h2>
      <p className="text-[13px] text-[var(--color-muted)]">{reason}</p>
      <button
        onClick={signIn}
        className="mt-1 rounded-md bg-[var(--color-accent)] px-4 py-2 font-mono text-[12px] text-white"
      >
        đăng nhập với Google
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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <SignInPrompt title={title} reason={reason} />
    </main>
  );
}
