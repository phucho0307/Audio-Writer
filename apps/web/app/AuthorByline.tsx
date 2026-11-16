'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Handle from './Handle';
import { nativeBranch, nativeStory } from '@/lib/native-catalog';

/** Literary attribution for imported works; account handles for other posts. */
export default function AuthorByline({ storyId, branchId, handle, nested = false, className = '' }: {
  storyId?: string;
  branchId?: string;
  handle?: string | null;
  nested?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const work = branchId ? nativeBranch(branchId) : storyId ? nativeStory(storyId) : undefined;
  if (!work) return handle ? <Handle handle={handle} nested={nested} className={className} title="Tác giả" /> : null;
  const href = work.textSource.collectionId === 'chinese-drama'
    ? '/kham-pha?ke=truyen-trung'
    : `/kham-pha?tacgia=${work.authorId}`;
  const cls = `transition-colors hover:text-[var(--color-accent)] hover:underline underline-offset-2 ${className}`;
  if (!nested) return <Link href={href} className={cls} title="Tác giả">{work.textSource.authorName}</Link>;
  const go = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    router.push(href);
  };
  return <span role="link" tabIndex={0} title="Tác giả" className={`cursor-pointer ${cls}`} onClick={go} onKeyDown={(event) => { if (event.key === 'Enter') go(event); }}>{work.textSource.authorName}</span>;
}
