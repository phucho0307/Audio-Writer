/**
 * Chapters as rich documents.
 *
 * A chapter stores two things: `content`, the editor's ProseMirror document
 * (bold, italics, lists...), and `textPlain`, the flat text that narration,
 * search and word counts read. Older chapters, and anything saved before the
 * editors were rich, hold only a placeholder in `content` - `{type:'doc',
 * text}` - so everything here falls back to `textPlain` when there is no real
 * document to show.
 */

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: PMMark[];
  content?: PMNode[];
};
export type PMDoc = PMNode & { type: 'doc'; content: PMNode[] };

/** Is this a real ProseMirror document, not the legacy placeholder? */
export function isRichDoc(content: unknown): content is PMDoc {
  return (
    !!content &&
    typeof content === 'object' &&
    (content as PMNode).type === 'doc' &&
    Array.isArray((content as PMNode).content)
  );
}

/** Plain text as paragraphs: blank lines (or single newlines) split them. */
export function textToDoc(text: string): PMDoc {
  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

/** The document to show or edit for a chapter, whatever it was saved as. */
export function docOf(chapter: { content?: unknown; textPlain: string }): PMDoc {
  return isRichDoc(chapter.content) ? chapter.content : textToDoc(chapter.textPlain);
}

/** Two documents, one after the other - appending to a chapter. */
export function concatDocs(a: PMDoc, b: PMDoc): PMDoc {
  return { type: 'doc', content: [...a.content, ...b.content] };
}
