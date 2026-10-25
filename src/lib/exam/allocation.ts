/**
 * Largest-remainder allocation — a TypeScript mirror of the database
 * function public.allocate_question_counts (used for display only; the
 * database is authoritative when generating an exam).
 * Ties on remainder → higher weight first → lower domain number first.
 */
export function allocate(domains: { number: number; weight: number }[], total: number): number[] {
  const sum = domains.reduce((s, d) => s + d.weight, 0);
  if (!sum) return domains.map(() => 0);
  const rows = domains.map((d, i) => {
    const exact = (d.weight * total) / sum;
    return { i, base: Math.floor(exact), rem: exact - Math.floor(exact), weight: d.weight, number: d.number };
  });
  let left = total - rows.reduce((s, r) => s + r.base, 0);
  const order = [...rows].sort((a, b) => b.rem - a.rem || b.weight - a.weight || a.number - b.number);
  const out = rows.map((r) => r.base);
  for (const r of order) {
    if (left <= 0) break;
    out[r.i]++;
    left--;
  }
  return out;
}
