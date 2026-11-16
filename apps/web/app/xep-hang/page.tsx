'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Board, type BoardEntry } from '@/lib/api';
import { thumbUrl } from '@/lib/thumb';
import RatingBadge from '../Rating';

type Kind = Board['kind'];

const KINDS: { id: Kind; label: string; blurb: string }[] = [
  {
    id: 'best',
    label: 'Hay nhất',
    blurb: 'Xếp theo sao người đọc chấm. Truyện ít lượt chấm được kéo về mức trung bình, nên một lượt 5 sao không đủ để lên đầu.',
  },
  {
    id: 'hot',
    label: 'Đang hot',
    blurb: 'Xếp theo lượt đọc 7 ngày qua, hôm nay tính nhiều hơn tuần trước.',
  },
];

const vi = (n: number) => n.toLocaleString('vi-VN');

/**
 * Story rankings, overall or within one genre.
 *
 * "Hay nhất" lists only stories readers have actually rated - an unrated
 * story ranked by something else under that heading would be a claim nobody
 * made. When nothing is rated yet the page says so and points at "Đang hot".
 */
export default function RankingsPage() {
  const [kind, setKind] = useState<Kind>('best');
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<{ genre: string; count: number }[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.rankingGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  useEffect(() => {
    let live = true;
    setBoard(null);
    setError(null);
    api
      .rankings(kind, genre)
      .then((b) => live && setBoard(b))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind, genre]);

  const current = KINDS.find((k) => k.id === kind)!;

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-4 pb-24 pt-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <span className="label label-accent">Bảng xếp hạng</span>
        <h1 className="font-serif text-[30px] leading-tight sm:text-[38px]" style={{ textWrap: 'balance' }}>
          {current.label}
          {genre ? <span className="text-[var(--color-muted)]"> · {genre}</span> : null}
        </h1>
        <p className="max-w-[62ch] text-[14px] text-[var(--color-muted)]">{current.blurb}</p>
      </header>

      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Kiểu xếp hạng" className="flex gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              role="tab"
              type="button"
              aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`btn ${kind === k.id ? 'btn-primary' : 'btn-quiet'}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {genres.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Thể loại">
            <button
              type="button"
              aria-pressed={genre === null}
              onClick={() => setGenre(null)}
              className={`chip ${genre === null ? 'chip-on' : ''}`}
            >
              Tất cả
            </button>
            {genres.map((g) => (
              <button
                key={g.genre}
                type="button"
                aria-pressed={genre === g.genre}
                onClick={() => setGenre(genre === g.genre ? null : g.genre)}
                className={`chip ${genre === g.genre ? 'chip-on' : ''}`}
              >
                {g.genre} <span className="text-[var(--color-faint)]">{vi(g.count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-[13px] text-[var(--color-son)]">{error}</p>}

      {!board && !error && (
        <ol className="flex flex-col gap-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-[104px] animate-pulse rounded-md bg-[var(--color-surface)]" />
          ))}
        </ol>
      )}

      {board && board.entries.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-[var(--color-line)] p-5">
          <p className="text-[14.5px]">
            {kind === 'best'
              ? `Chưa có truyện ${genre ? `${genre} ` : ''}nào được chấm sao.`
              : `Chưa có truyện ${genre ? `${genre} ` : ''}nào.`}
          </p>
          {kind === 'best' && (
            <p className="text-[13px] text-[var(--color-muted)]">
              Đọc một chương rồi chấm sao ở trang truyện, bảng này sẽ có tên truyện đó.
            </p>
          )}
          {kind === 'best' && (
            <button type="button" className="btn btn-quiet" onClick={() => setKind('hot')}>
              Xem truyện đang hot
            </button>
          )}
        </div>
      )}

      {board && board.fallback && board.entries.length > 0 && (
        <p className="text-[12.5px] text-[var(--color-faint)]">
          Tuần này chưa có lượt đọc nào được ghi lại, nên đang xếp theo tổng lượt đọc từ trước tới nay.
        </p>
      )}

      {board && board.entries.length > 0 && (
        <ol className="flex flex-col gap-3">
          {board.entries.map((e) => (
            <Row key={e.id} entry={e} kind={board.kind} fallback={board.fallback} />
          ))}
        </ol>
      )}
    </main>
  );
}

function Row({ entry: e, kind, fallback }: { entry: BoardEntry; kind: Kind; fallback: boolean }) {
  const podium = e.rank <= 3;
  return (
    <li className="card-in">
      <Link
        href={`/doc/${e.id}`}
        className="group grid grid-cols-[2.25rem_64px_1fr] items-start gap-3 rounded-md border border-[var(--color-line)] p-3 transition-colors hover:border-[var(--color-accent-line)] sm:grid-cols-[3rem_72px_1fr] sm:gap-4"
      >
        <span
          className={`pt-1 text-center font-serif tabular-nums leading-none ${
            podium ? 'text-[28px] text-[var(--color-accent)] sm:text-[34px]' : 'text-[22px] text-[var(--color-faint)]'
          }`}
          aria-label={`Hạng ${e.rank}`}
        >
          {e.rank}
        </span>
        <span className="cover h-[90px] w-[64px] sm:h-[100px] sm:w-[72px]">
          {e.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl(e.coverUrl)} alt="" loading="lazy" />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-serif text-[16.5px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
            {e.title}
          </span>
          {e.authorName && <span className="text-[11.5px] text-[var(--color-faint)]">{e.authorName}</span>}
          {e.synopsis && (
            <span className="line-clamp-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{e.synopsis}</span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
            {kind === 'best' &&
              (e.average !== null ? (
                <RatingBadge rating={{ score: e.average, count: e.ratingCount }} />
              ) : (
                <span>{vi(e.ratingCount)} lượt chấm, chưa đủ để hiện điểm</span>
              ))}
            {kind === 'hot' && (
              <span className="tabular-nums">
                {fallback || e.recentReads === null
                  ? `${vi(e.viewCount)} lượt đọc`
                  : `${vi(e.recentReads)} lượt đọc tuần này`}
              </span>
            )}
            <span>{vi(e.contributionCount)} chương</span>
            {e.genres.length > 0 && <span>{e.genres.slice(0, 3).join(' · ')}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}
