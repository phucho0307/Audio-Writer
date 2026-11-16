'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type Discovery } from '@/lib/api';
import { thumbUrl } from '@/lib/thumb';

const EXAMPLES = [
  'Truyện buồn, chồng ngoại tình có con với bé ba',
  'Truyện ma làng quê, đọc xong sợ không dám ngủ',
  'Ngôn tình nhẹ nhàng, kết có hậu',
  'Trọng sinh báo thù, nữ chính mạnh mẽ',
];

const ENDING: Record<string, string> = { HE: 'Kết có hậu', SE: 'Kết buồn', OE: 'Kết mở' };

/**
 * "Tell us what you feel like hearing" - AI search at the top of Khám phá.
 *
 * A follow-up refines the last request rather than starting over ("kết có
 * hậu hơn"), which is how people actually talk about what they want.
 */
export default function AiFinder() {
  const [text, setText] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const [found, setFound] = useState<Discovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string, refine: boolean) {
    const query = q.trim();
    if (query.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.discover(query, refine && last ? last : undefined);
      setFound(res);
      setLast(refine && last ? `${last}. ${query}` : query);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <span className="label label-accent">Tìm bằng AI</span>
        <p className="text-[14px] text-[var(--color-muted)]">
          {last
            ? <>Đang tìm: <span className="text-[var(--color-ink)]">“{last}”</span>. Nói thêm để lọc, hoặc tìm lại từ đầu.</>
            : 'Tả truyện bạn muốn nghe hôm nay, bằng lời của bạn.'}
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text, Boolean(last));
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder={last ? 'Ví dụ: kết có hậu hơn, ngắn thôi…' : 'Ví dụ: truyện buồn, chồng ngoại tình có con với bé ba…'}
          aria-label="Tả truyện bạn muốn nghe"
          className="field flex-1"
        />
        <div className="flex gap-2">
          <button type="submit" disabled={busy || text.trim().length < 3} className="btn btn-primary">
            {busy ? 'Đang tìm…' : last ? 'Lọc thêm' : 'Tìm'}
          </button>
          {last && (
            <button
              type="button"
              onClick={() => { setLast(null); setFound(null); setText(''); }}
              className="btn btn-quiet"
            >
              Tìm lại
            </button>
          )}
        </div>
      </form>

      {!found && !busy && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => void ask(ex, false)} className="chip text-[12.5px]">
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-[13px] text-[var(--color-son)]">{error}</p>}

      {found && (
        <div className="flex flex-col gap-3">
          {found.results.length === 0 ? (
            <p className="text-[14px] text-[var(--color-muted)]">
              Chưa thấy truyện nào hợp. Thử tả khác đi, hoặc bớt điều kiện.
            </p>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-2">
              {found.results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/doc/${r.id}`}
                    className="group flex gap-3 rounded-md border border-[var(--color-line)] p-3 transition-colors hover:border-[var(--color-accent-line)]"
                  >
                    <span className="cover h-[92px] w-[66px] flex-none">
                      {r.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(r.coverUrl)} alt="" loading="lazy" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-serif text-[15.5px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                        {r.title}
                      </span>
                      {r.authorName && (
                        <span className="text-[11.5px] text-[var(--color-faint)]">{r.authorName}</span>
                      )}
                      <span className="text-[13px] leading-relaxed text-[var(--color-muted)]">{r.why}</span>
                      <span className="mt-auto flex flex-wrap gap-x-2 text-[11px] text-[var(--color-faint)]">
                        {ENDING[r.ending] && <span>{ENDING[r.ending]}</span>}
                        {r.moods.slice(0, 2).map((m) => <span key={m}>· {m}</span>)}
                        <span>· {r.contributionCount} chương</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {found.coverage.withCard < found.coverage.total && (
            <p className="text-[11.5px] text-[var(--color-faint)]">
              AI đang đọc dần thư viện: đã tìm được trong {found.coverage.withCard.toLocaleString('vi-VN')}/
              {found.coverage.total.toLocaleString('vi-VN')} truyện. Truyện còn lại sẽ có trong vài ngày tới.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
