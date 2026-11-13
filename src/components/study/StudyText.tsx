/**
 * Safe renderer for lesson text: **bold**, *italic*, \( inline TeX \) and line
 * breaks. Everything else renders as plain text. KaTeX output includes MathML so
 * screen readers can read equations; KaTeX escapes its input and trust is off.
 */
import katex from "katex";
import { Fragment } from "react";

export function texHtml(src: string, display: boolean) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", output: "htmlAndMathml" });
  } catch {
    return null;
  }
}

const TOKEN = /\\\(([\s\S]+?)\\\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;

export function StudyText({ md, className }: { md: string | null | undefined; className?: string }) {
  if (!md) return null;
  const lines = md.split("\n");
  return (
    <span className={className}>
      {lines.map((line, li) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        for (const m of line.matchAll(TOKEN)) {
          if (m.index! > last) parts.push(<Fragment key={`t${last}`}>{line.slice(last, m.index)}</Fragment>);
          if (m[1] !== undefined) {
            const html = texHtml(m[1].trim(), false);
            parts.push(html ? <span key={`m${m.index}`} dangerouslySetInnerHTML={{ __html: html }} />
                            : <code key={`m${m.index}`}>{m[1]}</code>);
          } else if (m[2] !== undefined) parts.push(<strong key={`b${m.index}`} className="font-semibold">{m[2]}</strong>);
          else parts.push(<em key={`i${m.index}`}>{m[3]}</em>);
          last = m.index! + m[0].length;
        }
        if (last < line.length) parts.push(<Fragment key={`t${last}`}>{line.slice(last)}</Fragment>);
        return <Fragment key={li}>{li > 0 && <br />}{parts}</Fragment>;
      })}
    </span>
  );
}

/** Display equation. KaTeX's MathML is what assistive technology reads; Blocks adds a plain-language description. */
export function TexBlock({ tex }: { tex: string }) {
  const html = texHtml(tex, true);
  if (!html) return <p className="font-mono text-body-sm">{tex}</p>;
  return <div className="overflow-x-auto overflow-y-hidden py-1" tabIndex={0} role="group" aria-label="Equation" dangerouslySetInnerHTML={{ __html: html }} />;
}
