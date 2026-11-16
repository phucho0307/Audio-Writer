'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { verifyEmail } from '@/lib/auth';

/**
 * Where the verification email's button lands.
 *
 * The token is read from the address bar and the address bar is then
 * cleaned, so the link does not sit in browser history after use.
 */
export default function VerifyEmailPage() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in development; a token is single-use.
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    window.history.replaceState(null, '', '/xac-minh');
    verifyEmail(token)
      .then((email) => setState({ ok: true, text: email ? `${email} đã được xác minh.` : 'Email đã được xác minh.' }))
      .catch((e: Error) => setState({ ok: false, text: e.message }));
  }, []);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-5 py-16">
      <span className="label label-accent">Xác minh email</span>
      {!state && <p className="text-[15px] text-[var(--color-muted)]">Đang xác minh…</p>}
      {state && (
        <>
          <h1 className="display text-[2rem] leading-tight">{state.ok ? 'Xong rồi.' : 'Không xác minh được.'}</h1>
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">{state.text}</p>
          <Link href="/kham-pha" className="btn btn-primary self-start">
            Đi tới Khám phá
          </Link>
        </>
      )}
    </main>
  );
}
