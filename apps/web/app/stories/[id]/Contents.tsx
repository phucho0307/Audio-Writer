'use client';

import type { Contribution } from '@/lib/api';
import { chapterAuthorHandle } from '@/lib/chapter-author';
import AuthorByline from '@/app/AuthorByline';

/**
 * The chapter list.
 *
 * Rendered twice: as a sticky rail beside the editor on wide screens, and
 * inline above the story on narrow ones. One component rather than two blocks
 * of markup, because the two would drift the moment either is touched.
 */
export default function Contents({
  chapters,
  branchId,
  editable,
  editingId,
  lockedCount,
  onPick,
  rail = false,
}: {
  chapters: Contribution[];
  branchId: string | null;
  editable: boolean;
  editingId: string | null;
  lockedCount: number;
  onPick: (id: string) => void;
  rail?: boolean;
}) {
  if (chapters.length < 2) return null;

  return (
    <nav className="flex flex-col">
      <h2 className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-2 font-mono text-[12px] uppercase tracking-widest text-[var(--color-muted)]">
        <span>Mục lục</span>
        {editable && !rail && (
          <span className="normal-case tracking-normal opacity-70">
            bấm vào chương để sửa
          </span>
        )}
      </h2>

      <ol className={rail ? 'flex flex-col overflow-y-auto' : 'flex flex-col'}>
        {chapters.map((c) => {
          const own = c.branchId === branchId;
          const open = editingId === c.id;
          const authorHandle = chapterAuthorHandle(c);
          return (
            <li key={c.id}>
              {/* An anchor, not a route: the chapters are already on the page,
                  and navigating away would lose whatever is in the editor. */}
              <a
                href={`#chuong-${c.depth + 1}`}
                onClick={() => {
                  if (editable && own) onPick(c.id);
                }}
                className={`group flex border-b border-[var(--color-line)] transition-colors ${
                  rail
                    ? 'items-baseline gap-2 py-2'
                    : 'items-baseline gap-4 py-2.5'
                } ${open ? 'text-[var(--color-accent)]' : ''}`}
              >
                <span className="w-5 flex-none font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
                  {c.depth + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate transition-colors group-hover:text-[var(--color-accent)] ${
                    rail ? 'text-[13px]' : 'text-[14px]'
                  }`}
                >
                  <span className="block truncate">{c.title ?? c.textPlain.split('\n')[0].slice(0, 60)}</span>
                  <span className="block truncate pt-0.5 text-[11px] text-[var(--color-faint)]"><AuthorByline branchId={c.branchId} handle={authorHandle} nested /></span>
                </span>

                {/* The rail is narrow enough that word counts crowd out the
                    titles, which are the thing being scanned for. */}
                {!rail && (
                  <span className="flex flex-none items-baseline gap-3 font-mono text-[12px] text-[var(--color-muted)]">
                    {!own && <span className="opacity-60">kế thừa</span>}
                    <span className="opacity-60">{c.wordCount} từ</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}

        {lockedCount > 0 && (
          <li className="flex items-baseline gap-2 border-b border-[var(--color-line)] py-2 opacity-50">
            <span className="w-5 flex-none font-mono text-[12px]">🔒</span>
            <span className="flex-1 text-[13px] text-[var(--color-muted)]">
              Còn {lockedCount} chương chưa mở khoá
            </span>
          </li>
        )}
      </ol>

      {editable && rail && (
        <p className="pt-2 font-mono text-[12px] text-[var(--color-muted)]">
          bấm vào chương để sửa
        </p>
      )}
    </nav>
  );
}
