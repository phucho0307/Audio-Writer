'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Reading lives under the library, so /doc/* keeps "khám phá" lit rather than
 * leaving the whole bar dark while someone is three chapters into a story.
 */
const LINKS = [
  { href: '/kham-pha', label: 'khám phá', match: ['/kham-pha', '/doc'] },
  { href: '/', label: 'truyện của tôi', match: ['/stories'] },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-6">
      {LINKS.map((l) => {
        const active =
          pathname === l.href ||
          l.match.some((m) => m !== '/' && pathname.startsWith(m));

        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`relative py-1 font-mono text-[12px] transition-colors ${
              active
                ? 'text-[var(--color-ink)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {l.label}
            {/* An underline rather than a colour swap alone - colour on its own
                is easy to miss at 12px, and invisible to anyone who cannot
                distinguish it. */}
            <span
              className={`absolute inset-x-0 -bottom-[13px] h-[2px] transition-colors ${
                active ? 'bg-[var(--color-accent)]' : 'bg-transparent'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
