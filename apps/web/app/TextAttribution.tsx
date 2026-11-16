import type { TextSource } from '@/lib/api';

export default function TextAttribution({ source }: { source?: TextSource | null }) {
  if (!source) return null;
  return (
    <details className="border-t border-[var(--color-line)] pt-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
      <summary className="cursor-pointer">Nguồn văn bản · {source.authorName}</summary>
      <p className="mt-2">Bản chữ từ <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{source.name}</a>. Giọng đọc: Edge TTS.</p>
      {source.translator && <p>Bản dịch: {source.translator}.</p>}
      {source.license && <p>Văn bản và bản đọc: <a href={source.license.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">CC BY-SA 4.0</a>{source.changes ? ` · ${source.changes}` : ''}</p>}
    </details>
  );
}
