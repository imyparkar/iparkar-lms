"use client";
import { useMemo, useState } from "react";
import { chunk, parseItemBank, type ImportItem, type ParseResult } from "@/lib/import/itemBank";
import { importChunk } from "@/lib/admin/actions";
import { Alert } from "@/components/ui/Alert";

type Report = { accepted: number; created: number; rejected: { row: number; external_ref: string; errors: string[] }[] };

export function Importer({ courses }: { courses: { code: string; name: string; domains: string[] }[] }) {
  const [course, setCourse] = useState(courses[0]?.code ?? "ASP");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [status, setStatus] = useState<"draft" | "in_review" | "published">("draft");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const domains = courses.find((c) => c.code === course)?.domains ?? [];
  const byDomain = useMemo(() => {
    const m: Record<string, number> = {};
    parsed?.items.forEach((i) => (m[i.domain_code] = (m[i.domain_code] ?? 0) + 1));
    return m;
  }, [parsed]);
  const foreign = Object.keys(byDomain).filter((d) => !domains.includes(d));

  const onFile = async (f: File | undefined) => {
    setReport(null); setError(null); setParsed(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setError("Files up to 5 MB, please.");
    setFileName(f.name);
    setParsed(parseItemBank(f.name, await f.text()));
  };

  const run = async () => {
    if (!parsed?.items.length) return;
    setError(null);
    const parts = chunk<ImportItem>(parsed.items, 100);
    const rep: Report = { accepted: 0, created: 0, rejected: [] };
    setProgress({ done: 0, total: parsed.items.length });
    for (let i = 0; i < parts.length; i++) {
      const res = await importChunk(course, parts[i], status);
      if (!res.ok) { setError(res.error ?? "Import failed"); break; }
      const d = res.data as { accepted: { created: boolean }[]; rejected: { row: number; external_ref: string; errors: string[] }[] };
      rep.accepted += d.accepted.length;
      rep.created += d.accepted.filter((a) => a.created).length;
      rep.rejected.push(...d.rejected.map((r) => ({ ...r, row: r.row + i * 100 })));
      setProgress({ done: Math.min((i + 1) * 100, parsed.items.length), total: parsed.items.length });
    }
    setReport(rep);
  };

  const downloadRejected = () => {
    if (!report) return;
    const csv = ["row,external_ref,errors", ...report.rejected.map((r) => `${r.row},"${r.external_ref ?? ""}","${r.errors.join("; ").replace(/"/g, '""')}"`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `rejected-${course}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <section className="card grid gap-4 md:grid-cols-3">
        <div>
          <label className="field-label" htmlFor="course">Import into course</label>
          <select id="course" className="field-input" value={course} onChange={(e) => setCourse(e.target.value)}>
            {courses.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
          <p className="mt-1 text-caption text-graphite">The course comes from here, never from the file.</p>
        </div>
        <div>
          <label className="field-label" htmlFor="file">Item bank file (.md or .csv)</label>
          <input id="file" type="file" accept=".md,.markdown,.csv,text/markdown,text/csv" className="field-input py-2"
                 onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div>
          <label className="field-label" htmlFor="status">Import as</label>
          <select id="status" className="field-input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="draft">Draft (review later)</option>
            <option value="in_review">In review</option>
            <option value="published">Published (SME-reviewed content only)</option>
          </select>
        </div>
      </section>

      {error && <Alert tone="error">{error}</Alert>}

      {parsed && (
        <section className="card space-y-4">
          <h2 className="text-heading-sm">Preview — {fileName}</h2>
          <p className="text-body-sm text-graphite">{parsed.rowsSeen} question rows found · {parsed.items.length} valid · {parsed.issues.length} with problems</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byDomain).sort().map(([d, n]) => (
              <span key={d} className={`pill ${domains.includes(d) ? "bg-paper border border-hairline" : "bg-coral"}`}>{d}: {n}</span>
            ))}
          </div>
          {foreign.length > 0 && (
            <Alert tone="warning" title={`Domains ${foreign.join(", ")} don’t exist in ${course}`}>
              Those rows will be rejected. Check you picked the right course.
            </Alert>
          )}
          {parsed.issues.length > 0 && (
            <details>
              <summary className="cursor-pointer text-body-sm font-medium">Rows skipped by the parser ({parsed.issues.length})</summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-caption">
                {parsed.issues.slice(0, 200).map((i, k) => <li key={k}>Line {i.line}{i.ref ? ` (${i.ref})` : ""}: {i.message}</li>)}
              </ul>
            </details>
          )}
          <button type="button" className="btn-primary" onClick={run} disabled={!parsed.items.length || !!progress && !report}>
            Import {parsed.items.length} question{parsed.items.length === 1 ? "" : "s"} into {course}
          </button>
          {progress && !report && <p className="text-body-sm text-graphite" role="status">Importing… {progress.done} / {progress.total}</p>}
        </section>
      )}

      {report && (
        <section className="card space-y-3">
          <h2 className="text-heading-sm">Import report</h2>
          <p className="text-body-sm">{report.accepted} accepted ({report.created} new, {report.accepted - report.created} updated) · {report.rejected.length} rejected</p>
          {report.rejected.length > 0 && (
            <>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-caption">
                {report.rejected.slice(0, 200).map((r) => <li key={r.row}>Row {r.row} {r.external_ref}: {r.errors.join("; ")}</li>)}
              </ul>
              <button type="button" className="btn-outline" onClick={downloadRejected}>Download rejected rows (CSV)</button>
            </>
          )}
          <a href={`/admin/questions?course=${course}`} className="link text-body-sm">Go to the {course} question bank</a>
        </section>
      )}
    </div>
  );
}
