'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, mainBranch, type Story } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import DraftRoom from './DraftRoom';

/**
 * The writing room for one branch.
 *
 * Its own page rather than a panel on the workspace: this is the one screen
 * where a writer wants nothing else on it, and the editor holds a socket for as
 * long as it is mounted - which should be exactly as long as somebody is
 * writing, not for the whole time a story page is open in a tab.
 */
export default function WritePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const search = useSearchParams();
  const wanted = search.get('branch');

  const { user, ready } = useAuth();
  const [story, setStory] = useState<Story | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStory(id)
      .then(setStory)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const branch =
    story && ((wanted && story.branches.find((b) => b.id === wanted)) || mainBranch(story));

  useEffect(() => {
    if (!branch || !user) return;
    api
      .room(branch.id)
      .then((room) => {
        const seat = room.collaborators.find((c) => c.handle === user.handle);
        setCanEdit(room.owner.handle === user.handle || seat?.role === 'EDITOR');
      })
      .catch(() => setCanEdit(false));
  }, [branch, user]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-sm text-[var(--color-son)]">{error}</p>
        <Link href="/cua-toi" className="mt-4 inline-block text-sm underline">
          Về trang chủ
        </Link>
      </main>
    );
  }

  if (!ready || !story || !branch) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-sm text-[var(--color-muted)]">Đang mở phòng viết…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-sm">Đăng nhập để vào phòng viết chung.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <Link
          href={`/stories/${id}`}
          className="font-mono text-[12px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← {story.title}
        </Link>
        <span className="font-mono text-[12px] text-[var(--color-muted)]">
          nhánh {branch.name}
          {branch.isRoot ? '' : ' (nhánh rẽ)'}
        </span>
      </div>

      <h1 className="mb-1 display text-2xl tracking-tight">Viết chương mới</h1>
      <p className="mb-6 text-[13.5px] text-[var(--color-muted)]">
        Mọi người trong phòng gõ cùng lúc, chữ hiện ngay cho nhau. Xong thì đăng
        thành chương - lúc đó chương mới cố định và có thể nghe được.
      </p>

      <DraftRoom
        branchId={branch.id}
        storyId={id}
        me={{ handle: user.handle, displayName: user.displayName }}
        canEdit={canEdit}
      />
    </main>
  );
}
