'use client';

import { useEffect, useState } from 'react';
import { api, type CraftNote, type Genre, type ReferenceSource } from '@/lib/api';

const GENRES: { id: Genre; label: string; blurb: string }[] = [
  {
    id: 'HORROR',
    label: 'kinh dị',
    blurb: 'Cái quen thuộc sai một chi tiết, và người trong truyện tự giải thích hợp lý.',
  },
  {
    id: 'THRILLER',
    label: 'giật gân',
    blurb: 'Người đọc biết trước nguy hiểm, chỉ không biết khi nào.',
  },
  {
    id: 'ROMANCE',
    label: 'ngôn tình',
    blurb: 'Trở ngại nằm trong tính cách, không phải trong hoàn cảnh.',
  },
  {
    id: 'ACTION',
    label: 'hành động',
    blurb: 'Mỗi cảnh phải lấy đi một thứ, nếu không thì chỉ là tiếng động.',
  },
  {
    id: 'INFIDELITY',
    label: 'ngoại tình',
    blurb: 'Bằng chứng càng nhỏ càng mạnh, vì người đọc tự dựng phần còn lại.',
  },
];

const KIND_LABEL: Record<CraftNote['kind'], string> = {
  TROPE: 'mô-típ',
  BEAT: 'nhịp',
  OPENING: 'mở đầu',
  TWIST: 'cú lật',
  SETTING: 'bối cảnh',
};

const SOURCE_LABEL: Record<ReferenceSource['kind'], string> = {
  AUDIO_SITE: 'web truyện audio',
  CHANNEL: 'kênh giọng đọc',
  APP: 'app bản quyền',
  PUBLIC_DOMAIN: 'hết bản quyền',
};

/**
 * Where to go and listen, and what to take from it.
 *
 * Two halves on purpose. The links are other people's catalogues - we send
 * writers there and copy nothing. The notes are ours, written from reading
 * widely, and they are also what the generator retrieves from: a writer reading
 * this page is reading the same corpus the model does, which is the only honest
 * way to show what it was trained to lean on.
 */
export default function ReferencesPage() {
  const [genre, setGenre] = useState<Genre | null>(null);
  const [sources, setSources] = useState<ReferenceSource[]>([]);
  const [notes, setNotes] = useState<CraftNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .references(genre ?? undefined)
      .then((r) => {
        setSources(r.sources);
        setNotes(r.notes);
      })
      .catch((e: Error) => setError(e.message));
  }, [genre]);

  const current = GENRES.find((g) => g.id === genre);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="display text-[2.1rem] leading-[1.1]">Tham khảo</h1>
      <p className="mt-2 max-w-[56ch] text-[14px] text-[var(--color-muted)]">
        Nghe trước khi viết. Dưới đây là nơi truyện audio tiếng Việt đang sống,
        và những ghi chú về cách từng thể loại vận hành — cũng chính là phần AI
        đọc lại mỗi khi viết tiếp cùng bạn.
      </p>

      {/* genre tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setGenre(null)}
          aria-pressed={genre === null}
          className={`rounded-full border px-3 py-1 font-mono text-[12px] transition-colors ${
            genre === null
              ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          tất cả
        </button>
        {GENRES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGenre(g.id)}
            aria-pressed={genre === g.id}
            className={`rounded-full border px-3 py-1 font-mono text-[12px] transition-colors ${
              genre === g.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {current && (
        <p className="mt-4 border-l-2 border-[var(--color-accent)] pl-3 display text-[16px] text-[var(--color-ink)]">
          {current.blurb}
        </p>
      )}

      {error && (
        <p className="mt-6 font-mono text-[12px] text-[var(--color-accent)]">
          {error}
        </p>
      )}

      {/* ---------------------------------------------------------- sources */}
      <section className="mt-10">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
          Nghe ở đâu
        </h2>

        <ul className="mt-4 flex flex-col">
          {sources.map((s) => (
            <li
              key={s.id}
              className="border-t border-[var(--color-line)] py-3.5 first:border-t-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="display text-[17px] text-[var(--color-ink)] hover:text-[var(--color-accent)] hover:underline"
                >
                  {s.name}
                </a>
                <span className="font-mono text-[12px] uppercase tracking-wider text-[var(--color-muted)]">
                  {SOURCE_LABEL[s.kind]}
                </span>
                {s.scale && (
                  <span className="font-mono text-[12px] text-[var(--color-muted)]">
                    {s.scale}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-[62ch] text-[13.5px] text-[var(--color-muted)]">
                {s.note}
              </p>
            </li>
          ))}
        </ul>

        {sources.length === 0 && !error && (
          <p className="mt-3 font-mono text-[12px] text-[var(--color-muted)]">
            Chưa có nguồn nào cho thể loại này.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ notes */}
      <section className="mt-12">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
          Ghi chú nghề ({notes.length})
        </h2>
        <p className="mt-2 max-w-[58ch] text-[12.5px] text-[var(--color-muted)]">
          Viết bởi chúng tôi, không sao chép từ các trang trên. Đây là phần AI
          tra cứu khi viết tiếp — bạn đọc được đúng thứ nó đọc.
        </p>

        <ul className="mt-4 flex flex-col">
          {notes.map((n) => {
            const isOpen = open === n.id;
            return (
              <li key={n.id} className="border-t border-[var(--color-line)]">
                <button
                  onClick={() => setOpen(isOpen ? null : n.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-baseline gap-3 py-3 text-left"
                >
                  <span className="w-16 flex-none font-mono text-[12px] uppercase tracking-wider text-[var(--color-muted)]">
                    {KIND_LABEL[n.kind]}
                  </span>
                  <span className="min-w-0 flex-1 display text-[16px]">
                    {n.title}
                  </span>
                  <span className="flex-none font-mono text-[12px] text-[var(--color-muted)]">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>

                {isOpen && (
                  <div className="pb-4 pl-[4.75rem]">
                    <p className="max-w-[60ch] text-[14.5px] leading-relaxed">
                      {n.body}
                    </p>
                    {n.source && (
                      <p className="mt-2 font-mono text-[12px] text-[var(--color-muted)]">
                        gợi ý từ{' '}
                        <a
                          href={n.source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline hover:text-[var(--color-accent)]"
                        >
                          {n.source.name}
                        </a>
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-12 border-t border-[var(--color-line)] pt-4 font-mono text-[12px] leading-relaxed text-[var(--color-muted)]">
        Các trang trong danh sách là tài sản của họ. Chúng tôi dẫn link để bạn
        nghe, không lưu lại nội dung của họ và không dùng nội dung đó để huấn
        luyện hay sinh truyện.
      </p>
    </main>
  );
}
