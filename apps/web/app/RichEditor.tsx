'use client';

import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import FormatToolbar from './FormatToolbar';
import { textToDoc, type PMDoc } from '@/lib/prose';

export type RichEditorHandle = {
  /** Replace everything with plain text - used while the AI streams in. */
  setText: (text: string) => void;
  clear: () => void;
  focus: () => void;
};

/**
 * A rich text box for writing alone: the composer and the chapter editor.
 *
 * The draft room has its own editor bound to a shared Yjs document; this is
 * the same TipTap and the same toolbar without the collaboration, so writing
 * looks and behaves the same wherever it happens.
 *
 * Reports both shapes on every change: the document, which is what gets
 * stored, and its plain text, which narration, search and word counts read.
 */
const RichEditor = forwardRef<
  RichEditorHandle,
  {
    initial?: PMDoc | null;
    placeholder?: string;
    minHeight?: string;
    onChange: (doc: PMDoc, text: string) => void;
  }
>(function RichEditor({ initial, placeholder, minHeight = '14rem', onChange }, ref) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: initial ?? undefined,
    editorProps: {
      attributes: {
        class: 'prose-editor prose-rich',
        spellcheck: 'false',
        style: `min-height:${minHeight}`,
      },
    },
    onUpdate: ({ editor: e }) =>
      onChange(e.getJSON() as PMDoc, e.getText({ blockSeparator: '\n\n' })),
  });

  // Report the starting state once, so a parent holding an initial document
  // sees its text before the first keystroke.
  useEffect(() => {
    if (editor) onChange(editor.getJSON() as PMDoc, editor.getText({ blockSeparator: '\n\n' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      setText: (text) => editor?.commands.setContent(textToDoc(text), { emitUpdate: true }),
      clear: () => editor?.commands.clearContent(true),
      focus: () => editor?.commands.focus('end'),
    }),
    [editor],
  );

  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true });

  return (
    <div className="flex flex-col gap-2">
      <FormatToolbar editor={editor} />
      <div className="relative rounded-[5px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 transition-colors focus-within:border-[var(--color-accent-line)]">
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-3.5 top-3 font-serif text-[16.5px] text-[var(--color-faint)]">
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default RichEditor;
