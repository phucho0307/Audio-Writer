import { Fragment, type ReactNode } from 'react';
import type { PMDoc, PMMark, PMNode } from '@/lib/prose';

/**
 * A ProseMirror document, rendered as plain React.
 *
 * No editor is mounted to display a chapter: readers only need the
 * structure, and this is a few hundred bytes against TipTap's weight. React
 * escapes every text node, and links are allowed only with http(s) so a
 * stored `javascript:` href cannot run.
 *
 * Returns the block elements without a wrapper, so a parent's `> p` rules -
 * the reader's drop cap among them - still apply.
 */
export default function RichText({ doc }: { doc: PMDoc }) {
  return <>{doc.content.map((n, i) => block(n, i))}</>;
}

function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  return /^https?:\/\//i.test(href) ? href : null;
}

function inline(nodes: PMNode[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />;
    if (n.type !== 'text') return null;
    let out: ReactNode = n.text ?? '';
    for (const m of n.marks ?? []) out = mark(m, out);
    return <Fragment key={i}>{out}</Fragment>;
  });
}

function mark(m: PMMark, child: ReactNode): ReactNode {
  switch (m.type) {
    case 'bold':
      return <strong>{child}</strong>;
    case 'italic':
      return <em>{child}</em>;
    case 'underline':
      return <u>{child}</u>;
    case 'strike':
      return <s>{child}</s>;
    case 'code':
      return <code>{child}</code>;
    case 'link': {
      const href = safeHref(m.attrs?.href);
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
          {child}
        </a>
      ) : (
        child
      );
    }
    default:
      return child;
  }
}

function block(n: PMNode, key: number): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{inline(n.content)}</p>;
    case 'heading':
      return (
        <h3 key={key} className="display mb-3 mt-6 text-[1.25em] leading-snug">
          {inline(n.content)}
        </h3>
      );
    case 'bulletList':
      return (
        <ul key={key} className="mb-[1em] list-disc pl-6">
          {(n.content ?? []).map((c, i) => block(c, i))}
        </ul>
      );
    case 'orderedList':
      return (
        <ol key={key} className="mb-[1em] list-decimal pl-6">
          {(n.content ?? []).map((c, i) => block(c, i))}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{(n.content ?? []).map((c, i) => (c.type === 'paragraph' ? <Fragment key={i}>{inline(c.content)}</Fragment> : block(c, i)))}</li>;
    case 'blockquote':
      return (
        <blockquote key={key} className="mb-[1em] border-l-2 border-[var(--color-accent-line)] pl-4 italic text-[var(--color-muted)]">
          {(n.content ?? []).map((c, i) => block(c, i))}
        </blockquote>
      );
    case 'horizontalRule':
      return <hr key={key} className="rule my-6" />;
    default:
      // Unknown block: keep its words rather than dropping them.
      return n.content ? <p key={key}>{inline(n.content)}</p> : null;
  }
}
