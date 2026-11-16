/**
 * Allow-list check for redrawn course figures (inline SVG). Figures are authored by iParkar and
 * imported by an administrator, but they are rendered as markup, so both the importer (schema) and
 * the player check them: only drawing elements and presentation attributes, no scripts, event
 * handlers, links, foreign content, external references, entities or CSS beyond one fixed style.
 */
const ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc",
]);
const ATTRIBUTES = new Set([
  "xmlns", "viewBox", "role", "aria-label", "aria-hidden", "font-family", "style", "width", "height", "x", "y", "dx", "dy",
  "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-opacity", "fill-rule", "stroke",
  "stroke-width", "stroke-dasharray", "stroke-linejoin", "stroke-linecap", "stroke-opacity", "opacity", "transform",
  "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "paint-order", "letter-spacing",
]);
const STYLE = "width:100%;height:auto;display:block";
const VALUE_BLOCK = /url\s*\(|javascript:|data:|expression\s*\(|[<>]|&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-f]+;)/i;

export function isSafeSvg(src: string): boolean {
  if (typeof src !== "string" || src.length > 80_000) return false;
  const s = src.trim();
  if (!/^<svg[\s>]/.test(s) || !/<\/svg>$/.test(s)) return false;
  if (/<!|<\?|\]\]>/.test(s)) return false;
  // text between tags may not contain stray markup or unknown entities
  const tagRe = /<\/?([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let depth = 0;
  while ((m = tagRe.exec(s))) {
    const between = s.slice(last, m.index);
    if (/[<>]/.test(between) || /&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-f]+;)/i.test(between)) return false;
    const name = m[1];
    if (!ELEMENTS.has(name)) return false;
    const attrs = m[2];
    const attrRe = /\s+([\w:-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    let consumed = 0;
    while ((a = attrRe.exec(attrs))) {
      consumed += a[0].length;
      const [, key, value] = a;
      if (!ATTRIBUTES.has(key)) return false;
      if (key === "style" && value !== STYLE) return false;
      if (VALUE_BLOCK.test(value)) return false;
    }
    if (consumed !== attrs.length) return false;
    const closing = m[0].startsWith("</");
    if (closing) depth -= 1;
    else if (!m[3]) depth += 1;
    if (depth < 0) return false;
    last = tagRe.lastIndex;
  }
  return last === s.length && depth === 0;
}
