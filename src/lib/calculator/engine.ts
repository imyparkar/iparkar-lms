/**
 * Scientific calculator engine (inspired by multi-line school calculators).
 * A hand-written tokenizer + recursive-descent parser — never eval().
 *
 * Grammar (highest precedence last):
 *   expr    := term (('+' | '−') term)*
 *   term    := unary (('×' | '÷') unary | <implicit ×> unary)*
 *   unary   := '−' unary | power
 *   power   := postfix ('^' unary)?            right-associative
 *   postfix := primary ('!' | '²' | '³' | '⁻¹' | '%')*
 *   primary := number | 'π' | 'e' | 'Ans' | 'M' | func '(' args ')' | '(' expr ')'
 *
 * Notes: −2² = −4 (negation binds looser than powers); numbers accept
 * scientific notation with 'E' (e.g. 6.02E23); missing closing parentheses
 * at the end of the input are auto-closed.
 */

export type AngleMode = "DEG" | "RAD";

export class CalcError extends Error {
  constructor(public kind: "SYNTAX" | "DOMAIN" | "DIVIDE_BY_ZERO" | "OVERFLOW", message?: string) {
    super(message ?? kind);
  }
}

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "post"; v: "!" | "²" | "³" | "⁻¹" | "%" }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" }
  | { t: "const"; v: "pi" | "e" | "ans" | "mem" }
  | { t: "fn"; v: FnName; paren: boolean };

type FnName = "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "log" | "ln" | "sqrt" | "cbrt" | "abs" | "exp" | "root";

const FUNCS: Record<string, FnName> = {
  sin: "sin", cos: "cos", tan: "tan",
  asin: "asin", acos: "acos", atan: "atan",
  "sin⁻¹": "asin", "cos⁻¹": "acos", "tan⁻¹": "atan",
  log: "log", ln: "ln", sqrt: "sqrt", "√": "sqrt", cbrt: "cbrt", "∛": "cbrt",
  abs: "abs", exp: "exp", root: "root",
};
const FUNC_KEYS = Object.keys(FUNCS).sort((a, b) => b.length - a.length);

export function tokenize(src: string): Tok[] {
  const s = src.replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // number with optional decimal and E exponent
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(E[−-]?\d+)?/);
    if (num) {
      const literal = num[0].replace("−", "-");
      const v = Number(literal);
      if (!Number.isFinite(v)) throw new CalcError("OVERFLOW");
      out.push({ t: "num", v });
      i += num[0].length;
      continue;
    }
    const fn = FUNC_KEYS.find((k) => s.startsWith(k, i));
    if (fn) {
      i += fn.length;
      // "sin(30)" consumes its "(" into the token; "√9" / "sin30" is a bare call
      const paren = s[i] === "(";
      if (paren) i++;
      out.push({ t: "fn", v: FUNCS[fn], paren });
      continue;
    }
    if (s.startsWith("Ans", i)) { out.push({ t: "const", v: "ans" }); i += 3; continue; }
    if (s.startsWith("⁻¹", i)) { out.push({ t: "post", v: "⁻¹" }); i += 2; continue; }
    switch (ch) {
      case "+": out.push({ t: "op", v: "+" }); break;
      case "-": case "−": out.push({ t: "op", v: "-" }); break;
      case "*": case "×": case "·": out.push({ t: "op", v: "*" }); break;
      case "/": case "÷": out.push({ t: "op", v: "/" }); break;
      case "^": out.push({ t: "op", v: "^" }); break;
      case "!": case "²": case "³": case "%": out.push({ t: "post", v: ch }); break;
      case "(": out.push({ t: "lp" }); break;
      case ")": out.push({ t: "rp" }); break;
      case ",": out.push({ t: "comma" }); break;
      case "π": out.push({ t: "const", v: "pi" }); break;
      case "e": out.push({ t: "const", v: "e" }); break;
      case "M": out.push({ t: "const", v: "mem" }); break;
      default: throw new CalcError("SYNTAX", `Unexpected "${ch}"`);
    }
    i++;
  }
  return out;
}

export type EvalContext = { angle: AngleMode; ans: number; memory: number };

const FACT_LIMIT = 170;

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) throw new CalcError("DOMAIN", "n! needs a whole number ≥ 0");
  if (n > FACT_LIMIT) throw new CalcError("OVERFLOW");
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function cleanTrig(x: number): number {
  // remove floating noise such as cos(90°) = 6.1e-17
  return Math.abs(x) < 1e-12 ? 0 : x;
}

export function evaluate(src: string, ctx: EvalContext): number {
  const toks = tokenize(src);
  if (!toks.length) throw new CalcError("SYNTAX", "Empty expression");
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  const toRad = (x: number) => (ctx.angle === "DEG" ? (x * Math.PI) / 180 : x);
  const fromRad = (x: number) => (ctx.angle === "DEG" ? (x * 180) / Math.PI : x);

  const applyFn = (f: FnName, args: number[]): number => {
    const need = f === "root" ? 2 : 1;
    if (args.length !== need) throw new CalcError("SYNTAX", `${f} takes ${need} argument(s)`);
    const [x, y] = args;
    switch (f) {
      case "sin": return cleanTrig(Math.sin(toRad(x)));
      case "cos": return cleanTrig(Math.cos(toRad(x)));
      case "tan": {
        if (ctx.angle === "DEG" && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw new CalcError("DOMAIN", "tan undefined");
        return cleanTrig(Math.tan(toRad(x)));
      }
      case "asin": if (x < -1 || x > 1) throw new CalcError("DOMAIN"); return fromRad(Math.asin(x));
      case "acos": if (x < -1 || x > 1) throw new CalcError("DOMAIN"); return fromRad(Math.acos(x));
      case "atan": return fromRad(Math.atan(x));
      case "log": if (x <= 0) throw new CalcError("DOMAIN"); return Math.log10(x);
      case "ln": if (x <= 0) throw new CalcError("DOMAIN"); return Math.log(x);
      case "sqrt": if (x < 0) throw new CalcError("DOMAIN"); return Math.sqrt(x);
      case "cbrt": return Math.cbrt(x);
      case "abs": return Math.abs(x);
      case "exp": return Math.exp(x);
      case "root": {
        // root(x, n): the n-th root of x
        if (y === 0) throw new CalcError("DOMAIN");
        if (x < 0) {
          if (Number.isInteger(y) && Math.abs(y) % 2 === 1) return -Math.pow(-x, 1 / y);
          throw new CalcError("DOMAIN");
        }
        return Math.pow(x, 1 / y);
      }
    }
  };

  const startsPrimary = (t: Tok | undefined) =>
    !!t && (t.t === "num" || t.t === "const" || t.t === "fn" || t.t === "lp");

  function expr(): number {
    let v = term();
    for (;;) {
      const t = peek();
      if (!(t?.t === "op" && (t.v === "+" || t.v === "-"))) break;
      next();
      const op = t.v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function term(): number {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        next();
        const r = unary();
        if (t.v === "/") {
          if (r === 0) throw new CalcError("DIVIDE_BY_ZERO");
          v = v / r;
        } else v = v * r;
      } else if (startsPrimary(t)) {
        v = v * unary(); // implicit multiplication: 2π, 3(4), (2)(3)
      } else break;
    }
    return v;
  }

  function unary(): number {
    const t = peek();
    if (t?.t === "op" && t.v === "-") {
      next();
      return -unary();
    }
    if (t?.t === "op" && t.v === "+") {
      next();
      return unary();
    }
    return power();
  }

  function power(): number {
    const base = postfix();
    const t = peek();
    if (t?.t === "op" && t.v === "^") {
      next();
      const exp = unary();
      if (base === 0 && exp < 0) throw new CalcError("DIVIDE_BY_ZERO");
      if (base < 0 && !Number.isInteger(exp)) throw new CalcError("DOMAIN");
      return Math.pow(base, exp);
    }
    return base;
  }

  function postfix(): number {
    let v = primary();
    for (let t = peek(); t?.t === "post"; t = peek()) {
      next();
      const p = t.v;
      if (p === "!") v = factorial(v);
      else if (p === "²") v = v * v;
      else if (p === "³") v = v * v * v;
      else if (p === "%") v = v / 100;
      else {
        if (v === 0) throw new CalcError("DIVIDE_BY_ZERO");
        v = 1 / v;
      }
    }
    return v;
  }

  function primary(): number {
    const t = next();
    if (!t) throw new CalcError("SYNTAX", "Expression ends too early");
    switch (t.t) {
      case "num": return t.v;
      case "const":
        return t.v === "pi" ? Math.PI : t.v === "e" ? Math.E : t.v === "ans" ? ctx.ans : ctx.memory;
      case "lp": {
        const v = expr();
        if (peek()?.t === "rp") next();
        else if (peek() !== undefined) throw new CalcError("SYNTAX", "Missing )");
        return v;
      }
      case "fn": {
        if (!t.paren) return applyFn(t.v, [power()]);
        const args = [expr()];
        while (peek()?.t === "comma") {
          next();
          args.push(expr());
        }
        if (peek()?.t === "rp") next();
        else if (peek() !== undefined) throw new CalcError("SYNTAX", "Missing )");
        return applyFn(t.v, args);
      }
      default:
        throw new CalcError("SYNTAX", "Unexpected symbol");
    }
  }

  const value = expr();
  if (pos < toks.length) throw new CalcError("SYNTAX", "Unexpected input");
  if (!Number.isFinite(value)) throw new CalcError("OVERFLOW");
  if (Math.abs(value) >= 1e100) throw new CalcError("OVERFLOW");
  return value;
}

/** Display a result: up to 10 significant digits, scientific when very large/small. */
export function formatNumber(x: number): string {
  if (x === 0 || Object.is(x, -0)) return "0";
  const ax = Math.abs(x);
  if (ax >= 1e10 || ax < 1e-9) {
    const [m, e] = x.toExponential(9).split("e");
    return `${trimZeros(m)}E${Number(e)}`;
  }
  const s = Number(x.toPrecision(10)).toString();
  return s.includes("e") ? formatNumber(Number(s)) : s;
}

function trimZeros(m: string) {
  return m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
}

/** Best rational approximation via continued fractions. */
export function toFraction(x: number, maxDen = 10000): { num: number; den: number } | null {
  if (!Number.isFinite(x)) return null;
  const sign = Math.sign(x) || 1;
  let v = Math.abs(x);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(Math.abs(x) - h1 / k1) < 1e-10) break;
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  if (k1 === 0 || Math.abs(Math.abs(x) - h1 / k1) > 1e-9) return null;
  return { num: sign * h1, den: k1 };
}

export function formatFraction(x: number, mixed = false): string | null {
  const f = toFraction(x);
  if (!f || f.den === 1) return null;
  if (!mixed || Math.abs(f.num) < f.den) return `${f.num}/${f.den}`;
  const whole = Math.trunc(f.num / f.den);
  const rest = Math.abs(f.num % f.den);
  return `${whole} ${rest}/${f.den}`;
}
