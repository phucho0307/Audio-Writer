'use client';

import { thumbUrl } from '@/lib/thumb';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Story, type CoverCandidate, type CoverSuggestions, type CoverUpdate } from '@/lib/api';

type CoverStory = Pick<Story, 'id' | 'title' | 'coverUrl' | 'coverCredit'>;

export default function StoryCover({ story, onChange, className = '' }: {
  story: CoverStory;
  onChange: (cover: CoverUpdate) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        aria-label={`${story.coverUrl ? 'Đổi' : 'Thêm'} ảnh bìa cho ${story.title}`}
        className={`cover cover-picker group/cover aspect-[3/4] w-full text-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)] ${className}`}>
        {story.coverUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(story.coverUrl)} alt={`Ảnh bìa ${story.title}`} loading="lazy" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-3 pt-10 text-[12px] text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover/cover:opacity-100 sm:group-focus-visible/cover:opacity-100">Đổi ảnh bìa</span>
          </>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2">
            <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-[var(--color-accent-line)] text-3xl font-light text-[var(--color-accent)]">+</span>
            <span className="text-[12px]">Thêm ảnh bìa</span>
          </span>
        )}
      </button>
      {open && createPortal(<CoverDialog story={story} onClose={() => setOpen(false)} onChange={onChange} />, document.body)}
    </>
  );
}

function CoverDialog({ story, onClose, onChange }: {
  story: CoverStory;
  onClose: () => void;
  onChange: (cover: CoverUpdate) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'upload' | 'ai'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<CoverCandidate | null>(null);
  const [suggestions, setSuggestions] = useState<CoverSuggestions | null>(null);
  const [hint, setHint] = useState('');
  const [searchedHint, setSearchedHint] = useState('');
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<string[]>([]);
  const current = story.coverUrl ? thumbUrl(story.coverUrl) : story.coverUrl;
  const preview = mode === 'upload' ? localUrl ?? current : selected?.previewUrl ?? current;
  const credit = mode === 'ai' ? selected?.credit ?? story.coverCredit : file ? null : story.coverCredit;
  const canSave = mode === 'upload' ? !!file : !!selected;

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  useEffect(() => {
    if (!file) { setLocalUrl(null); return; }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseFile(next?: File) {
    setError(null);
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) {
      setError('Hãy chọn ảnh JPG, PNG hoặc WebP.'); return;
    }
    if (next.size > 8 * 1024 * 1024) { setError('Ảnh phải nhỏ hơn 8 MB.'); return; }
    setFile(next);
  }

  async function search(nextPage = 1) {
    setSearching(true); setError(null); setSelected(null);
    try {
      const result = await api.suggestCovers(story.id, hint.trim(), nextPage);
      setSuggestions(result); setPage(nextPage); setSearchedHint(hint.trim()); setBroken([]);
    } catch (e) { setError((e as Error).message); }
    finally { setSearching(false); }
  }

  async function save(remove = false) {
    setSaving(true); setError(null);
    try {
      const cover = remove ? await api.removeCover(story.id)
        : mode === 'upload' && file ? await api.uploadCover(story.id, file)
        : selected && suggestions ? await api.selectCover(story.id, suggestions.searchId, selected.id)
        : null;
      if (cover) { onChange(cover); onClose(); }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <dialog ref={dialog} aria-labelledby="cover-dialog-title" aria-describedby="cover-dialog-description"
      className="cover-dialog" onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] p-5 sm:px-6">
          <div>
            <h2 id="cover-dialog-title" className="display text-2xl">Ảnh bìa truyện</h2>
            <p id="cover-dialog-description" className="mt-1 text-[13px] text-[var(--color-muted)]">Chọn một hình ảnh cho “{story.title}”.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Đóng chọn ảnh bìa" className="btn btn-quiet h-8 w-8 shrink-0 p-0 text-xl">×</button>
        </header>

        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <div className="flex shrink-0 flex-col items-start gap-2 sm:w-[150px]">
              <div className="cover aspect-[3/4] w-[105px] sm:w-full">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Xem trước ảnh bìa" />
                ) : <span aria-hidden className="absolute inset-0 flex items-center justify-center text-5xl font-light text-[var(--color-line-strong)]">+</span>}
              </div>
              <span className="text-[11px] text-[var(--color-muted)]">Xem trước · khung 3:4</span>
              {credit && <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className="max-w-full text-[11px] text-[var(--color-muted)] underline underline-offset-2">{credit.photographer ? `${credit.photographer} / Pexels` : 'Ảnh từ Pexels'} ↗</a>}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-5 flex gap-2" role="group" aria-label="Cách chọn ảnh bìa">
                <button type="button" aria-pressed={mode === 'upload'} disabled={saving || searching} onClick={() => { setMode('upload'); setError(null); }} className={`btn btn-sm ${mode === 'upload' ? 'btn-primary' : 'btn-ghost'}`}>Tải ảnh lên</button>
                <button type="button" aria-pressed={mode === 'ai'} disabled={saving || searching} onClick={() => { setMode('ai'); setError(null); if (!suggestions) void search(); }} className={`btn btn-sm ${mode === 'ai' ? 'btn-primary' : 'btn-ghost'}`}><span aria-hidden>✦</span> Nhờ AI tìm ảnh</button>
              </div>

              {mode === 'upload' ? (
                <div>
                  <button type="button" disabled={saving} onClick={() => input.current?.click()} className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center transition-colors hover:border-[var(--color-accent)]">
                    <span aria-hidden className="text-3xl font-light text-[var(--color-accent)]">+</span>
                    <span className="text-sm">{file ? 'Chọn ảnh khác' : 'Chọn ảnh từ thiết bị'}</span>
                    <span className="text-[12px] text-[var(--color-muted)]">JPG, PNG, WebP · tối đa 8 MB</span>
                  </button>
                  <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Chọn tệp ảnh bìa" onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">Ảnh được cắt giữa theo khung dọc 3:4. Chọn ảnh có chủ thể ở giữa, ít nhất 256 × 256 px.</p>
                  {file && <p className="mt-2 truncate text-[12px]">{file.name}</p>}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">AI đọc tên truyện, phần giới thiệu và đoạn mở đầu để gợi ý ảnh. Bạn chọn ảnh trước khi lưu.</p>
                  <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="flex gap-2">
                    <input aria-label="Gợi ý hình ảnh cho AI" maxLength={300} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Gợi ý thêm: căn nhà trong sương…" className="field min-w-0 flex-1 text-[12px]" disabled={searching || saving} />
                    <button type="submit" disabled={searching || saving} className="btn btn-ghost btn-sm">Tìm ảnh</button>
                  </form>
                  {searching ? <p role="status" className="py-8 text-center text-sm text-[var(--color-muted)]">✦ AI đang tìm ảnh phù hợp…</p> : suggestions && (
                    <>
                      <p className="text-[11px] text-[var(--color-muted)]">{suggestions.source === 'library' ? 'AI chọn từ kho ảnh Pexels hiện có.' : 'Ảnh mới tìm trên Pexels.'} Bấm vào ảnh để xem trước.</p>
                      <div className="grid grid-cols-3 gap-2">
                        {suggestions.candidates.map((candidate) => (
                          <button key={candidate.id} type="button" disabled={saving || broken.includes(candidate.id)} aria-label={`Chọn ảnh: ${candidate.description}`} aria-pressed={selected?.id === candidate.id} onClick={() => setSelected(candidate)} className={`relative aspect-[3/4] overflow-hidden rounded-md border-2 transition-colors disabled:opacity-30 ${selected?.id === candidate.id ? 'border-[var(--color-accent)]' : 'border-transparent hover:border-[var(--color-accent-line)]'}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={candidate.previewUrl} alt={candidate.description} className="h-full w-full object-cover" onError={() => { setBroken((ids) => [...ids, candidate.id]); setSelected((pick) => pick?.id === candidate.id ? null : pick); }} />
                            {candidate.recommended && <span className="absolute bottom-0 inset-x-0 bg-black/65 py-1 text-[10px] text-white">✦ Gợi ý đầu tiên</span>}
                            {selected?.id === candidate.id && <span aria-hidden className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)]">✓</span>}
                          </button>
                        ))}
                      </div>
                      {suggestions.hasMore && <button type="button" disabled={saving} onClick={() => void search(searchedHint === hint.trim() ? page + 1 : 1)} className="btn btn-quiet btn-sm self-start">Xem ảnh khác →</button>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {error && <p role="alert" className="mt-4 text-[13px] text-[var(--color-son)]">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line)] p-4 sm:px-6">
          {story.coverUrl && <button type="button" disabled={saving || searching} onClick={() => void save(true)} className="btn btn-quiet btn-sm mr-auto text-[var(--color-son)]">Gỡ ảnh</button>}
          <button type="button" disabled={saving} onClick={onClose} className="btn btn-ghost btn-sm">Hủy</button>
          <button type="button" disabled={!canSave || saving || searching} onClick={() => void save()} className="btn btn-primary btn-sm">{saving ? 'Đang lưu…' : 'Dùng ảnh này'}</button>
        </footer>
      </div>
    </dialog>
  );
}
