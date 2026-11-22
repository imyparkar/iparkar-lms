import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DragDrop, Hotspot, Matching, MultipleResponse, Pulldown, defaultInstructions, hasResponse, isInteractive,
         normalise, pulldownStem } from "../../src/components/exam/ItemInteractions";
import { convertRecord, payloadChunks, type BankRecord } from "../../src/lib/import/pmpBank";
import type { AttemptQuestion } from "../../src/lib/types";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>`;
const base: AttemptQuestion = { position: 1, question_id: "q1", stem: "Stem?", options: [], selected_option_id: null, flagged: false, locked: false, feedback: null };
const exhibit = { ref: "EX-1", title: "Exhibit", svg: SVG, alt: "A chart", width: 100, height: 50,
                  data_table: { headers: ["Row", "Value"], rows: [["a", "1"]] } };
const noop = () => {};
const html = (el: unknown) => renderToStaticMarkup(el as React.ReactElement);

describe("response helpers", () => {
  it("treats empty responses as unanswered and strips empty parts", () => {
    expect(hasResponse(null)).toBe(false);
    expect(hasResponse({ selected: [] })).toBe(false);
    expect(hasResponse({ pairs: { L1: "" } })).toBe(false);
    expect(hasResponse({ placements: { D1: "t1" } })).toBe(true);
    expect(normalise({ pairs: { L1: "", L2: "R1" } })).toEqual({ pairs: { L2: "R1" } });
    expect(normalise({ regions: [] })).toBeNull();
  });
  it("classifies item types", () => {
    expect(isInteractive({ type: undefined })).toBe(false);
    expect(isInteractive({ type: "pulldown" })).toBe(false);
    expect(isInteractive({ type: "hotspot" })).toBe(true);
    expect(defaultInstructions({ ...base, type: "multiple_response", interaction: { type: "multiple_response", select_count: 2 } })).toBe("Select 2 answers.");
    expect(pulldownStem("It is a(n) [[F1]].", null)).toBe("It is a(n) ______.");
    expect(pulldownStem("It is a(n) [[F1]].", "impediment")).toBe("It is a(n) [ impediment ].");
  });
});

describe("interaction renderers", () => {
  it("multiple response uses checkboxes and shows the selection count", () => {
    const q = { ...base, type: "multiple_response" as const, interaction: { type: "multiple_response" as const, select_count: 2 },
                options: ["a", "b", "c"].map((id) => ({ id, body: `Opt ${id}` })) };
    const out = html(createElement(MultipleResponse, { q, value: { selected: ["b"] }, onChange: noop, disabled: false }));
    expect(out.match(/type="checkbox"/g)).toHaveLength(3);
    expect(out).toContain("1 of 2 selected");
  });

  it("pull-down is a labelled select with every option", () => {
    const q = { ...base, type: "pulldown" as const, options: [{ id: "a", body: "risk" }, { id: "b", body: "issue" }] };
    const out = html(createElement(Pulldown, { q, selected: "b", onChoose: noop, disabled: false }));
    expect(out).toMatch(/<label for="[^"]+"/);
    expect(out).toContain("<option value=\"b\" selected=\"\">issue</option>");
  });

  it("matching gives every left item a select and disables options already used", () => {
    const q = { ...base, type: "matching" as const, interaction: { type: "matching" as const,
      left: [{ id: "L1", text: "One" }, { id: "L2", text: "Two" }], right: [{ id: "R1", text: "Uno" }, { id: "R2", text: "Dos" }, { id: "R3", text: "Tres" }],
      options_reusable: false } };
    const out = html(createElement(Matching, { q, value: { pairs: { L1: "R2" } }, onChange: noop, disabled: false }));
    expect(out.match(/<select/g)).toHaveLength(2);
    expect(out).toContain('<option value="R2" disabled="">Dos</option>');
    expect(out).toContain("Some options are not used.");
  });

  it("drag-and-drop renders the exhibit as an image, draggable chips and a select per item", () => {
    const q = { ...base, type: "enhanced_matching" as const, exhibits: [exhibit],
      interaction: { type: "enhanced_matching" as const, draggables: [{ id: "D1", label: "Risk A" }, { id: "D2", label: "Risk B" }],
        targets: [{ id: "t1", label: "High", coords: [0.1, 0.1, 0.3, 0.3] as [number, number, number, number] },
                  { id: "t2", label: "Low", coords: [0.5, 0.1, 0.3, 0.3] as [number, number, number, number] }], unplaced_allowed: true } };
    const out = html(createElement(DragDrop, { q, value: { placements: { D1: "t2" } }, onChange: noop, disabled: false }));
    expect(out).toContain('src="data:image/svg+xml');
    expect(out).not.toContain("<script");          // SVG never inlined into the page
    expect(out).toContain('draggable="true"');       // D2 still to place
    expect(out.match(/<select/g)).toHaveLength(2);   // keyboard equivalent
    expect(out).toContain("Not placed");
    expect(out).toContain("Text version of the exhibit");
  });

  it("hotspot regions are focusable toggle buttons with no correctness shown", () => {
    const q = { ...base, type: "hotspot" as const, exhibits: [exhibit],
      interaction: { type: "hotspot" as const, select_count: 1, regions: [
        { id: "r1", label: "Row 1", coords: [0, 0, 1, 0.5] as [number, number, number, number] },
        { id: "r2", label: "Row 2", coords: [0, 0.5, 1, 0.5] as [number, number, number, number] }] } };
    const out = html(createElement(Hotspot, { q, value: { regions: ["r2"] }, onChange: noop, disabled: false }));
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Select area: Row 1"');
    expect(out).not.toMatch(/correct/i);
  });
});

describe("PMP bank conversion", () => {
  const rec = (over: Partial<BankRecord>): BankRecord => ({
    item_id: "PMP26-0001", domain: "Process", eco_task: "II.10", response_mode: "single", difficulty: "Hard",
    case_id: null, case_seq: null, exhibit_ids: [], stem: "Stem?", options: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
    answer_key: ["B"], rationale: "Because.", references: [{ citation: "PMBOK 8, §1", verified: true }, { citation: "X", verified: false }],
    approach: "Predictive", ...over,
  });
  it("maps domains, ECO task codes, keys and difficulty", () => {
    const s = convertRecord(rec({}));
    expect(s).toMatchObject({ domain_code: "D2", task_code: "II-10", question_type: "single_best_answer", key: "B", difficulty: 70, topic: "Predictive" });
    expect(s.reference).toBe("PMBOK 8, §1; X (to be verified)");
    const m = convertRecord(rec({ response_mode: "multiple", answer_key: ["A", "B"], select_count: 2 }));
    expect(m).toMatchObject({ question_type: "multiple_response", answer_key: ["A", "B"], interaction: { select_count: 2 } });
    const p = convertRecord(rec({ response_mode: "pulldown", answer_key: { F1: "A" } }));
    expect(p.key).toBe("A");
    const h = convertRecord(rec({ response_mode: "hotspot", options: undefined, answer_key: ["row-2"], interaction: { type: "hotspot", regions: [] } }));
    expect(h.options).toBeUndefined();
    expect(h.answer_key).toEqual(["row-2"]);
  });
  it("sends exhibits and cases before items", () => {
    const parts = payloadChunks({ exhibits: [{ ref: "E", svg: "<svg/>", alt_text: "x" }], cases: [], items: Array(120).fill(convertRecord(rec({}))) }, 50);
    expect(parts.map((p) => [p.exhibits.length, p.items.length])).toEqual([[1, 0], [0, 0], [0, 50], [0, 50], [0, 20]]);
  });
});
