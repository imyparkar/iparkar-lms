"use client";
/**
 * On-screen TI-30XS MultiView, modelled on the calculator Pearson VUE shows
 * during BCSP exams: same 41-key layout and 2nd functions, a 4-line LCD with
 * scrollable history (▲/▼ then enter pastes a line), the (−) negation key,
 * prb / angle / mode menus, sto→ with the seven memory variables, and the
 * ⟷ answer toggle (fraction ↔ decimal).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CalcError, evaluate, formatFraction, formatNumber, VARIABLES, type AngleMode } from "@/lib/calculator/engine";

type View = "dec" | "frac" | "mixed";
type Entry = { units: string[]; value: number; pct: boolean; view: View; stored?: string };
type MenuKind = "prb" | "angle" | "mode" | "recall" | "notice";
type Menu = { kind: MenuKind; idx: number; text?: string[] };

const ERROR_TEXT: Record<CalcError["kind"], string> = {
  SYNTAX: "SYNTAX ERROR",
  DOMAIN: "DOMAIN ERROR",
  DIVIDE_BY_ZERO: "DIVIDE BY 0",
  OVERFLOW: "OVERFLOW",
};

const LCD_WIDTH = 16; // the real screen shows 16 characters per line

/** Keys that start from Ans when pressed on an empty line (TI behaviour). */
const NEEDS_LEFT = new Set(["+", "−", "×", "÷", "^", "²", "⁻¹", "!", "nPr", "nCr", "ˣ√", "→", "▸%", "%", "°", "ʳ"]);

const SHOW: Record<string, string> = { "⁄": "/", nPr: " nPr ", nCr: " nCr " };
const show = (u: string) => SHOW[u] ?? u;

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
/** "6.02E23" → "6.02×10²³", "-5" → "⁻5" (the TI shows negatives with a raised minus). */
function lcdNumber(s: string) {
  const [m, e] = s.split("E");
  const mant = m.replace(/^-/, "⁻");
  return e === undefined ? mant : `${mant}×10${[...e].map((c) => SUP[c] ?? c).join("")}`;
}

function resultText(e: Entry) {
  if (e.pct) return `${lcdNumber(formatNumber(e.value * 100))}%`;
  if (e.view !== "dec") {
    const f = formatFraction(e.value, e.view === "mixed");
    if (f) return f.replace(/^-/, "⁻");
  }
  return lcdNumber(formatNumber(e.value));
}

/* ---------- keypad ---------- */

type Tone = "fn" | "num" | "op" | "second";
type KeyDef = { id: string; label: string; second?: string; tone: Tone; aria: string };

const ROWS: KeyDef[][] = [
  [
    { id: "2nd", label: "2nd", tone: "second", aria: "2nd" },
    { id: "mode", label: "mode", second: "quit", tone: "fn", aria: "mode" },
    { id: "delete", label: "delete", second: "insert", tone: "fn", aria: "delete" },
  ],
  [
    { id: "log", label: "log", second: "10ˣ", tone: "fn", aria: "log" },
    { id: "prb", label: "prb", second: "angle", tone: "fn", aria: "probability menu" },
    { id: "data", label: "data", second: "stat", tone: "fn", aria: "data" },
  ],
  [
    { id: "ln", label: "ln", second: "eˣ", tone: "fn", aria: "natural log" },
    { id: "nd", label: "n/d", second: "Uⁿ/d", tone: "fn", aria: "fraction" },
    { id: "toggle", label: "⟷", second: "f◂▸d", tone: "fn", aria: "answer toggle" },
    { id: "table", label: "table", tone: "fn", aria: "table" },
    { id: "clear", label: "clear", tone: "fn", aria: "clear" },
  ],
  [
    { id: "pi", label: "π", second: "hyp", tone: "fn", aria: "pi" },
    { id: "sin", label: "sin", second: "sin⁻¹", tone: "fn", aria: "sine" },
    { id: "cos", label: "cos", second: "cos⁻¹", tone: "fn", aria: "cosine" },
    { id: "tan", label: "tan", second: "tan⁻¹", tone: "fn", aria: "tangent" },
    { id: "pow", label: "^", second: "ˣ√", tone: "op", aria: "power" },
  ],
  [
    { id: "inv", label: "x⁻¹", tone: "fn", aria: "reciprocal" },
    { id: "x10", label: "×10ⁿ", tone: "fn", aria: "times ten to the power" },
    { id: "lp", label: "(", second: "%", tone: "fn", aria: "open parenthesis" },
    { id: "rp", label: ")", second: "▸%", tone: "fn", aria: "close parenthesis" },
    { id: "div", label: "÷", second: "K", tone: "op", aria: "divide" },
  ],
  [
    { id: "sq", label: "x²", second: "√", tone: "fn", aria: "square" },
    { id: "7", label: "7", tone: "num", aria: "7" },
    { id: "8", label: "8", tone: "num", aria: "8" },
    { id: "9", label: "9", tone: "num", aria: "9" },
    { id: "mul", label: "×", tone: "op", aria: "multiply" },
  ],
  [
    { id: "var", label: "x yzt abc", second: "clear var", tone: "fn", aria: "variables x y z t a b c" },
    { id: "4", label: "4", tone: "num", aria: "4" },
    { id: "5", label: "5", tone: "num", aria: "5" },
    { id: "6", label: "6", tone: "num", aria: "6" },
    { id: "sub", label: "−", tone: "op", aria: "subtract" },
  ],
  [
    { id: "sto", label: "sto→", second: "recall", tone: "fn", aria: "store" },
    { id: "1", label: "1", tone: "num", aria: "1" },
    { id: "2", label: "2", tone: "num", aria: "2" },
    { id: "3", label: "3", tone: "num", aria: "3" },
    { id: "add", label: "+", tone: "op", aria: "add" },
  ],
  [
    { id: "on", label: "on", second: "off", tone: "fn", aria: "on" },
    { id: "0", label: "0", second: "reset", tone: "num", aria: "0" },
    { id: "dot", label: ".", tone: "num", aria: "decimal point" },
    { id: "neg", label: "(−)", second: "ans", tone: "num", aria: "negative" },
    { id: "enter", label: "enter", tone: "op", aria: "enter" },
  ],
];

const TONE: Record<Tone, string> = {
  fn: "bg-gradient-to-b from-[#3d4046] to-[#22242a] text-white",
  op: "bg-gradient-to-b from-[#5a5e66] to-[#3b3e44] text-white",
  num: "bg-gradient-to-b from-white to-[#d8dade] text-[#16181c]",
  second: "bg-gradient-to-b from-[#7cc35c] to-[#4c9a35] text-white",
};

const MENU_ITEMS: Record<Exclude<MenuKind, "notice" | "mode" | "recall">, { head: string; items: { label: string; units: string[] }[] }> = {
  prb: { head: "PRB", items: [{ label: "nPr", units: ["nPr"] }, { label: "nCr", units: ["nCr"] }, { label: "!", units: ["!"] }] },
  angle: { head: "DMS", items: [{ label: "°", units: ["°"] }, { label: "r", units: ["ʳ"] }] },
};

/* ---------- component ---------- */

export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<Entry[]>([]);
  const [angle, setAngle] = useState<AngleMode>("DEG");
  const [second, setSecond] = useState(false);
  const [hyp, setHyp] = useState(false);
  const [ans, setAns] = useState(0);
  const [vars, setVars] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [sel, setSel] = useState<number | null>(null); // selected history line (▲/▼)
  const lastKey = useRef<string>("");
  const panel = useRef<HTMLDivElement>(null);

  // draggable on larger screens; null = default dock (bottom-right, above the exam footer)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    if (window.innerWidth < 640 || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const w = panel.current.offsetWidth, h = panel.current.offsetHeight;
    setPos({
      x: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - h - 8),
    });
  };
  const onDragEnd = () => { drag.current = null; };

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const historyLines = history.flatMap((e, i) => [
    { text: e.units.map(show).join(""), right: false, entry: i, units: e.units },
    { text: resultText(e), right: true, entry: i, units: null as string[] | null },
  ]);

  const insert = useCallback((units: string[]) => {
    setError(null);
    setSel(null);
    const add = input.length === 0 && NEEDS_LEFT.has(units[0]) && history.length ? ["Ans", ...units] : units;
    setInput([...input.slice(0, cursor), ...add, ...input.slice(cursor)]);
    setCursor(cursor + add.length);
  }, [input, cursor, history.length]);

  const evaluateLine = useCallback(() => {
    let units = [...input];
    if (!units.length) return;
    let pct = false;
    if (units[units.length - 1] === "▸%") { pct = true; units = units.slice(0, -1); }
    let target: string | undefined;
    const arrow = units.indexOf("→");
    try {
      if (arrow >= 0) {
        target = units[arrow + 1];
        if (!target || !VARIABLES.includes(target as (typeof VARIABLES)[number]) || arrow + 2 !== units.length) throw new CalcError("SYNTAX");
      }
      const exprUnits = arrow >= 0 ? units.slice(0, arrow) : units;
      const value = evaluate(exprUnits.join(""), { angle, ans, memory: 0, vars });
      const view: View = input.includes("⁄") && formatFraction(value) ? "frac" : "dec";
      if (target) setVars((v) => ({ ...v, [target!]: value }));
      setHistory((h) => [...h.slice(-29), { units: input, value, pct, view, stored: target }]);
      setAns(value);
      setInput([]);
      setCursor(0);
    } catch (e) {
      setError(e instanceof CalcError ? ERROR_TEXT[e.kind] : "ERROR");
    }
  }, [input, angle, ans, vars]);

  const chooseMenu = useCallback((m: Menu, idx: number) => {
    if (m.kind === "prb" || m.kind === "angle") {
      const item = MENU_ITEMS[m.kind].items[idx];
      if (!item) return;
      setMenu(null);
      insert(item.units);
    } else if (m.kind === "recall") {
      const v = VARIABLES[idx];
      if (!v) return;
      setMenu(null);
      insert([v]);
    } else if (m.kind === "mode") {
      setAngle(idx === 0 ? "DEG" : "RAD");
      setMenu(null);
    } else setMenu(null);
  }, [insert]);

  const notice = (text: string[]) => setMenu({ kind: "notice", idx: 0, text });

  const toggleLast = (mode: "frac" | "mixed") => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      if (last.pct || !formatFraction(last.value)) return h;
      const view: View = last.view === mode ? "dec" : mode;
      return [...h.slice(0, -1), { ...last, view }];
    });
  };

  const press = useCallback((id: string) => {
    const is2nd = second && id !== "2nd";
    if (id !== "2nd") setSecond(false);
    const prevKey = lastKey.current;
    lastKey.current = id;

    // menus capture navigation, digits, enter and clear
    if (menu) {
      if (menu.kind === "notice") { setMenu(null); return; }
      const count = menu.kind === "mode" ? 2 : menu.kind === "recall" ? VARIABLES.length : MENU_ITEMS[menu.kind].items.length;
      const horizontal = menu.kind === "mode";
      if ((id === "up" && !horizontal) || (id === "left" && horizontal)) { setMenu({ ...menu, idx: Math.max(0, menu.idx - 1) }); return; }
      if ((id === "down" && !horizontal) || (id === "right" && horizontal)) { setMenu({ ...menu, idx: Math.min(count - 1, menu.idx + 1) }); return; }
      if (id === "enter") { chooseMenu(menu, menu.idx); return; }
      if (/^[1-9]$/.test(id) && !horizontal) { chooseMenu(menu, Number(id) - 1); return; }
      if (id === "clear" || id === "mode" || id === "on" || id === "2nd") { if (id !== "2nd") setMenu(null); else setSecond((s) => !s); return; }
      return;
    }

    if (error && id !== "2nd") { setError(null); if (id === "clear" || id === "enter") return; }

    switch (id) {
      case "2nd": setSecond((s) => !s); return;
      case "mode": if (is2nd) { setSel(null); return; } setMenu({ kind: "mode", idx: angle === "DEG" ? 0 : 1 }); return;
      case "delete": {
        if (is2nd) return; // insert mode is always on here
        setSel(null);
        if (!input.length) return;
        const at = cursor < input.length ? cursor : cursor - 1;
        setInput(input.filter((_, i) => i !== at));
        setCursor(at);
        return;
      }
      case "log": insert([is2nd ? "10^(" : "log("]); return;
      case "ln": insert([is2nd ? "e^(" : "ln("]); return;
      case "prb": setMenu({ kind: is2nd ? "angle" : "prb", idx: 0 }); return;
      case "data": case "table": notice([is2nd ? "STAT" : id.toUpperCase(), "Not used in this", "exam simulator"]); return;
      case "nd": if (is2nd) toggleLast("mixed"); else insert(["⁄"]); return;
      case "toggle": toggleLast("frac"); return;
      case "clear":
        setSel(null);
        if (input.length) { setInput([]); setCursor(0); } else setHistory([]);
        return;
      case "pi": if (is2nd) setHyp((h) => !h); else insert(["π"]); return;
      case "sin": case "cos": case "tan":
        insert([`${id}${hyp ? "h" : ""}${is2nd ? "⁻¹" : ""}(`]);
        setHyp(false);
        return;
      case "pow": insert([is2nd ? "ˣ√" : "^"]); return;
      case "inv": insert(["⁻¹"]); return;
      case "x10": insert(["×10^"]); return;
      case "lp": insert([is2nd ? "%" : "("]); return;
      case "rp": insert([is2nd ? "▸%" : ")"]); return;
      case "div": if (is2nd) { notice(["K (constant)", "Not used in this", "exam simulator"]); return; } insert(["÷"]); return;
      case "mul": insert(["×"]); return;
      case "sub": insert(["−"]); return;
      case "add": insert(["+"]); return;
      case "sq": insert([is2nd ? "√(" : "²"]); return;
      case "var": {
        if (is2nd) { setVars({}); notice(["CLEAR VAR", "Variables x y z t", "a b c set to 0"]); return; }
        // repeated presses cycle x → y → z → t → a → b → c
        const prev = input[cursor - 1];
        if (prevKey === "var" && prev && VARIABLES.includes(prev as (typeof VARIABLES)[number])) {
          const nextVar = VARIABLES[(VARIABLES.indexOf(prev as (typeof VARIABLES)[number]) + 1) % VARIABLES.length];
          setInput([...input.slice(0, cursor - 1), nextVar, ...input.slice(cursor)]);
          return;
        }
        insert(["x"]);
        return;
      }
      case "sto": if (is2nd) setMenu({ kind: "recall", idx: 0 }); else insert(["→"]); return;
      case "on":
        if (is2nd) { onClose(); return; }
        setInput([]); setCursor(0); setSel(null); setHyp(false);
        return;
      case "0":
        if (is2nd) {
          setInput([]); setCursor(0); setHistory([]); setVars({}); setAns(0); setAngle("DEG"); setHyp(false); setSel(null);
          notice(["RESET", "Memory cleared"]);
          return;
        }
        insert(["0"]);
        return;
      case "dot": insert(["."]); return;
      case "neg": insert([is2nd ? "Ans" : "⁻"]); return;
      case "enter": {
        if (sel !== null) {
          const line = historyLines[sel];
          if (line) {
            // a result line pastes its value (negative sign becomes the (−) key)
            const units = line.units ?? [...formatNumber(history[line.entry].value)].map((c) => (c === "-" ? "⁻" : c));
            setSel(null);
            const next = [...input.slice(0, cursor), ...units, ...input.slice(cursor)];
            setInput(next);
            setCursor(cursor + units.length);
          }
          return;
        }
        evaluateLine();
        return;
      }
      case "up":
        if (!historyLines.length) return;
        if (is2nd) { setSel(0); return; }
        setSel((s) => (s === null ? historyLines.length - 1 : Math.max(0, s - 1)));
        return;
      case "down":
        if (sel === null) return;
        if (is2nd) { setSel(null); return; }
        setSel(sel + 1 >= historyLines.length ? null : sel + 1);
        return;
      case "left": setSel(null); setCursor(is2nd ? 0 : Math.max(0, cursor - 1)); return;
      case "right": setSel(null); setCursor(is2nd ? input.length : Math.min(input.length, cursor + 1)); return;
      default:
        if (/^[0-9]$/.test(id)) insert([id]);
    }
  }, [second, menu, error, input, cursor, angle, hyp, sel, history, historyLines, insert, evaluateLine, chooseMenu, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep exam shortcuts from firing while typing here
    const map: Record<string, string> = {
      Enter: "enter", "=": "enter", Backspace: "delete", Delete: "delete",
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      "+": "add", "-": "sub", "*": "mul", x: "mul", "/": "div", "^": "pow", "(": "lp", ")": "rp", ".": "dot",
    };
    if (e.key === "Escape") {
      e.preventDefault();
      if (menu || input.length || error) press("clear"); else onClose();
      return;
    }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); return; }
    if (e.key === "!") { e.preventDefault(); insert(["!"]); return; }
    if (e.key === "%") { e.preventDefault(); insert(["%"]); return; }
    if (map[e.key]) { e.preventDefault(); press(map[e.key]); }
  };

  /* ---------- LCD ---------- */

  const status = (
    <div className="flex h-[13px] items-center gap-2 text-[10px] font-bold leading-none tracking-tight">
      <span className={second ? "" : "invisible"}>2nd</span>
      <span>{angle}</span>
      {hyp && <span>HYP</span>}
    </div>
  );

  // input line: keep the cursor in a 16-character window
  const inputLine = (() => {
    if (error) return <span className="font-bold">{error}</span>;
    const parts = input.map(show);
    let start = cursor, used = 0;
    while (start > 0 && used + parts[start - 1].length <= LCD_WIDTH - 1) { used += parts[start - 1].length; start--; }
    let end = cursor;
    while (end < parts.length && used + parts[end].length <= LCD_WIDTH - (cursor === parts.length ? 1 : 0)) { used += parts[end].length; end++; }
    return (
      <>
        {start > 0 && <span className="absolute left-0 text-[11px]">◂</span>}
        {parts.slice(start, end).map((p, i) => {
          const at = start + i === cursor;
          return <span key={start + i} className={at && sel === null ? "ti-blink bg-[#1d2418] text-[#c3cbb0]" : ""}>{p}</span>;
        })}
        {cursor === parts.length && sel === null && <span className="ti-blink inline-block h-[17px] w-[9px] translate-y-[3px] bg-[#1d2418]" aria-hidden />}
        {end < parts.length && <span className="absolute right-0 text-[11px]">▸</span>}
      </>
    );
  })();

  let screen: React.ReactNode;
  if (menu) {
    if (menu.kind === "notice") {
      screen = menu.text!.map((t, i) => <div key={i} className={`h-[22px] truncate ${i === 0 ? "font-bold" : ""}`}>{t}</div>);
    } else if (menu.kind === "mode") {
      screen = (
        <>
          <div className="h-[22px]">
            {(["DEG", "RAD"] as const).map((m, i) => (
              <span key={m} className={`mr-3 px-0.5 ${i === menu.idx ? "bg-[#1d2418] text-[#c3cbb0]" : ""} ${angle === m ? "underline" : ""}`}>{m}</span>
            ))}
          </div>
          <div className="h-[22px] text-[13px] opacity-70">◂ ▸ then enter</div>
          <div className="h-[22px]" /><div className="h-[22px]" />
        </>
      );
    } else {
      const items = menu.kind === "recall"
        ? VARIABLES.map((v) => ({ label: `${v}=${lcdNumber(formatNumber(vars[v] ?? 0))}` }))
        : MENU_ITEMS[menu.kind].items;
      const head = menu.kind === "recall" ? "RECALL VAR" : MENU_ITEMS[menu.kind].head;
      const first = Math.min(Math.max(0, menu.idx - 2), Math.max(0, items.length - 3));
      screen = (
        <>
          <div className="h-[22px]"><span className="bg-[#1d2418] px-1 text-[#c3cbb0]">{head}</span></div>
          {items.slice(first, first + 3).map((it, i) => (
            <div key={first + i} className="h-[22px] truncate">
              <span className={first + i === menu.idx ? "bg-[#1d2418] text-[#c3cbb0]" : ""}>{first + i + 1}:</span>{it.label}
            </div>
          ))}
          {Array.from({ length: Math.max(0, 3 - items.length) }).map((_, i) => <div key={`pad${i}`} className="h-[22px]" />)}
        </>
      );
    }
  } else {
    const total = historyLines.length + 1;
    const start = sel === null ? Math.max(0, total - 4) : Math.min(sel, Math.max(0, total - 4));
    const rows = [];
    for (let i = start; i < Math.min(total, start + 4); i++) {
      if (i === historyLines.length) {
        rows.push(<div key="input" className="relative h-[22px] whitespace-nowrap px-[10px]" aria-label="Current entry">{inputLine}</div>);
      } else {
        const l = historyLines[i];
        rows.push(
          <div key={i} className={`h-[22px] truncate whitespace-nowrap ${l.right ? "text-right" : ""}`}>
            <span className={sel === i ? "bg-[#1d2418] text-[#c3cbb0]" : ""}>{l.text}</span>
          </div>,
        );
      }
    }
    while (rows.length < 4) rows.unshift(<div key={`blank${rows.length}`} className="h-[22px]" />);
    screen = rows;
  }

  /* ---------- render ---------- */

  const keyButton = (k: KeyDef) => (
    <div key={k.id} className="flex flex-col items-center">
      <span className="h-[12px] whitespace-nowrap text-[9px] font-semibold leading-[12px] text-[#86d26a]">{k.second ?? ""}</span>
      <button type="button" onClick={() => { press(k.id); panel.current?.focus(); }}
        aria-label={second && k.second ? k.second : k.aria}
        className={`h-[25px] w-full rounded-[7px] border border-black/60 shadow-[0_2px_0_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-transform active:translate-y-[1px] active:shadow-[0_1px_0_rgba(0,0,0,0.55)] ${TONE[k.tone]} ${k.label.length > 5 ? "text-[9.5px] leading-[10px]" : k.tone === "num" ? "text-[15px] font-semibold" : "text-[13px]"} ${k.id === "2nd" && second ? "ring-2 ring-[#b8f59c]" : ""}`}>
        {k.id === "var" ? <span className="leading-[9px]"><i className="font-serif text-[12px]">x</i><span className="text-[8px]"> yzt<br />abc</span></span> : k.label}
      </button>
    </div>
  );

  const arrow = (id: string, glyph: string, cls: string, label: string) => (
    <button type="button" aria-label={label} onClick={() => { press(id); panel.current?.focus(); }}
      className={`absolute flex items-center justify-center bg-gradient-to-b from-[#5a5e66] to-[#33363c] text-[11px] text-white shadow-[0_2px_0_rgba(0,0,0,0.55)] active:translate-y-[1px] ${cls}`}>
      {glyph}
    </button>
  );

  return (
    <div ref={panel} hidden={!open} tabIndex={-1} onKeyDown={onKeyDown} role="dialog" aria-modal="false" aria-label="TI-30XS MultiView calculator"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      className="fixed bottom-[65px] right-0 z-40 max-h-[calc(100vh-80px)] w-full overflow-y-auto rounded-t-[10px] border border-[#9aa0a8] bg-[#e6e8eb] shadow-mockup outline-none sm:bottom-[84px] sm:right-4 sm:w-[318px] sm:rounded-[10px]">
      {/* window title bar, like the Pearson VUE calculator window */}
      <div className="flex cursor-move select-none items-center justify-between border-b border-[#b9bec5] bg-gradient-to-b from-[#f7f8f9] to-[#dfe2e6] px-3 py-1.5 sm:cursor-grab"
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} title="Drag to move">
        <span className="text-[12px] font-semibold text-[#2b2f36]">Calculator</span>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} className="rounded p-0.5 text-[#2b2f36] hover:bg-black/10" aria-label="Hide calculator"><X size={15} aria-hidden /></button>
      </div>

      <div className="mx-auto max-w-[318px] p-2">
        <div className="rounded-[18px] border border-black bg-gradient-to-b from-[#3a3d43] via-[#26282d] to-[#1b1c20] px-3 pb-4 pt-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
          <div className="mb-1.5 flex items-baseline justify-between px-1">
            <span className="text-[8px] font-bold tracking-[0.12em] text-[#c9ccd1]">TEXAS INSTRUMENTS</span>
            <span className="text-[11px] font-semibold text-white">TI-30XS <span className="font-normal italic">MultiView</span><sup className="text-[6px]">™</sup></span>
          </div>

          {/* LCD */}
          <div className="rounded-[6px] border-[3px] border-[#101114] bg-[#0f1013] p-[5px]">
            <div className="rounded-[2px] bg-gradient-to-b from-[#c9d1b6] to-[#b9c2a5] px-[6px] pb-1 pt-0.5 font-mono text-[16px] leading-[22px] text-[#1d2418] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]" aria-live="polite">
              {status}
              {screen}
            </div>
          </div>

          {/* keypad: 9 rows × 5 columns, arrow pad in the top-right corner */}
          <div className="mt-3 grid grid-cols-5 gap-x-[7px] gap-y-[3px]">
            {ROWS[0].map(keyButton)}
            <div className="relative col-span-2 row-span-2">
              <div className="absolute inset-[4px] rounded-full bg-[#15161a] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]">
                {arrow("up", "▲", "left-[calc(50%-19px)] top-[3px] h-[22px] w-[38px] rounded-t-[14px] rounded-b-[4px]", "up")}
                {arrow("down", "▼", "bottom-[3px] left-[calc(50%-19px)] h-[22px] w-[38px] rounded-b-[14px] rounded-t-[4px]", "down")}
                {arrow("left", "◀", "left-[4px] top-[calc(50%-15px)] h-[30px] w-[34px] rounded-l-[14px] rounded-r-[4px]", "left")}
                {arrow("right", "▶", "right-[4px] top-[calc(50%-15px)] h-[30px] w-[34px] rounded-r-[14px] rounded-l-[4px]", "right")}
              </div>
            </div>
            {ROWS.slice(1).flatMap((r) => r.map(keyButton))}
          </div>
        </div>
        <p className="mt-1 px-1 text-[10px] leading-snug text-[#5b616b]">
          <b>2nd</b> = green labels · <b>▲</b> then <b>enter</b> reuses a line · <b>(−)</b> for negatives
        </p>
      </div>
    </div>
  );
}
