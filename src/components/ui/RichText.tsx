/**
 * Plain question text with optional TeX formulas.
 *
 *   $$ … $$   display formula (its own line)
 *   \( … \)   inline formula
 *
 * Everything else is shown as typed (newlines kept). Formulas are rendered by
 * KaTeX to static HTML on whichever side renders the component; KaTeX escapes
 * its input and `trust` stays off, so a formula cannot inject markup. A formula
 * KaTeX cannot parse is shown as its source text rather than breaking the page.
 */
import katex from "katex";
import { Fragment } from "react";

const TOKEN = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)/g;

function tex(src: string, display: boolean) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", output: "html" });
  } catch {
    return null;
  }
}

export function hasMath(text: string | null | undefined) {
  return !!text && /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)/.test(text);
}

export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  if (!hasMath(text)) return <span className={className}>{text}</span>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, m.index)}</Fragment>);
    const display = m[1] !== undefined;
    const src = (m[1] ?? m[2]).trim();
    const html = tex(src, display);
    parts.push(html
      ? <span key={`m${m.index}`} className={display ? "my-2 block overflow-x-auto overflow-y-hidden" : undefined}
              dangerouslySetInnerHTML={{ __html: html }} />
      : <code key={`m${m.index}`} className="font-mono text-[0.9em]">{src}</code>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <span className={className}>{parts}</span>;
}
