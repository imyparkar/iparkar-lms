"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CalcError, evaluate, formatFraction, formatNumber, type AngleMode } from "@/lib/calculator/engine";

type Entry = { expr: string; result: string; value: number | null };
type View = "dec" | "frac" | "mixed";

const ERROR_TEXT: Record<CalcError["kind"], string> = {
  SYNTAX: "SYNTAX ERROR",
  DOMAIN: "DOMAIN ERROR",
  DIVIDE_BY_ZERO: "DIVIDE BY 0",
  OVERFLOW: "OVERFLOW",
};

type Key = { label: string; second?: string; insert?: string; insert2?: string; action?: string; tone?: "num" | "op" | "fn" | "act" | "eq"; aria?: string };

const KEYS: Key[] = [
  { label: "2nd", action: "second", tone: "act" },
  { label: "DEG", action: "angle", tone: "act", aria: "Toggle degrees or radians" },
  { label: "F◂▸D", action: "fd", tone: "act", aria: "Toggle fraction or decimal" },
  { label: "DEL", action: "del", tone: "act", aria: "Delete" },
  { label: "CLEAR", action: "clear", tone: "act" },

  { label: "x²", second: "x³", insert: "²", insert2: "³", tone: "fn", aria: "Square" },
  { label: "√", second: "∛", insert: "√(", insert2: "∛(", tone: "fn", aria: "Square root" },
  { label: "^", insert: "^", tone: "fn", aria: "Power" },
  { label: "x⁻¹", insert: "⁻¹", tone: "fn", aria: "Reciprocal" },
  { label: "π", second: "e", insert: "π", insert2: "e", tone: "fn" },

  { label: "sin", second: "sin⁻¹", insert: "sin(", insert2: "sin⁻¹(", tone: "fn" },
  { label: "cos", second: "cos⁻¹", insert: "cos(", insert2: "cos⁻¹(", tone: "fn" },
  { label: "tan", second: "tan⁻¹", insert: "tan(", insert2: "tan⁻¹(", tone: "fn" },
  { label: "log", second: "10ˣ", insert: "log(", insert2: "10^(", tone: "fn" },
  { label: "ln", second: "eˣ", insert: "ln(", insert2: "exp(", tone: "fn" },

  { label: "(", insert: "(", tone: "fn" },
  { label: ")", insert: ")", tone: "fn" },
  { label: "x!", insert: "!", tone: "fn", aria: "Factorial" },
  { label: "|x|", insert: "abs(", tone: "fn", aria: "Absolute value" },
  { label: "ⁿ√", insert: "root(", tone: "fn", aria: "nth root: root(x, n)" },

  { label: "7", insert: "7", tone: "num" }, { label: "8", insert: "8", tone: "num" }, { label: "9", insert: "9", tone: "num" },
  { label: "÷", insert: "÷", tone: "op", aria: "Divide" }, { label: "EE", insert: "E", tone: "fn", aria: "Times ten to the power" },

  { label: "4", insert: "4", tone: "num" }, { label: "5", insert: "5", tone: "num" }, { label: "6", insert: "6", tone: "num" },
  { label: "×", insert: "×", tone: "op", aria: "Multiply" }, { label: "%", insert: "%", tone: "fn", aria: "Percent" },

  { label: "1", insert: "1", tone: "num" }, { label: "2", insert: "2", tone: "num" }, { label: "3", insert: "3", tone: "num" },
  { label: "−", insert: "−", tone: "op", aria: "Subtract" }, { label: ",", insert: ",", tone: "fn", aria: "Comma" },

  { label: "0", insert: "0", tone: "num" }, { label: ".", insert: ".", tone: "num", aria: "Decimal point" },
  { label: "(−)", insert: "−", tone: "num", aria: "Negative" }, { label: "+", insert: "+", tone: "op", aria: "Add" },
  { label: "enter", action: "enter", tone: "eq", aria: "Equals" },

  { label: "MC", action: "mc", tone: "act", aria: "Memory clear" },
  { label: "MR", insert: "M", tone: "act", aria: "Memory recall" },
  { label: "M+", action: "mplus", tone: "act", aria: "Add result to memory" },
  { label: "M−", action: "mminus", tone: "act", aria: "Subtract result from memory" },
  { label: "Ans", insert: "Ans", tone: "act", aria: "Last answer" },
];

const TONE = {
  num: "bg-white text-ink border border-hairline hover:bg-paper",
  op: "bg-sky-tint text-ink hover:bg-[#d4e9fc]",
  fn: "bg-paper text-ink hover:bg-[#ecebea]",
  act: "bg-[#ecebea] text-ink hover:bg-[#e2e1e0]",
  eq: "bg-action text-white hover:bg-[#0067c4]",
} as const;

const BINARY = ["+", "−", "×", "÷", "^"];

export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [angle, setAngle] = useState<AngleMode>("DEG");
  const [second, setSecond] = useState(false);
  const [ans, setAns] = useState(0);
  const [memory, setMemory] = useState(0);
  const [view, setView] = useState<View>("dec");
  const [error, setError] = useState<string | null>(null);
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
      y: Math.min(Math.max(72, e.clientY - drag.current.dy), window.innerHeight - h - 8),
    });
  };
  const onDragEnd = () => { drag.current = null; };
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight });
  }, [history, input]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const insert = useCallback((text: string) => {
    setError(null);
    setInput((cur) => (cur === "" && BINARY.includes(text) && text !== "−" ? "Ans" + text : cur + text));
  }, []);

  const lastValue = history.length ? history[history.length - 1].value : null;

  const run = useCallback((action: string) => {
    setError(null);
    switch (action) {
      case "second": setSecond((s) => !s); return;
      case "angle": setAngle((a) => (a === "DEG" ? "RAD" : "DEG")); return;
      case "del": setInput((c) => (c.endsWith("Ans") ? c.slice(0, -3) : c.endsWith("⁻¹") ? c.slice(0, -2) : c.slice(0, -1))); return;
      case "clear": setInput((c) => { if (c === "") setHistory([]); return ""; }); return;
      case "fd": setView((v) => (v === "dec" ? "frac" : v === "frac" ? "mixed" : "dec")); return;
      case "mc": setMemory(0); return;
      case "mplus": if (lastValue != null) setMemory((m) => m + lastValue); return;
      case "mminus": if (lastValue != null) setMemory((m) => m - lastValue); return;
      case "enter": {
        const expr = input.trim();
        if (!expr) return;
        try {
          const value = evaluate(expr, { angle, ans, memory });
          setHistory((h) => [...h.slice(-19), { expr, result: formatNumber(value), value }]);
          setAns(value);
          setInput("");
          setView("dec");
        } catch (e) {
          setError(e instanceof CalcError ? ERROR_TEXT[e.kind] : "ERROR");
        }
        return;
      }
    }
  }, [input, angle, ans, memory, lastValue]);

  const press = (k: Key) => {
    if (k.action) run(k.action);
    else insert(second && k.insert2 ? k.insert2 : k.insert!);
    if (k.action !== "second") setSecond(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep exam shortcuts from firing while typing here
    const map: Record<string, string> = { "*": "×", "/": "÷", "-": "−", x: "×" };
    if (e.key === "Enter" || e.key === "=") { e.preventDefault(); run("enter"); }
    else if (e.key === "Backspace") { e.preventDefault(); run("del"); }
    else if (e.key === "Escape") { e.preventDefault(); if (input) run("clear"); else onClose(); }
    else if (/^[0-9.()+^!%,]$/.test(e.key)) { e.preventDefault(); insert(e.key); }
    else if (map[e.key]) { e.preventDefault(); insert(map[e.key]); }
  };

  const shown = (entry: Entry, i: number) => {
    if (i !== history.length - 1 || entry.value == null || view === "dec") return entry.result;
    return formatFraction(entry.value, view === "mixed") ?? entry.result;
  };

  return (
    <div ref={panel} hidden={!open} tabIndex={-1} onKeyDown={onKeyDown} role="dialog" aria-modal="false" aria-label="Scientific calculator"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      className="fixed bottom-[65px] right-0 z-40 max-h-[calc(100vh-140px)] w-full overflow-y-auto rounded-t-card border border-hairline bg-white p-3 shadow-mockup outline-none sm:bottom-[84px] sm:right-4 sm:w-[320px] sm:rounded-card">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex-1 cursor-move select-none text-caption text-slate sm:cursor-grab" onPointerDown={onDragStart} onPointerMove={onDragMove}
           onPointerUp={onDragEnd} onPointerCancel={onDragEnd} title="Drag to move">Scientific calculator <span className="hidden sm:inline">· drag to move</span></p>
        <button type="button" onClick={onClose} className="btn-text px-2 py-1" aria-label="Hide calculator"><X size={16} aria-hidden /></button>
      </div>
      <div className="rounded-button bg-[#e9efe6] px-3 py-2 font-mono text-ink">
        <div className="flex justify-between text-[11px] text-graphite">
          <span>{angle}{second ? " · 2nd" : ""}</span>
          <span>{memory !== 0 ? `M = ${formatNumber(memory)}` : ""}</span>
        </div>
        <div ref={historyRef} className="h-20 overflow-y-auto text-[13px]" aria-live="polite">
          {history.map((h, i) => (
            <div key={i} className="py-0.5">
              <div className="truncate text-graphite">{h.expr}</div>
              <div className="text-right font-semibold">{shown(h, i)}</div>
            </div>
          ))}
        </div>
        <div className="mt-1 min-h-[24px] break-all border-t border-ink-20 pt-1 text-[16px]" aria-label="Current entry">
          {error ? <span className="font-semibold text-vermillion">{error}</span> : input || <span className="text-ink-40">0</span>}
          <span className="ml-0.5 inline-block w-[1px] animate-pulse bg-ink align-middle" style={{ height: 16 }} aria-hidden />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {KEYS.map((k) => (
          <button key={k.label} type="button" onClick={() => press(k)} aria-label={second && k.second ? k.second : k.aria ?? k.label}
            className={`relative h-9 rounded-small text-[13px] font-medium transition-colors duration-150 ${TONE[k.tone ?? "num"]} ${k.action === "second" && second ? "ring-2 ring-midnight" : ""}`}>
            {k.label === "DEG" ? angle : second && k.second ? k.second : k.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate">n-th root: ⁿ√ then “x , n )”. Keyboard works while this panel is focused.</p>
    </div>
  );
}
