'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ChineseWork } from '@/lib/chinese-catalog';
import CoverThumb from '../CoverThumb';

export default function ChineseWorkCard({ work }: { work: ChineseWork }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <Link href={`/doc/${work.nativeStoryId}`} className="group flex flex-col gap-3">
      <div className="cover aspect-[3/4]">
        {work.coverUrl && !imageFailed ? (
          <CoverThumb src={work.coverUrl} alt={`Bìa ${work.title}`} onFail={() => setImageFailed(true)} />
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-[var(--color-accent-soft)] px-5">
            <span className="label text-[var(--color-accent)]">Truyện Trung</span>
            <span className="display text-xl leading-tight sm:text-2xl">{work.title}</span>
          </div>
        )}
        <span className="scrim label flex items-center gap-1.5 text-white/85"><span aria-hidden>▷</span> Đọc & nghe</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <h3 className="display line-clamp-2 min-h-[2.4em] text-[17px] leading-[1.2] transition-colors group-hover:text-[var(--color-accent)]">{work.title}</h3>
        <p className="truncate text-[13px] text-[var(--color-muted)]">{work.authorName === 'Khuyết danh' ? `Dịch: ${work.textSource.translator || work.sourceName}` : work.authorName}</p>
        <p className="truncate text-[11.5px] text-[var(--color-faint)]">{work.genres.filter((genre) => genre !== 'Truyện Trung').join(' · ') || 'Truyện Trung'}</p>
        <span className="mt-auto border-t border-[var(--color-line)] pt-2 text-[11.5px] text-[var(--color-muted)]">{work.chapterCount} phần đọc · {work.sourceName} <span aria-hidden>→</span></span>
      </div>
    </Link>
  );
}
