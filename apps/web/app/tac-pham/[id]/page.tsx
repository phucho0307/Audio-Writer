import Link from 'next/link';
import { thumbUrl } from '@/lib/thumb';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DISCOVERED_WORKS, FAMOUS_WORKS, famousAuthor } from '@/lib/famous-catalog';
import { NATIVE_WORKS } from '@/lib/native-catalog';
import FamousWorkCard from '@/app/kham-pha/FamousWorkCard';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const work = FAMOUS_WORKS.find((item) => item.id === id) ?? DISCOVERED_WORKS.find((item) => item.id === id);
  if (!work) return {};
  return { title: `${work.title} — ${famousAuthor(work.authorId).name}` };
}

export default async function FamousWorkPage({ params }: Props) {
  const { id } = await params;
  const native = NATIVE_WORKS.find((item) => item.id === id || item.catalogAliases?.includes(id));
  if (native) redirect(`/doc/${native.nativeStoryId}`);
  const work = FAMOUS_WORKS.find((item) => item.id === id) ?? DISCOVERED_WORKS.find((item) => item.id === id);
  if (!work) notFound();
  const author = famousAuthor(work.authorId);
  const related = FAMOUS_WORKS.filter((item) => item.authorId === work.authorId && item.id !== work.id).slice(0, 8);

  return (
    <main className="mx-auto flex max-w-[1040px] flex-col gap-9 px-5 py-10 sm:px-8 sm:py-14">
      <Link href={`/kham-pha?tacgia=${author.id}`} className="self-start text-[12.5px] text-[var(--color-muted)] hover:text-[var(--color-accent)]">← Khám phá · {author.name}</Link>
      <header className="flex items-start gap-5 sm:gap-7">
        <div className="cover aspect-[3/4] w-[100px] shrink-0 sm:w-[150px]">
          {work.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl(work.coverUrl)} alt={`Bìa ${work.title}`} className={work.videoId ? '!object-contain' : ''} />
          ) : <span className="display flex h-full items-center justify-center p-4 text-lg">{work.title}</span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
          <span className="label label-accent">{work.format === 'audio' ? 'Truyện audio' : 'Tác phẩm văn học'}</span>
          <h1 className="display text-[1.9rem] leading-tight sm:text-[2.7rem]">{work.title}</h1>
          <Link href={`/kham-pha?tacgia=${author.id}`} className="text-[15px] text-[var(--color-muted)] hover:text-[var(--color-accent)]">{author.name}</Link>
          <div className="flex flex-wrap gap-1.5">{work.genres.map((genre) => <span key={genre} className="chip cursor-default">{genre}</span>)}</div>
        </div>
      </header>

      {work.videoId ? (
        <section className="flex flex-col gap-4">
          <div className="aspect-video overflow-hidden rounded-lg border border-[var(--color-line)] bg-black">
            <iframe src={`https://www.youtube-nocookie.com/embed/${work.videoId}`} title={`${work.title} — ${author.name}`} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-[var(--color-muted)]">Phát từ kênh {work.sourceName}.</p>
            <a href={work.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Nghe trên YouTube ↗</a>
          </div>
        </section>
      ) : (
        <section className="card flex flex-col items-start gap-4 p-5 sm:p-7">
          <h2 className="display text-2xl">Bản chữ chưa có trong thư viện</h2>
          <p className="max-w-[65ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
            Tác phẩm này chưa có bản đầy đủ để đọc và nghe trên web. Bạn có thể chọn những truyện hiện đã có trong thư viện.
          </p>
          <Link href={`/kham-pha?tacgia=${author.id}`} className="btn btn-primary">Chọn truyện để đọc →</Link>
        </section>
      )}

      <section className="flex flex-col gap-2 border-l-2 border-[var(--color-accent)] pl-4">
        <h2 className="display text-xl">{author.name}</h2>
        <p className="max-w-[65ch] text-[14px] leading-relaxed text-[var(--color-muted)]">{author.note}</p>
        <a href={author.sourceUrl} target="_blank" rel="noopener noreferrer" className="self-start text-[12px] text-[var(--color-muted)] underline underline-offset-4">Trang tác giả tại nguồn ↗</a>
      </section>

      {related.length > 0 && <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-3">
          <h2 className="label">Cùng tác giả</h2>
          <Link href={`/kham-pha?tacgia=${author.id}`} className="text-[12px] text-[var(--color-accent)]">Xem tất cả →</Link>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">{related.map((item) => <FamousWorkCard key={item.id} work={item} />)}</div>
      </section>}
    </main>
  );
}
