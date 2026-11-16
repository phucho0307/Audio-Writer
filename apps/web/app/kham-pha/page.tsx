'use client';

import { thumbUrl } from '@/lib/thumb';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type Story } from '@/lib/api';
import Reveal from '../Reveal';
import CoverThumb from '../CoverThumb';
import AiFinder from './AiFinder';
import SpiritText from '../SpiritText';
import Tilt, { Sheen } from '../Tilt';
import RatingBadge from '../Rating';
import { storyRating } from '@/lib/ratings';
import { storyAuthorHandle } from '@/lib/chapter-author';
import { calm, gsap, useGSAP } from '@/lib/motion';
import AuthorByline from '@/app/AuthorByline';
import { nativeStory } from '@/lib/native-catalog';
import FamousWorkCard from './FamousWorkCard';
import ChineseWorkCard from './ChineseWorkCard';
import { CHINESE_SHELF_NAME, CHINESE_WORKS, matchesChineseSearch, type ChineseWork } from '@/lib/chinese-catalog';
import { FAMOUS_AUTHORS, FAMOUS_WORKS, foldSearch, matchesCatalogSearch, type FamousWork } from '@/lib/famous-catalog';
import { BRAND } from '@/lib/brand';

type Shelf = 'all' | 'library' | 'famous' | 'chinese';
type SortBy = 'popular' | 'latest' | 'liked';
type SearchMode = 'plain' | 'ai';

const SORTS: { id: SortBy; label: string }[] = [
  { id: 'popular', label: 'Phổ biến nhất' },
  { id: 'latest', label: 'Mới nhất' },
  { id: 'liked', label: 'Được thích nhất' },
];

/** The numbers a sort reads. Catalogue works sort by the story they are read as. */
function sortKey(story: Story | undefined, by: SortBy): number {
  if (!story) return -1;
  if (by === 'popular') return story.viewCount;
  if (by === 'latest') return Date.parse(story.createdAt ?? story.updatedAt) || 0;
  // The score the card shows, so the order matches the stars on screen;
  // the count breaks ties, so 4.8 from 300 readers leads 4.8 from 6.
  const r = storyRating(story);
  return r ? r.score * 1e6 + r.count : 0;
}

/**
 * Written here - by the AI or by people on the site - rather than imported.
 * Imported texts (the Chinese shelf, famous authors) carry a `textSource`
 * and have their own shelves, so "Truyện trên Nhịp Bút" leaves them out.
 */
function isOwnStory(story: Story): boolean {
  return !story.textSource && !nativeStory(story.id);
}
type ShelfEntry = { kind: 'story'; story: Story } | { kind: 'famous'; work: FamousWork } | { kind: 'chinese'; work: ChineseWork };

/**
 * The library.
 *
 * Reading is the only call to action here. Forking is offered at the end of a
 * chapter instead - by then the reader has an opinion about where the story
 * should have gone, which is the moment the offer means something. On a
 * thumbnail it was only a second button competing with the first.
 */
export default function Explore() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [shelf, setShelf] = useState<Shelf>('all');
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [chineseSource, setChineseSource] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>('popular');
  const [mode, setMode] = useState<SearchMode>('plain');

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const requested = search.get('tacgia');
    if (search.get('ke') === 'truyen-trung') {
      setShelf('chinese');
      const source = search.get('nguon');
      if (source === 'monkeyd' || source === 'metruyen') setChineseSource(source);
    } else if (requested && FAMOUS_AUTHORS.some((author) => author.id === requested)) {
      setShelf('famous');
      setAuthorId(requested);
    }
    api
      .listStories()
      .then((all) => setStories(all.filter((s) => s.contributionCount > 0)))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => setPage(1), [shelf, authorId, chineseSource, genre, query, sortBy]);

  function chooseShelf(next: Shelf) {
    setShelf(next);
    setAuthorId(null);
    setChineseSource(null);
    setGenre(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('tacgia');
    url.searchParams.delete('nguon');
    if (next === 'chinese') url.searchParams.set('ke', 'truyen-trung');
    else url.searchParams.delete('ke');
    window.history.replaceState(null, '', url);
  }

  function chooseAuthor(id: string | null) {
    setAuthorId(id);
    setShelf('famous');
    setChineseSource(null);
    setGenre(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('ke');
    url.searchParams.delete('nguon');
    if (id) url.searchParams.set('tacgia', id);
    else url.searchParams.delete('tacgia');
    window.history.replaceState(null, '', url);
  }

  function chooseChineseSource(source: string | null) {
    setChineseSource(source);
    setGenre(null);
    const url = new URL(window.location.href);
    if (source) url.searchParams.set('nguon', source);
    else url.searchParams.delete('nguon');
    window.history.replaceState(null, '', url);
  }

  const publicStories = new Map((stories ?? []).map((story) => [story.id, story]));
  const publicIds = new Set(publicStories.keys());
  const availableFamous = FAMOUS_WORKS.filter((work) => !work.nativeStoryId || publicIds.has(work.nativeStoryId))
    .map((work) => work.nativeStoryId ? { ...work, coverUrl: publicStories.get(work.nativeStoryId)!.coverUrl } : work);
  const availableAuthors = FAMOUS_AUTHORS.filter((author) => availableFamous.some((work) => work.authorId === author.id));
  const availableChinese = CHINESE_WORKS.filter((work) => publicIds.has(work.nativeStoryId))
    .map((work) => ({ ...work, coverUrl: publicStories.get(work.nativeStoryId)!.coverUrl }));
  const searchWords = foldSearch(query).split(/\s+/).filter(Boolean);
  const matchingStories = shelf === 'famous' || shelf === 'chinese' ? [] : (stories ?? []).filter((story) => {
    if (shelf === 'all' && nativeStory(story.id)) return false;
    if (shelf === 'library' && !isOwnStory(story)) return false;
    const text = foldSearch(`${story.title} ${story.synopsis ?? ''} ${story.textSource?.authorName ?? storyAuthorHandle(story) ?? ''} ${story.genres.join(' ')} ${(nativeStory(story.id)?.containedTitles ?? []).join(' ')}`);
    return searchWords.every((word) => text.includes(word));
  });
  const matchingFamous = shelf === 'library' || shelf === 'chinese' ? [] : availableFamous.filter((work) =>
    (!authorId || work.authorId === authorId) && matchesCatalogSearch(work, query),
  );
  const matchingChinese = shelf === 'library' || shelf === 'famous' ? [] : availableChinese.filter((work) =>
    (!chineseSource || work.sourceId === chineseSource) && matchesChineseSearch(work, query),
  );

  // Derived from the content, so the filter never offers an empty genre or
  // omits one a writer has just used. Multi-genre stories count under each.
  // Tags are free text, so "Gia đình" and "gia đình" are one genre: grouped
  // without case, shown under whichever spelling more stories use.
  const counts = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();
  for (const s of [...matchingStories, ...matchingFamous, ...matchingChinese]) {
    for (const g of new Set(s.genres.map((x) => x.toLocaleLowerCase('vi')))) {
      if (shelf === 'chinese' && g === 'truyện trung') continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    for (const g of s.genres) {
      const key = g.toLocaleLowerCase('vi');
      const m = spellings.get(key) ?? new Map<string, number>();
      m.set(g, (m.get(g) ?? 0) + 1);
      spellings.set(key, m);
    }
  }
  const labelOf = (key: string) =>
    [...(spellings.get(key) ?? new Map([[key, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const genres = [...counts.entries()]
    .map(([key, n]) => [key, n, labelOf(key)] as const)
    .sort((a, b) => b[1] - a[1] || a[2].localeCompare(b[2], 'vi'));
  const hasGenre = (list: string[]) =>
    genre === null || list.some((g) => g.toLocaleLowerCase('vi') === genre);

  const shown = matchingStories.filter((s) => hasGenre(s.genres));
  const shownFamous = matchingFamous.filter((work) => hasGenre(work.genres));
  const shownChinese = matchingChinese.filter((work) => hasGenre(work.genres));
  const selectedAuthor = FAMOUS_AUTHORS.find((author) => author.id === authorId);

  // The most-read story leads the page, and only while nothing is filtered -
  // under a genre the grid is the answer to the question that was asked, and
  // a hero would just be one of its own results, repeated at four times the
  // size.
  const featured =
    shelf === 'all' && sortBy === 'popular' && !authorId && !query.trim() && genre === null && stories && stories.length > 2
      ? [...stories].filter((story) => !nativeStory(story.id)).sort((a, b) => b.viewCount - a.viewCount)[0]
      : null;
  const grid = featured ? shown.filter((s) => s.id !== featured.id) : shown;
  const entries: ShelfEntry[] = [
    ...grid.map((story) => ({ kind: 'story' as const, story })),
    ...shownFamous.map((work) => ({ kind: 'famous' as const, work })),
    ...shownChinese.map((work) => ({ kind: 'chinese' as const, work })),
  ];
  const storyOf = (e: ShelfEntry) =>
    e.kind === 'story' ? e.story : e.work.nativeStoryId ? publicStories.get(e.work.nativeStoryId) : undefined;
  // Stable sort, so equal keys keep their shelf order.
  entries.sort((x, y) => sortKey(storyOf(y), sortBy) - sortKey(storyOf(x), sortBy));
  const visible = entries.slice(0, page * 24);
  const totalShown = shown.length + shownFamous.length + shownChinese.length;

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-12 px-5 py-10 sm:px-8 sm:py-14">
      {error && (
        <p className="panel text-sm text-[var(--color-son)]">{error}</p>
      )}

      {featured && <Featured story={featured} />}

      {!featured && (
        <Reveal as="header" className="flex max-w-[48ch] flex-col gap-3">
          <SpiritText
            text={shelf === 'chinese' ? CHINESE_SHELF_NAME : shelf === 'famous' ? 'Truyện của những tác giả bạn yêu thích.' : 'Tìm câu chuyện tiếp theo của bạn.'}
            className="display text-[2.4rem] leading-[1.05] sm:text-[2.9rem]"
          />
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            {shelf === 'chinese' ? 'Trà xanh, hào môn, báo thù và những lần làm lại cuộc đời. Đọc và nghe trọn bộ ngay tại đây.' : <>Khám phá truyện trên {BRAND}, cùng tác phẩm và bản kể từ những tác giả bạn yêu thích.</>}
          </p>
        </Reveal>
      )}

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="label">
            {mode === 'ai' ? 'Tìm truyện' : selectedAuthor ? selectedAuthor.name : genre ? `Thể loại · ${labelOf(genre)}` : shelf === 'chinese' ? 'Truyện Trung' : shelf === 'famous' ? 'Tác giả nổi tiếng' : shelf === 'library' ? `Truyện trên ${BRAND}` : 'Tất cả truyện'}
          </h2>
          {mode === 'plain' && (stories || shelf === 'famous') && (
            <span className="text-[12.5px] text-[var(--color-faint)]">
              {totalShown} truyện / tác phẩm
            </span>
          )}
        </div>

        <div role="tablist" aria-label="Cách tìm truyện" className="flex gap-1 self-start rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
          {([{ id: 'plain', label: 'Tìm theo tên & bộ lọc' }, { id: 'ai', label: 'Tìm bằng AI' }] as const).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                mode === m.id
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'ai' ? <AiFinder /> : (<>
        <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc thư viện">
            {([{ id: 'all', label: 'Tất cả', count: (stories?.filter((story) => !nativeStory(story.id)).length ?? 0) + availableFamous.length + availableChinese.length },
              { id: 'library', label: `Truyện trên ${BRAND}`, count: stories?.filter(isOwnStory).length ?? 0 },
              { id: 'chinese', label: 'Truyện Trung', count: availableChinese.length },
              { id: 'famous', label: 'Tác giả nổi tiếng', count: availableFamous.length }] as const).map((option) => (
              <button key={option.id} type="button" onClick={() => chooseShelf(option.id)} aria-pressed={shelf === option.id} className={`chip ${shelf === option.id ? 'chip-on' : ''}`}>
                {option.label}<span className="text-[10.5px] opacity-60">{option.count}</span>
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-2">
            <span className="sr-only">Tìm truyện hoặc tác giả</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên truyện, tác giả…" className="field" />
          </label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sắp xếp">
            <span className="label text-[10px]">Sắp xếp</span>
            {SORTS.map((o) => (
              <button key={o.id} type="button" onClick={() => setSortBy(o.id)} aria-pressed={sortBy === o.id} className={`chip ${sortBy === o.id ? 'chip-on' : ''}`}>
                {o.label}
              </button>
            ))}
          </div>
          {shelf === 'chinese' && <div className="flex flex-col gap-2.5">
            <span className="label text-[10px]">Nguồn tuyển truyện</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc nguồn truyện Trung">
              <button type="button" onClick={() => chooseChineseSource(null)} aria-pressed={chineseSource === null} className={`chip ${chineseSource === null ? 'chip-on' : ''}`}>Tất cả nguồn</button>
              {([{ id: 'monkeyd', name: 'MonkeyD' }, { id: 'metruyen', name: 'Mê Truyện' }] as const).map((source) => <button key={source.id} type="button" onClick={() => chooseChineseSource(source.id)} aria-pressed={chineseSource === source.id} className={`chip ${chineseSource === source.id ? 'chip-on' : ''}`}>
                {source.name}<span className="text-[10.5px] opacity-60">{availableChinese.filter((work) => work.sourceId === source.id).length}</span>
              </button>)}
            </div>
          </div>}
          {shelf !== 'library' && shelf !== 'chinese' && <div className="flex flex-col gap-2.5">
            <span className="label text-[10px]">Tác giả</span>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Lọc tác giả nổi tiếng">
              <button type="button" onClick={() => chooseAuthor(null)} aria-pressed={shelf === 'famous' && authorId === null} className={`chip shrink-0 ${shelf === 'famous' && authorId === null ? 'chip-on' : ''}`}>Tất cả tác giả</button>
              {availableAuthors.map((author) => <button key={author.id} type="button" onClick={() => chooseAuthor(author.id)} aria-pressed={authorId === author.id} className={`chip shrink-0 ${authorId === author.id ? 'chip-on' : ''}`}>
                {author.name}<span className="text-[10.5px] opacity-60">{availableFamous.filter((work) => work.authorId === author.id).length}</span>
              </button>)}
            </div>
          </div>}
        </div>

        {selectedAuthor && <p className="max-w-[70ch] border-l-2 border-[var(--color-accent)] pl-4 text-[14px] leading-relaxed text-[var(--color-muted)]">{selectedAuthor.note}</p>}

        {/* Scrollable on a phone rather than wrapped to four lines, which
            pushed the covers below the fold before anyone had chosen
            anything. */}
        {genres.length > 0 && (
          <div
            aria-label={`Thể loại, ${genres.length} mục`}
            className="genre-rail -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              onClick={() => setGenre(null)}
              aria-pressed={genre === null}
              className={`chip ${genre === null ? 'chip-on' : ''}`}
            >
              Tất cả
            </button>
            {/* The chosen genre moves up front, so it stays visible while the
                rail is folded to one row. */}
            {[...genres].sort((a, b) => Number(b[0] === genre) - Number(a[0] === genre)).map(([g, n, label]) => (
              <button
                key={g}
                onClick={() => setGenre(genre === g ? null : g)}
                aria-pressed={genre === g}
                className={`chip ${genre === g ? 'chip-on' : ''}`}
              >
                {label}
                <span className="text-[10.5px] opacity-55">{n}</span>
              </button>
            ))}
          </div>
        )}

        {!stories && shelf !== 'famous' && <CoverSkeletons />}

        <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((entry, i) => (
            <div
              key={entry.kind === 'story' ? entry.story.id : entry.work.id}
              className="card-in flex flex-col [&>*]:flex-1"
              // Staggered within each page of 24, capped so a long page
              // does not keep the last cards waiting.
              style={{ animationDelay: `${Math.min(i % 24, 11) * 45}ms` }}
            >
              {entry.kind === 'story' ? <StoryCard story={entry.story} />
                : entry.kind === 'chinese' ? <ChineseWorkCard work={entry.work} />
                : <FamousWorkCard work={entry.work} />}
            </div>
          ))}
        </div>

        {visible.length < entries.length && <button type="button" onClick={() => setPage((current) => current + 1)} className="btn btn-ghost self-center">Xem thêm {Math.min(24, entries.length - visible.length)} tác phẩm <span aria-hidden>↓</span></button>}

        {(stories || shelf === 'famous') && totalShown === 0 && (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">
            Chưa có kết quả phù hợp. Thử tên truyện, tác giả hoặc thể loại khác.
          </p>
        )}
        {(query || genre || authorId) && <button type="button" onClick={() => { setQuery(''); setGenre(null); chooseShelf('all'); }} className="btn btn-quiet self-start">Xóa bộ lọc ×</button>}
        </>)}
      </section>
    </main>
  );
}

/**
 * The lead story.
 *
 * Its own cover is the background, blurred past the point of being an image
 * and used as a wash of the story's own colour - which means the page is
 * tinted by whatever is being featured rather than by a fixed brand gradient,
 * and a new cover redecorates it for free.
 */
function Featured({ story }: { story: Story }) {
  const backdrop = useRef<HTMLDivElement>(null);

  /**
   * The wash drifts against the scroll.
   *
   * `scrub` rather than `toggleActions`, because this is a position tied to
   * the scrollbar rather than something that plays - and `ease: 'none'`, since
   * any other easing makes the backdrop lag the page in a way that reads as
   * jank rather than as depth. Only the blurred copy moves; nothing anyone is
   * reading does.
   */
  useGSAP(
    () => {
      const el = backdrop.current;
      if (!el?.parentElement || calm()) return;
      gsap.to(el, {
        yPercent: 10,
        ease: 'none',
        scrollTrigger: {
          trigger: el.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      });
    },
    { scope: backdrop, dependencies: [story.id], revertOnUpdate: true },
  );

  return (
    <Reveal
      as="section"
      blur={false}
      className="relative overflow-hidden rounded-[8px] border border-[var(--color-line)]"
    >
      {story.coverUrl && (
        <div
          ref={backdrop}
          aria-hidden
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-35 blur-3xl"
          style={{ backgroundImage: `url(${thumbUrl(story.coverUrl)})` }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[var(--color-ground)] via-[color-mix(in_oklab,var(--color-ground)_78%,transparent)] to-[color-mix(in_oklab,var(--color-ground)_55%,transparent)]"
      />

      <div className="relative flex flex-col gap-7 p-6 sm:flex-row sm:items-center sm:gap-9 sm:p-9">
        <Tilt className="w-[150px] flex-none sm:w-[196px]">
          <Link href={`/doc/${story.id}`} className="group block">
            <div className="cover aspect-[3/4]">
              {story.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl(story.coverUrl)} alt="" />
              )}
              <Sheen />
            </div>
          </Link>
        </Tilt>

        <div className="flex min-w-0 flex-col items-start gap-4">
          <span className="label label-accent flex items-center gap-2">
            <span className="dot dot-on" aria-hidden />
            Được nghe nhiều nhất
          </span>

          <Link href={`/doc/${story.id}`}>
            <SpiritText
              key={story.id}
              text={story.title}
              delay={0.15}
              className="display text-[2.1rem] leading-[1.04] sm:text-[2.75rem]"
            />
          </Link>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RatingBadge rating={storyRating(story)} variant="full" />
            {storyAuthorHandle(story) && (
              <span className="text-[13px] text-[var(--color-muted)]">
                · <AuthorByline storyId={story.id} handle={storyAuthorHandle(story)} />
              </span>
            )}
          </div>

          {story.synopsis && (
            <p className="max-w-[54ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
              {story.synopsis}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-[var(--color-faint)]">
            <span>{story.contributionCount} chương</span>
            <Dot />
            <span>{story.wordCount.toLocaleString('vi-VN')} từ</span>
            {story.branchCount > 1 && (
              <>
                <Dot />
                <span className="text-[var(--color-accent)]">
                  ⑂ {story.branchCount - 1} nhánh rẽ
                </span>
              </>
            )}
            {story.genres.length > 0 && (
              <>
                <Dot />
                <span className="text-[var(--color-muted)]">
                  {story.genres.join(' · ')}
                </span>
              </>
            )}
          </div>

          <Link href={`/doc/${story.id}`} className="btn btn-primary btn-lg">
            Đọc & nghe
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

function StoryCard({ story: s }: { story: Story }) {
  return (
    <Link href={`/doc/${s.id}`} className="group flex flex-col gap-3">
      <div className="cover aspect-[3/4]">
        {s.coverUrl && <CoverThumb src={s.coverUrl} alt="" />}
        <span className="scrim label flex items-center gap-2 text-white/85">
          {s.contributionCount} chương
          {/* `branchCount` includes the story itself, so the forks are one
              fewer. Shown on the cover because it is the one thing that sets
              a story here apart from the same story anywhere else: other
              people have taken it somewhere. */}
          {s.branchCount > 1 && (
            <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-px text-[9.5px] text-[var(--color-on-accent)]">
              ⑂ {s.branchCount - 1} nhánh
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Clamped to two lines and held at two lines' height. A title that
            wraps where its neighbour does not pushes everything below it out
            of line, and a grid out of line reads as broken rather than as
            varied. */}
        <h3 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">
          {s.title}
        </h3>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
          {s.synopsis}
        </p>
        <p className="truncate text-[11.5px] text-[var(--color-faint)]">
          {s.genres.join(' · ')}
        </p>
        {/* Who wrote it and how it is rated, on one line at the foot of the
            card, so a row of covers can be scanned for both at a glance. */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] pt-2 text-[12px]">
          <span className="truncate text-[var(--color-muted)]">
            <AuthorByline storyId={s.id} handle={storyAuthorHandle(s)} nested />
          </span>
          <RatingBadge rating={storyRating(s)} className="flex-none text-[12px]" />
        </div>
      </div>
    </Link>
  );
}

/** Shaped like the grid it replaces, so the page does not jump when it lands. */
function CoverSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="skeleton aspect-[3/4]" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-[var(--color-line-strong)]">
      ·
    </span>
  );
}
