'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The navigation on a phone, at the bottom where a thumb is.
 *
 * Four section links, a logo, an account menu and two toggles do not fit
 * across 390px - the header was 466px wide and every page scrolled sideways.
 * Squeezing the links into first-word fragments ("Khám", "Tham", "Truyện")
 * would have fixed the width and made them unreadable. A listening app is held
 * one-handed in the dark, so the sections move to a bar along the bottom and
 * the header keeps the things you reach for less often.
 */
const TABS = [
  {
    href: '/',
    label: 'Trang chủ',
    match: (p: string) => p === '/',
    icon: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  },
  {
    href: '/kham-pha',
    label: 'Khám phá',
    match: (p: string) => p.startsWith('/kham-pha') || p.startsWith('/doc') || p.startsWith('/tac-pham'),
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </>
    ),
  },
  {
    href: '/tham-khao',
    label: 'Tham khảo',
    match: (p: string) => p.startsWith('/tham-khao'),
    icon: (
      <>
        <path d="M5 4.5h10a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
        <path d="M17 7h2v13" />
        <path d="M8.5 9h5M8.5 12.5h5" />
      </>
    ),
  },
  {
    href: '/cua-toi',
    label: 'Của tôi',
    match: (p: string) => p.startsWith('/cua-toi') || p.startsWith('/stories'),
    icon: (
      <>
        <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V20l-7-4z" />
      </>
    ),
  },
];

export default function MobileTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-ground)_88%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
    >
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10.5px] font-medium transition-colors ${
                  active ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
                }`}
              >
                {/* The lit tab also carries a mark, not colour alone. */}
                <span
                  aria-hidden
                  className={`absolute top-0 h-[2px] w-8 rounded-full transition-colors ${
                    active ? 'bg-[var(--color-accent)]' : 'bg-transparent'
                  }`}
                />
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  aria-hidden
                >
                  {t.icon}
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
