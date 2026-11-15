'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Story } from '@/lib/api';
import SignInWall from './SignInWall';
import Reveal from './Reveal';
import SpiritText from './SpiritText';
import RatingBadge from './Rating';
import { storyRating } from '@/lib/ratings';

/**
 * The writer's shelf.
 *
 * Creating a story asks for a title and nothing else. The genre picker that
 * used to sit here contradicted the rule the rest of the app follows - genres
 * are an input the AI needs, not a property of a story - and it was the
 * largest block on the page for a field nobody has to fill in.
 */
function MyStories() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .myStories()
      .then(setStories)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const story = await api.createStory({ title: title.trim() });
      window.location.href = `/stories/${story.id}`;
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  const words = (stories ?? []).reduce((n, s) => n + s.wordCount, 0);
  const chapters = (stories ?? []).reduce((n, s) => n + s.contributionCount, 0);

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
      <Reveal as="header" className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[48ch] flex-col gap-3">
          <SpiritText
            text="Truyện của tôi"
            className="display text-[2.4rem] leading-[1.05] sm:text-[2.9rem]"
          />
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            Bắt đầu từ một cái tên. Thể loại, giọng đọc và AI đều để sau — cứ
            viết trước đã.
          </p>
        </div>

        {/* Shown only once there is something to count. On an empty shelf a row
            of zeroes is a worse first impression than no row at all. */}
        {stories && stories.length > 0 && (
          <dl className="flex gap-7">
            <Stat n={stories.length} unit="truyện" />
            <Stat n={chapters} unit="chương" />
            <Stat n={words} unit="từ" />
          </dl>
        )}
      </Reveal>

      {/* The composer. One field, and the button only becomes the gold one
          when there is something to press it with. */}
      <form
        onSubmit={create}
        className="reveal flex flex-wrap items-center gap-3 rounded-[5px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 pl-4 transition-colors focus-within:border-[var(--color-accent-line)]"
        style={{ ['--d' as string]: '60ms' }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tên truyện mới…"
          aria-label="Tên truyện mới"
          className="min-w-0 flex-1 bg-transparent display text-[17px] outline-none placeholder:text-[var(--color-faint)]"
        />
        <button
          type="submit"
          disabled={!title.trim() || creating}
          className={`btn ${title.trim() ? 'btn-primary' : 'btn-ghost'}`}
        >
          {creating ? 'Đang tạo…' : 'Tạo truyện'}
        </button>
      </form>

      {error && (
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
      )}

      {!stories && <ShelfSkeleton />}

      {stories?.length === 0 && (
        <div
          className="reveal flex flex-col items-start gap-4 rounded-[5px] border border-dashed border-[var(--color-line-strong)] px-6 py-12"
          style={{ ['--d' as string]: '120ms' }}
        >
          <span className="label">Kệ sách trống</span>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            Bạn chưa viết truyện nào. Bắt đầu từ đầu ở trên — hoặc đọc một
            truyện có sẵn rồi rẽ nhánh từ chương bạn muốn đổi hướng.
          </p>
          <Link href="/kham-pha" className="btn btn-ghost">
            Xem truyện có thể rẽ nhánh
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}

      {stories !== null && stories.length > 0 && (
        <Reveal
          childrenStagger
          stagger={0.05}
          deps={[stories.length]}
          className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4"
        >
          {stories.map((s) => (
            <Link
              key={s.id}
              href={`/stories/${s.id}`}
              className="group flex flex-col gap-3"
            >
              <div className="cover aspect-[3/4]">
                {s.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.coverUrl} alt="" />
                ) : (
                  <span className="display flex h-full w-full items-center justify-center text-6xl text-[var(--color-line-strong)]">
                    {s.title.slice(0, 1)}
                  </span>
                )}

                {s.visibility !== 'PUBLIC' && (
                  <span className="label absolute right-2 top-2 rounded-[3px] bg-black/55 px-1.5 py-1 text-[9px] text-white/85 backdrop-blur-sm">
                    riêng tư
                  </span>
                )}

                {s.contributionCount === 0 && (
                  <span className="scrim label text-white/80">
                    chưa có chương nào
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">
                  {s.title}
                </h2>
                {s.contributionCount > 0 && (
                  <RatingBadge rating={storyRating(s.id)} className="text-[12px]" />
                )}
                <p className="text-[11.5px] text-[var(--color-faint)]">
                  {s.contributionCount} chương · {s.wordCount.toLocaleString('vi-VN')} từ
                  {s.branchCount > 1 && ` · ⑂ ${s.branchCount - 1} nhánh rẽ`}
                </p>
              </div>
            </Link>
          ))}
        </Reveal>
      )}
    </main>
  );
}

function Stat({ n, unit }: { n: number; unit: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label order-2">{unit}</dt>
      <dd className="display order-1 text-[26px] leading-none tabular-nums">
        {n.toLocaleString('vi-VN')}
      </dd>
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="skeleton aspect-[3/4]" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * The shelf is personal, so there is nothing to show a signed-out visitor -
 * not an empty state, which would read as "you have no stories" rather than
 * "these are not your stories".
 */
export default function Home() {
  return (
    <SignInWall
      title="Truyện của tôi"
      reason="Đăng nhập để xem truyện bạn đang viết và bắt đầu truyện mới. Truyện mới luôn ở chế độ riêng tư cho đến khi bạn bấm đăng."
    >
      <MyStories />
    </SignInWall>
  );
}
