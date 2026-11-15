'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Account from './Account';

/**
 * Reading lives under the library, so /doc/* keeps "khám phá" lit rather than
 * leaving the whole bar dark while someone is three chapters into a story.
 */
const LINKS = [
  { href: '/', label: 'Trang chủ', match: [] as string[] },
  { href: '/kham-pha', label: 'Khám phá', match: ['/kham-pha', '/doc'] },
  { href: '/tham-khao', label: 'Tham khảo', match: ['/tham-khao'] },
  { href: '/cua-toi', label: 'Truyện của tôi', match: ['/cua-toi', '/stories'] },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 sm:gap-5">
      {LINKS.map((l) => {
        const active =
          pathname === l.href ||
          l.match.some((m) => m !== '/' && pathname.startsWith(m));

        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`relative hidden py-1 text-[13px] font-medium tracking-[0.01em] transition-colors sm:inline ${
              active
                ? 'text-[var(--color-ink)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {/* Desktop only. On a phone the sections live in the bottom tab
                bar - see MobileTabs - because they do not fit across. */}
            {l.label}

            {/* An underline rather than a colour swap alone - colour on its own
                is easy to miss at this size, and invisible to anyone who
                cannot distinguish it. Anchored to the link, so the header's
                padding can change without the indicator drifting. */}
            <span
              aria-hidden
              className={`absolute inset-x-0 -bottom-1 h-[1.5px] rounded-full transition-colors ${
                active ? 'bg-[var(--color-accent)]' : 'bg-transparent'
              }`}
            />
          </Link>
        );
      })}

      {/* Separated from the section links: this is who you are, not where you
          are, and the underline treatment above would misread as a third tab. */}
      <span
        className="mx-1 hidden h-4 w-px bg-[var(--color-line)] sm:block"
        aria-hidden
      />
      <Account />
    </nav>
  );
}
