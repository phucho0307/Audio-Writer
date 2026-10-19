import * as Y from 'yjs';

/**
 * The shared field every client binds its editor to.
 *
 * A `Y.XmlFragment`, not a `Y.Text`, because that is what ProseMirror - and so
 * TipTap - maps onto: paragraphs are real nodes rather than newlines inside one
 * long string. Yjs refuses to hand back the same name as two different types,
 * so this choice has to be made once and made everywhere.
 */
export const BODY = 'body';

/** Small facts about the room that are not part of the prose. */
export const META = 'meta';

/**
 * The draft as paragraphs of plain text.
 *
 * Walks the fragment rather than calling `toString()`, which would return the
 * XML markup around the words. Anything that is not a paragraph of text (an
 * image, a horizontal rule) contributes nothing, which is correct for a
 * narration pipeline that only ever reads prose aloud.
 */
export function paragraphsOf(fragment: Y.XmlFragment): string[] {
  const out: string[] = [];

  const walk = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText | Y.XmlHook) => {
    if (node instanceof Y.XmlText) {
      out[out.length - 1] += node.toString();
      return;
    }
    if (node instanceof Y.XmlElement && node.nodeName === 'paragraph') {
      out.push('');
    }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      node.toArray().forEach(walk);
    }
  };

  fragment.toArray().forEach(walk);
  return out.map((p) => p.trim()).filter(Boolean);
}

export function textOf(fragment: Y.XmlFragment): string {
  return paragraphsOf(fragment).join('\n\n');
}

export function wordsIn(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Plain paragraphs in the shape the chapter column stores. */
export function toProseMirror(paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  };
}

/**
 * Append an empty paragraph and hand back the text node inside it.
 *
 * Used by the model so its prose starts on its own line instead of running
 * into whatever a human is mid-sentence on, and so the chunks that follow all
 * land in one paragraph.
 */
export function appendParagraph(fragment: Y.XmlFragment): Y.XmlText {
  const paragraph = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  fragment.insert(fragment.length, [paragraph]);
  return text;
}
