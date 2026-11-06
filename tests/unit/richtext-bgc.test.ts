import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText, hasMath } from "../../src/components/ui/RichText";
import { parseCsvItemBank } from "../../src/lib/import/itemBank";
import { courseUi } from "../../src/lib/courses";

const html = (t: string) => renderToStaticMarkup(createElement(RichText, { text: t }));

describe("RichText", () => {
  it("leaves plain text alone and escapes it", () => {
    expect(hasMath("C = 5 mg/L, cost $40")).toBe(false);
    expect(html("a < b & c")).toBe("<span>a &lt; b &amp; c</span>");
  });
  it("renders $$…$$ display maths and \\(…\\) inline maths with KaTeX", () => {
    const out = html("Hint:\n$$R = \\frac{g(P) - D}{g(P) - B} \\times 100$$ done \\(x^2\\)");
    expect(out).toContain('class="katex-display"');
    expect(out).toContain("mfrac");
    expect(out).toContain("Hint:");
    expect(out).toContain("done");
  });
  it("falls back to source text for TeX that does not parse, and never injects markup", () => {
    expect(html("$$\\frac{1}{$$")).toContain("<code");
    expect(html("$$\\href{javascript:alert(1)}{x}$$")).not.toContain("javascript:");
  });
});

describe("BGC topic codes", () => {
  it("imports blueprint topic numbers with a dot as domain codes", () => {
    const csv = 'external_ref,domain_code,stem,option_a,option_b,key,explanation\nGES-1.1-001,1.1,"A stem long enough?",x,y,A,"why $$a=b$$"\n';
    const r = parseCsvItemBank(csv);
    expect(r.issues).toEqual([]);
    expect(r.items[0].domain_code).toBe("1.1");
  });
  it("labels EPI and QEP by topic and offers the equation sheet", () => {
    expect(courseUi("EPI")).toMatchObject({ label: "GES/EPI", unit: "topic", referenceSheet: "bgc-qep-ges" });
    expect(courseUi("qep").unit).toBe("topic");
    expect(courseUi("ASP")).toEqual({ label: "ASP", unit: "domain" });
  });
});
