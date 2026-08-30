'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Story } from '@/lib/api';

/**
 * The writer's shelf.
 *
 * Creating a story asks for a title and nothing else. The genre picker that
 * used to sit here contradicted the rule the rest of the app follows - genres
 * are an input the AI needs, not a property of a story - and it was the
 * largest block on the page for a field nobody has to fill in.
 */
export default function Home() {
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

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex max-w-[52ch] flex-col gap-3">
        <h1 className="font-serif text-[2.5rem] leading-[1.08] tracking-tight">
          Truyện của tôi
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
          Bắt đầu từ một cái tên. Thể loại, giọng đọc và AI đều để sau — cứ viết
          trước đã.
        </p>
      </header>

      <form
        onSubmit={create}
        className="flex flex-wrap items-center gap-3 border-y border-[var(--color-line)] py-4"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tên truyện mới…"
          aria-label="Tên truyện mới"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--color-muted)]"
        />
        <button
          type="submit"
          disabled={!title.trim() || creating}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-30"
        >
          {creating ? 'Đang tạo…' : 'Tạo truyện'}
        </button>
      </form>

      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!stories && <p className="text-sm text-[var(--color-muted)]">Đang tải…</p>}

      {stories?.length === 0 && (
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            Bạn chưa viết truyện nào. Bắt đầu từ đầu ở trên — hoặc đọc một
            truyện có sẵn rồi rẽ nhánh từ chương bạn muốn đổi hướng.
          </p>
          <Link
            href="/kham-pha"
            className="text-[14px] font-medium text-[var(--color-accent)] hover:underline"
          >
            Xem truyện có thể rẽ nhánh →
          </Link>
        </div>
      )}

      {stories !== null && stories.length > 0 && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
          {stories.map((s) => (
            <Link
              key={s.id}
              href={`/stories/${s.id}`}
              className="group flex flex-col gap-3"
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
                {s.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.coverUrl}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center font-serif text-5xl text-[var(--color-muted)] opacity-20">
                    {s.title.slice(0, 1)}
                  </span>
                )}
                {s.contributionCount === 0 && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-10 font-mono text-[10px] text-white/80">
                    chưa có chương nào
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="font-serif text-[17px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                  {s.title}
                </h2>
                <p className="font-mono text-[10.5px] text-[var(--color-muted)]">
                  {s.contributionCount} chương · {s.wordCount} từ
                  {s.branchCount > 1 && ` · ${s.branchCount} nhánh`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
