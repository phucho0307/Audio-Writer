'use client';

import { useEditorState, type Editor } from '@tiptap/react';

/**
 * Formatting controls for any of the app's editors, in the spirit of Gmail's
 * compose bar: a compact row of toggles above the text. The same bar sits on
 * the shared draft room, the private composer and the chapter editor, so a
 * writer learns it once.
 *
 * Active states come from `useEditorState`, which re-renders the bar only
 * when one of these flags changes rather than on every keystroke. Every
 * command has its keyboard shortcut (Ctrl+B, Ctrl+I, Ctrl+U...) from TipTap;
 * the buttons are for people who do not know them.
 */
export default function FormatToolbar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            quote: e.isActive('blockquote'),
            heading: e.isActive('heading', { level: 3 }),
            // The shared room's history belongs to Yjs, not to TipTap; ask
            // rather than assume the commands exist on every editor.
            canUndo: canRun(e, 'undo'),
            canRedo: canRun(e, 'redo'),
            editable: e.isEditable,
          }
        : null,
  });
  if (!editor || !s || !s.editable) return null;

  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () =>
    fn(editor.chain().focus()).run();

  const Btn = ({
    on,
    label,
    title,
    onClick,
    disabled,
    className = '',
  }: {
    on?: boolean;
    label: React.ReactNode;
    title: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      type="button"
      // Keep the selection: a mousedown on the button would otherwise blur
      // the editor before the command runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={title}
      title={title}
      className={`grid h-8 min-w-8 place-items-center rounded-[4px] px-1.5 text-[14px] transition-colors disabled:opacity-35 ${
        on
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]'
      } ${className}`}
    >
      {label}
    </button>
  );
  const Sep = () => <span aria-hidden className="mx-1 h-5 w-px bg-[var(--color-line)]" />;

  return (
    <div
      role="toolbar"
      aria-label="Định dạng văn bản"
      className="flex flex-wrap items-center gap-0.5 rounded-[5px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
    >
      <Btn title="Hoàn tác (Ctrl+Z)" label="↶" onClick={run((c) => c.undo())} disabled={!s.canUndo} />
      <Btn title="Làm lại (Ctrl+Y)" label="↷" onClick={run((c) => c.redo())} disabled={!s.canRedo} />
      <Sep />
      <Btn title="In đậm (Ctrl+B)" on={s.bold} label={<b>B</b>} onClick={run((c) => c.toggleBold())} />
      <Btn title="In nghiêng (Ctrl+I)" on={s.italic} label={<i className="font-serif">I</i>} onClick={run((c) => c.toggleItalic())} />
      <Btn title="Gạch dưới (Ctrl+U)" on={s.underline} label={<u>U</u>} onClick={run((c) => c.toggleUnderline())} />
      <Btn title="Gạch ngang" on={s.strike} label={<s>S</s>} onClick={run((c) => c.toggleStrike())} />
      <Sep />
      <Btn title="Tiêu đề nhỏ" on={s.heading} label={<span className="text-[12px] font-semibold">H</span>} onClick={run((c) => c.toggleHeading({ level: 3 }))} />
      <Btn title="Danh sách chấm" on={s.bullet} label="•≡" onClick={run((c) => c.toggleBulletList())} />
      <Btn title="Danh sách số" on={s.ordered} label={<span className="text-[12px]">1.</span>} onClick={run((c) => c.toggleOrderedList())} />
      <Btn title="Trích dẫn" on={s.quote} label="❝" onClick={run((c) => c.toggleBlockquote())} />
      <Sep />
      <Btn title="Xoá định dạng" label={<span className="text-[12px]">T̸</span>} onClick={run((c) => c.unsetAllMarks().clearNodes())} />
    </div>
  );
}

function canRun(e: Editor, cmd: 'undo' | 'redo'): boolean {
  const can = e.can() as unknown as Record<string, (() => boolean) | undefined>;
  try {
    return typeof can[cmd] === 'function' ? Boolean(can[cmd]!()) : false;
  } catch {
    return false;
  }
}
