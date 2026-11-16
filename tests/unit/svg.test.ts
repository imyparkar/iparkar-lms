import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isSafeSvg } from "../../src/lib/study/svg";

const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="x" style="width:100%;height:auto;display:block"><rect x="0" y="0" width="5" height="5" fill="#0075de"/><text x="1" y="9" font-size="3">A &amp; B</text></svg>';

describe("figure SVG allow-list", () => {
  it("accepts plain drawing markup", () => expect(isSafeSvg(ok)).toBe(true));
  it.each([
    ["script", ok.replace("</svg>", "<script>alert(1)</script></svg>")],
    ["event handler", ok.replace('<rect ', '<rect onload="alert(1)" ')],
    ["foreignObject", ok.replace("</svg>", "<foreignObject><div>x</div></foreignObject></svg>")],
    ["link", ok.replace("</svg>", '<a href="https://x">x</a></svg>')],
    ["href on use", ok.replace("</svg>", '<use href="#a"/></svg>')],
    ["external image", ok.replace("</svg>", '<image href="https://x/y.png"/></svg>')],
    ["url() fill", ok.replace('fill="#0075de"', 'fill="url(https://x)"')],
    ["javascript value", ok.replace('fill="#0075de"', 'fill="javascript:alert(1)"')],
    ["other style", ok.replace("display:block", "background:url(x)")],
    ["style element", ok.replace("</svg>", "<style>*{}</style></svg>")],
    ["doctype/entity", "<!DOCTYPE svg [<!ENTITY a 'x'>]>" + ok],
    ["unknown entity", ok.replace("&amp;", "&a;")],
    ["unbalanced", ok.replace("</svg>", "<g></svg>")],
    ["unquoted attribute", ok.replace('x="0"', "x=0")],
    ["not svg", "<div></div>"],
  ])("rejects %s", (_, s) => expect(isSafeSvg(s)).toBe(false));

  const dir = join(import.meta.dirname, "../../imports/csp-sps/authoring/figures");
  it.skipIf(!existsSync(dir))("accepts every authored CSP figure", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".svg"))) expect(isSafeSvg(readFileSync(join(dir, f), "utf8")), f).toBe(true);
  });
});
