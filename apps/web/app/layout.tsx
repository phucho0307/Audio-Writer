import type { Metadata } from 'next';
import Link from 'next/link';
import Nav from './Nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Audio Writer',
    template: '%s · Audio Writer',
  },
  description:
    'Viết truyện cùng AI. Rẽ nhánh câu chuyện. Nghe bản audio miễn phí.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-line)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
            <Link
              href="/"
              className="font-serif text-xl tracking-tight hover:text-[var(--color-accent)]"
            >
              Audio Writer
            </Link>
<Nav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
