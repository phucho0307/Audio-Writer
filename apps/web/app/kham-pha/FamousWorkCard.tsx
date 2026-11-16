'use client';

import { useState } from 'react';
import Link from 'next/link';
import { famousAuthor, type FamousWork } from '@/lib/famous-catalog';
import CoverThumb, { thumbUrl } from '../CoverThumb';

export default function FamousWorkCard({ work }: { work: FamousWork }) {
  const author = famousAuthor(work.authorId);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <Link href={work.nativeStoryId ? `/doc/${work.nativeStoryId}` : `/tac-pham/${work.id}`} className="group flex flex-col gap-3">
      <div className="cover aspect-[3/4]">
        {work.coverUrl && !imageFailed ? (
          <>
            {work.videoId && <div aria-hidden className="absolute inset-0 scale-125 bg-cover bg-center opacity-35 blur-xl" style={{ backgroundImage: `url(${thumbUrl(work.coverUrl)})` }} />}
            <CoverThumb src={work.coverUrl} alt={`Bìa ${work.title}`} onFail={() => setImageFailed(true)} className={work.videoId ? 'relative !object-contain' : ''} />
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-[var(--color-accent-soft)] px-5">
            <span className="label text-[var(--color-accent)]">{author.name}</span>
            <span className="display text-xl leading-tight sm:text-2xl">{work.title}</span>
            <span className="h-px w-10 bg-[var(--color-accent)]" />
          </div>
        )}
        <span className="scrim label flex items-center gap-1.5 text-white/85">
          <span aria-hidden>{work.nativeStoryId ? '▷' : work.format === 'audio' ? '▷' : '↗'}</span>
          {work.nativeStoryId ? 'Đọc & nghe' : work.videoId ? 'Nghe truyện' : work.format === 'audio' ? 'Sách nói' : 'Tác phẩm'}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <h3 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">{work.title}</h3>
        <p className="text-[13px] text-[var(--color-muted)]">{author.name}</p>
        <p className="truncate text-[11.5px] text-[var(--color-faint)]">{work.genres.join(' · ')}</p>
        <span className="mt-auto border-t border-[var(--color-line)] pt-2 text-[11.5px] text-[var(--color-muted)]">
          {work.nativeStoryId ? `${work.chapterCount} chương · Đọc trên web` : work.videoId ? 'Kênh chính thức · YouTube' : work.sourceName} <span aria-hidden>{work.nativeStoryId ? '→' : '↗'}</span>
        </span>
      </div>
    </Link>
  );
}
