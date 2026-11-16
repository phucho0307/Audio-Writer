'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * "@handle" that opens that person's page.
 *
 * Most bylines sit inside a card that is itself a link, and a link inside a
 * link is invalid HTML that browsers repair unpredictably. Inside one, pass
 * `nested`: it renders a span that behaves as a link and stops the click from
 * also opening the card.
 */
export default function Handle({
  handle,
  nested = false,
  className = '',
  title,
}: {
  handle: string;
  nested?: boolean;
  className?: string;
  title?: string;
}) {
  const router = useRouter();
  const href = `/u/${encodeURIComponent(handle)}`;
  const cls = `transition-colors hover:text-[var(--color-accent)] hover:underline underline-offset-2 ${className}`;

  if (!nested) {
    return (
      <Link href={href} className={cls} title={title}>
        @{handle}
      </Link>
    );
  }

  const go = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(href);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      title={title}
      className={`cursor-pointer ${cls}`}
      onClick={go}
      onKeyDown={(e) => (e.key === 'Enter' ? go(e) : undefined)}
    >
      @{handle}
    </span>
  );
}
