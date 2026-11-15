'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import SignInWall from '../../SignInWall';

/**
 * Where a share link lands.
 *
 * Opening it joins the room at the link's level and goes straight in. A
 * signed-out visitor is asked to sign in first and then continues here, so
 * the link still works for someone who had no account when it was sent.
 */
function Joining({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .joinShare(token)
      .then((r) => {
        window.location.href = `/stories/${r.storyId}/viet?branch=${r.branchId}`;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  return (
    <main className="mx-auto max-w-xl px-5 py-20 sm:px-8">
      <div className="card flex flex-col items-start gap-3 p-7">
        <span className="label label-accent">Phòng viết chung</span>
        {error ? (
          <>
            <h1 className="display text-2xl">Không mở được phòng</h1>
            <p className="text-[14px] text-[var(--color-muted)]">{error}</p>
            <Link href="/kham-pha" className="btn btn-ghost">
              Về Khám phá
            </Link>
          </>
        ) : (
          <>
            <h1 className="display text-2xl">Đang mở phòng viết…</h1>
            <p className="text-[14px] text-[var(--color-muted)]">Bạn sẽ được chuyển vào ngay.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function JoinByLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { ready } = useAuth();
  if (!ready) return null;
  return (
    <SignInWall
      title="Bạn được mời vào một phòng viết chung"
      reason="Đăng nhập để vào phòng. Bạn sẽ được đưa thẳng tới trang viết sau khi đăng nhập."
    >
      <Joining token={token} />
    </SignInWall>
  );
}
