'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type PublicProfile } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

/**
 * A writer's page: who they are, in their own words, and what they have put
 * out for anyone to read. Private stories are never listed here, by anyone,
 * including the owner - this is the page as strangers see it.
 */
export default function Profile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { user } = useAuth();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setP(null);
    setError(null);
    api
      .profile(decodeURIComponent(handle).replace(/^@/, ''))
      .then(setP)
      .catch((e: Error) => setError(e.message));
  }, [handle]);

  if (error) {
    return (
      <main className="mx-auto max-w-[44rem] px-5 py-14 sm:px-8">
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
        <Link href="/kham-pha" className="btn btn-ghost mt-5">
          <span aria-hidden>←</span> Khám phá
        </Link>
      </main>
    );
  }

  if (!p) {
    return (
      <main className="mx-auto flex max-w-[44rem] flex-col gap-4 px-5 py-14 sm:px-8">
        <div className="skeleton h-16 w-16 rounded-full" />
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-16 w-full" />
      </main>
    );
  }

  const isMe = user?.handle === p.handle;
  const since = new Date(p.createdAt).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  return (
    <main className="mx-auto flex max-w-[56rem] flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {p.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.avatarUrl}
            alt=""
            width={88}
            height={88}
            referrerPolicy="no-referrer"
            className="h-[88px] w-[88px] flex-none rounded-full object-cover"
          />
        ) : (
          <span className="grid h-[88px] w-[88px] flex-none place-items-center rounded-full border border-[var(--color-accent-line)] bg-[var(--color-accent-soft)] text-[30px] text-[var(--color-accent)]">
            {(p.displayName.trim()[0] ?? '?').toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="display text-[2rem] leading-tight sm:text-[2.4rem]">{p.displayName}</h1>
          <p className="flex flex-wrap items-center gap-x-2.5 text-[13.5px] text-[var(--color-muted)]">
            <span className="text-[var(--color-accent)]">@{p.handle}</span>
            <span aria-hidden>·</span>
            <span>{p.stories.length} truyện công khai</span>
            <span aria-hidden>·</span>
            <span>tham gia {since}</span>
          </p>
          {p.bio ? (
            <p className="max-w-[60ch] whitespace-pre-line text-[15px] leading-relaxed">{p.bio}</p>
          ) : (
            <p className="text-[14px] italic text-[var(--color-faint)]">
              {isMe ? 'Bạn chưa viết giới thiệu.' : 'Chưa có giới thiệu.'}
            </p>
          )}
        </div>
        {isMe && (
          <Link href="/cai-dat" className="btn btn-ghost btn-sm self-start">
            Sửa hồ sơ
          </Link>
        )}
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="label label-accent border-b border-[var(--color-line)] pb-2.5">Truyện</h2>
        {p.stories.length === 0 ? (
          <p className="text-[14px] text-[var(--color-muted)]">Chưa đăng truyện công khai nào.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {p.stories.map((s) => (
              <Link
                key={s.id}
                href={`/doc/${s.id}`}
                className="card group flex gap-4 p-3.5 transition-colors hover:border-[var(--color-accent-line)]"
              >
                {s.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.coverUrl}
                    alt=""
                    className="h-[104px] w-[74px] flex-none rounded-[4px] object-cover"
                  />
                ) : (
                  <span className="h-[104px] w-[74px] flex-none rounded-[4px] bg-[var(--color-raised)]" />
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-serif text-[16px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                    {s.title}
                  </span>
                  {s.synopsis && (
                    <span className="line-clamp-2 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                      {s.synopsis}
                    </span>
                  )}
                  <span className="mt-auto text-[11.5px] text-[var(--color-faint)]">
                    {s.contributionCount} chương · {s.viewCount.toLocaleString('vi-VN')} lượt đọc
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
