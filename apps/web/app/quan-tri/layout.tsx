import type { Metadata } from 'next';

// Never in search results: the page is for the owner only.
export const metadata: Metadata = { title: 'Quản trị', robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
