import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { thumbUrl } from '@/lib/thumb';

/**
 * The story's own title, description and cover for whoever links to it.
 *
 * The pages under /doc are drawn in the browser, so without this every story
 * shared on Facebook or Zalo showed up as "Nhịp Bút" with no picture, and a
 * search engine saw one generic page a thousand times. This runs on the
 * server and asks the API for just the story. A private story is a 404 there,
 * so it gets the site's defaults and nothing about it leaks.
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const SITE = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

type StoryMeta = {
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  genres: string[];
  contributionCount: number;
  textSource?: { authorName?: string } | null;
  owner?: { displayName: string } | null;
};

async function storyMeta(id: string): Promise<StoryMeta | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const res = await fetch(`${API}/api/stories/${id}`, {
      // Titles and covers change rarely; a stale preview for a few minutes is fine.
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? ((await res.json()) as StoryMeta) : null;
  } catch {
    return null;
  }
}

function absolute(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const story = await storyMeta(id);
  if (!story) return {};

  const author = story.textSource?.authorName ?? story.owner?.displayName;
  const summary = (story.synopsis ?? '').replace(/\s+/g, ' ').trim();
  const description = [
    summary.length > 180 ? `${summary.slice(0, 177).trimEnd()}…` : summary,
    `${story.contributionCount} chương${story.genres.length ? ` · ${story.genres.slice(0, 3).join(', ')}` : ''}. Đọc và nghe miễn phí trên ${BRAND}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const image = story.coverUrl ? absolute(thumbUrl(story.coverUrl)) : undefined;

  return {
    metadataBase: new URL(SITE),
    title: story.title,
    description,
    alternates: { canonical: `/doc/${id}` },
    openGraph: {
      type: 'book',
      siteName: BRAND,
      locale: 'vi_VN',
      title: story.title,
      description,
      url: `/doc/${id}`,
      ...(image ? { images: [{ url: image, width: 480, height: 640, alt: story.title }] } : {}),
      ...(author ? { authors: [author] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: story.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default function StoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
