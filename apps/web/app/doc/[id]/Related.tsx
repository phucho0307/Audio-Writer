'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type RelatedStories } from '@/lib/api';
import CoverThumb from '@/app/CoverThumb';

/**
 * Where to go after this story.
 *
 * "Tương tự" is measured - the nearest stories by what they are about, from
 * the descriptions AI search already wrote. When this story has no
 * description yet the list is the most-read stories sharing a genre, and the
 * heading says that instead: it never claims a likeness nobody measured.
 */
export default function Related({ storyId }: { storyId: string }) {
  const [related, setRelated] = useState<RelatedStories | null>(null);

  useEffect(() => {
    let live = true;
    setRelated(null);
    api
      .related(storyId)
      .then((r) => live && setRelated(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [storyId]);

  if (!related || related.stories.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="related-title">
      <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-2.5">
        <h2 id="related-title" className="label">
          {related.basis === 'similar' ? 'Truyện tương tự' : 'Cùng thể loại, nhiều người đọc'}
        </h2>
        <Link href="/kham-pha?tim=ai" className="text-[11.5px] text-[var(--color-muted)] hover:text-[var(--color-accent)]">
          Tả truyện bạn muốn, AI tìm giùm →
        </Link>
      </div>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
        {related.stories.map((s) => (
          <li key={s.id}>
            <Link href={`/doc/${s.id}`} className="group flex flex-col gap-2">
              <span className="cover aspect-[3/4]">{s.coverUrl && <CoverThumb src={s.coverUrl} alt="" />}</span>
              <span className="line-clamp-2 font-serif text-[13.5px] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                {s.title}
              </span>
              <span className="truncate text-[11px] text-[var(--color-faint)]">
                {s.contributionCount} chương{s.genres[0] ? ` · ${s.genres[0]}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
