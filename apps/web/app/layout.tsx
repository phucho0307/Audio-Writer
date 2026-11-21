import type { Metadata } from 'next';
import Link from 'next/link';
import Nav from './Nav';
import { BRAND } from '@/lib/brand';
import ThemeToggle from './ThemeToggle';
import Atmosphere from './Atmosphere';
import BackgroundMusic from './BackgroundMusic';
import MotionToggle from './MotionToggle';
import MobileTabs from './MobileTabs';
import AuthDialog from './AuthDialog';
import VerifyBanner from './VerifyBanner';
import FollowBell from './FollowBell';
import './globals.css';

const CF_BEACON = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };

export const metadata: Metadata = {
  title: {
    default: BRAND,
    template: `%s · ${BRAND}`,
  },
  description:
    'Đọc, nghe và viết truyện. Khám phá truyện bạn thích, tạo nhánh mới và viết cùng bạn bè.',
};

/**
 * Applied before the first paint.
 *
 * A theme read from localStorage in an effect arrives one frame too late, and
 * that frame is a white flash in the face of someone reading horror at 1am.
 * Inline and synchronous is the only version that does not flash.
 *
 * Night is the default, whatever the system says: the site is built for
 * reading and listening in the dark. Day is there for whoever picks it.
 */
const THEME_BOOT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('aw-theme');d.setAttribute('data-theme',t==='light'?'light':'dark');var m=localStorage.getItem('aw-motion');if(m==='full'||m==='calm')d.setAttribute('data-motion',m)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* Fraunces for display (the SOFT and WONK axes are what give the
            headings their character), Be Vietnam Pro for the interface - it is
            drawn for Vietnamese diacritics, which most grotesques are not -
            and Newsreader for prose. All three ship a Vietnamese subset;
            a display face without one drops every dấu on the page. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap"
        />
      </head>
      {/* Extensions - Grammarly is the common one - stamp attributes onto
          <body> before React hydrates, which React then reports as a mismatch
          against markup that is in fact identical. Suppressed at this one
          element rather than wholesale, so a real mismatch inside the app
          still gets reported. */}
      <body className="relative min-h-screen" suppressHydrationWarning>
        {/* The CSS wash is the floor: it is what a reader with reduced motion,
            no WebGL or no JavaScript sees, and the shader draws over the top
            of it for everyone else. */}
        <div className="vignette" aria-hidden />
        <Atmosphere />
        <BackgroundMusic />
        <div className="grain" aria-hidden />

        {/* Sticky, because the player and the nav are both things you reach
            for mid-chapter. Translucent rather than solid so the cover art
            scrolling underneath stays visible through it. */}
        <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-ground)_82%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-5 py-3 sm:px-8">
            <Link
              href="/"
              className="group flex items-baseline gap-2.5"
              aria-label={`${BRAND}, trang chủ`}
            >
              <span className="display whitespace-nowrap text-[21px] leading-none">
                {BRAND}
              </span>
              <span
                className="label hidden text-[9.5px] text-[var(--color-faint)] sm:block"
                aria-hidden
              >
                truyện · audio
              </span>
            </Link>

            <div className="flex items-center gap-1 sm:gap-4">
              <Nav />
              <div className="flex items-center">
                <FollowBell />
                <MotionToggle />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </header>
        <VerifyBanner />

        <div className="relative z-10">{children}</div>

        <footer className="relative z-10 mt-24 border-t border-[var(--color-line)] pb-[calc(64px+env(safe-area-inset-bottom))] sm:pb-0">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-10 sm:flex-row sm:items-baseline sm:justify-between sm:px-8">
            <div className="flex items-baseline gap-4">
              <p className="display text-[15px] text-[var(--color-muted)]">
                {BRAND}
              </p>
              <a href="/chinh-sach-rieng-tu" className="text-[12.5px] text-[var(--color-faint)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline">
                Quyền riêng tư
              </a>
            </div>
            <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-[var(--color-faint)]">
              Bạn có thể xem tác giả và nguồn trong từng truyện.
            </p>
          </div>
        </footer>
        <MobileTabs />
        <AuthDialog />
        {/* Cloudflare Web Analytics: page views without cookies, so no consent
            banner. Off unless a token is compiled in. */}
        {CF_BEACON && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON })}
          />
        )}
      </body>
    </html>
  );
}
