"use client";
import Link from "next/link";
import { courseProfile } from "@/lib/study/courseProfile";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Missing, ProgressSummary, StudyActivity, StudyChapter, StudySection } from "@/lib/study/types";
import { STATUS_LABEL, pct } from "@/lib/study/types";
import { StudyBlock, provenance } from "./Blocks";
import { ActivityCard } from "./Activity";
import { ProgressMeter, StatusPill } from "./Progress";
import { useStudySync } from "./useStudySync";
import { Calculator } from "@/components/exam/Calculator";
import { BetaNotice, isBeta } from "./BetaNotice";

/**
 * Study player in the iParkar module-player layout (the same shell as the SAT modules):
 * top bar, a collapsible Index (modules = domains → chapters → pages), one page at a time
 * on a "stage", and Back / Next controls along the bottom.
 *
 * Pages of a chapter: a cover page, one page per section, and a Finish chapter page.
 * Navigation is free (no locks): Next never marks anything as studied; acknowledging a
 * section and finishing a chapter stay explicit and are verified by the server.
 * This is a native web player that looks like a SCORM player. It is not a SCORM package.
 */

/** Desktop only (≥1024 px). The virtual calculator is never mounted on phones or small tablets. */
function useMedia(q: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return on;
}

type Outline = { number: number; title: string; chapters: { code: string; title: string; status: keyof typeof STATUS_LABEL; has_content: boolean }[] }[];
type Page = { key: string; kind: "intro" | "section" | "finish"; section?: StudySection; n?: number };

const INTRO = "intro";
const FINISH = "finish";
const PREF_KEY = "iparkar-study-player-prefs"; // display preferences only (text size, motion, index); no learner data
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/[^0-9a-f-]/g, "0"));

/** Decorative domain tiles on the cover page (design-system colours; status is never colour-only). */
const TILE = [
  "bg-midnight text-white", "bg-marigold text-ink", "bg-forest-green text-white", "bg-action text-white",
  "bg-coral text-ink", "bg-sky-wash text-ink", "bg-peach text-ink", "bg-mocha text-ink", "bg-olive-green text-white",
];

const Icon = {
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  half: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>,
  chevron: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>,
  prev: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  expand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

function Dialog({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="dlg-title"
      className="w-[min(640px,calc(100%-32px))] rounded-card bg-white p-0 text-ink shadow-mockup backdrop:bg-midnight/45">
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 id="dlg-title" className="text-heading-sm">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">{Icon.close}</button>
        </header>
        <div className="overflow-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-hairline px-6 py-4">{footer}</footer>}
      </div>
    </dialog>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-3 last:border-0">
      <span><span className="block text-body font-medium text-ink">{label}</span><span className="block text-body-sm text-slate">{hint}</span></span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className={`relative h-[26px] w-11 shrink-0 rounded-pill transition-colors duration-200 ${on ? "bg-action" : "bg-ink-20"}`}>
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white transition-[left] duration-200 ${on ? "left-[21px]" : "left-[3px]"}`} />
      </button>
    </div>
  );
}

export function Player({ userId, courseSlug, courseTitle, data, outline, startSection, formulaHref = null, buyHref = null, courseVersion = "" }: {
  userId: string; courseSlug: string; courseTitle: string; data: StudyChapter; outline: Outline; startSection: string | null;
  formulaHref?: string | null; buyHref?: string | null; courseVersion?: string;
}) {
  const profile = courseProfile(courseSlug);
  const { chapter } = data;
  const desktop = useMedia("(min-width: 1024px)");
  const wide = useMedia("(min-width: 900px)");
  const [calcOpen, setCalcOpen] = useState(false);
  useEffect(() => { if (!desktop) setCalcOpen(false); }, [desktop]);
  const access = data.access;
  const [sections, setSections] = useState<StudySection[]>(data.sections);
  const [missing, setMissing] = useState<Missing>(data.missing);
  const [progress, setProgress] = useState<ProgressSummary>(data.progress);
  const [status, setStatus] = useState(chapter.status);
  const [current, setCurrent] = useState<string>(() => {
    if (startSection === INTRO || startSection === FINISH) return data.sections.length ? startSection : INTRO;
    if (startSection && data.sections.some((s) => s.code === startSection)) return startSection;
    if (!data.sections.length || (chapter.status === "not_started" && !data.sections.some((s) => s.opened))) return INTRO;
    return data.sections.find((s) => !s.acknowledged)?.code ?? FINISH;
  });
  const [indexOpen, setIndexOpen] = useState(true);   // desktop: shown; small screens: drawer
  const [drawer, setDrawer] = useState(false);
  const [openDomains, setOpenDomains] = useState<Set<number>>(() => new Set([chapter.domain.number]));
  const [prefs, setPrefs] = useState({ large: false, calm: false });
  const [dialog, setDialog] = useState<null | "settings" | "notes">(null);
  const [note, setNote] = useState(chapter.note ?? "");
  const [finishMsg, setFinishMsg] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const [courseDone, setCourseDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { save, call, queueWrite, retry } = useStudySync(userId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // display preferences (not learner state)
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}"); setPrefs({ large: !!p.large, calm: !!p.calm }); if (p.index === false) setIndexOpen(false); } catch { /* ignore */ }
  }, []);
  const setPref = (k: "large" | "calm" | "index", v: boolean) => {
    if (k === "index") setIndexOpen(v); else setPrefs((p) => ({ ...p, [k]: v }));
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}"); localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, [k]: v })); } catch { /* ignore */ }
  };

  const pages: Page[] = useMemo(() => [
    { key: INTRO, kind: "intro" },
    ...sections.map((s, i) => ({ key: s.code, kind: "section" as const, section: s, n: i + 1 })),
    ...(sections.length ? [{ key: FINISH, kind: "finish" as const }] : []),
  ], [sections]);
  const pi = Math.max(0, pages.findIndex((p) => p.key === current));
  const page = pages[pi];
  const section = page.kind === "section" ? page.section! : null;
  const ackCount = sections.filter((s) => s.acknowledged).length;
  const ready = missing.has_content && missing.sections.length === 0 && missing.activities.length === 0;
  const reqActs = sections.reduce((n, s) => n + s.activities.filter((a) => a.is_required).length, 0);
  const domainProg = progress.domains.find((d) => d.number === chapter.domain.number);

  const patchSection = useCallback((code: string, f: (s: StudySection) => StudySection) =>
    setSections((all) => all.map((s) => (s.code === code ? f(s) : s))), []);

  // Opening a section is recorded on the server; resume position is queued (debounced, stale-safe).
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", current);
    window.history.replaceState(null, "", url);
    stageRef.current?.scrollTo({ top: 0 });
    if (!firstRender.current) headingRef.current?.focus({ preventScroll: true });
    firstRender.current = false;
    if (!section) return;
    if (!section.opened) {
      call("study_open_section", { p_section: section.id })
        .then(() => {
          patchSection(section.code, (s) => ({ ...s, opened: true }));
          setMissing((m) => ({ ...m, sections: m.sections.map((x) => (x.code === section.code ? { ...x, state: "not_acknowledged" } : x)) }));
        })
        .catch(() => {});
    }
    const t = setTimeout(() => queueWrite("resume", "study_save_resume",
      { p_chapter: chapter.id, p_section: section.id, p_client_ts: Date.now() }), 1200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Optional active-time estimate: counts only while the tab is visible and the learner was recently active.
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const evts = ["keydown", "pointerdown", "scroll", "wheel"] as const;
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    const iv = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < 120_000) {
        void call("study_record_time", { p_chapter: chapter.id, p_seconds: 60 }).catch(() => {});
      }
    }, 60_000);
    return () => { clearInterval(iv); evts.forEach((e) => window.removeEventListener(e, mark, { capture: true })); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback((key: string) => { setCurrent(key); setDrawer(false); }, []);
  const goIndex = useCallback((i: number) => { if (i >= 0 && i < pages.length) go(pages[i].key); }, [go, pages]);

  // ← / → move between pages, as in the module player; never while typing or choosing an answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || dialog) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable='true'],[role='radiogroup'],[role='slider'],dialog")) return;
      if (e.key === "ArrowRight" && pi < pages.length - 1) { e.preventDefault(); goIndex(pi + 1); }
      if (e.key === "ArrowLeft" && pi > 0) { e.preventDefault(); goIndex(pi - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pi, pages.length, goIndex, dialog]);

  async function acknowledge() {
    if (!section) return;
    setBusy(true);
    try {
      const r = await call<{ ok: boolean; error?: string; missing?: Missing }>("study_ack_section", { p_section: section.id });
      if (r.ok) {
        patchSection(section.code, (s) => ({ ...s, acknowledged: true }));
        if (r.missing) setMissing(r.missing);
      }
    } finally { setBusy(false); }
  }

  async function submitActivity(a: StudyActivity, response: Record<string, unknown>) {
    const r = await call<{ ok: boolean; error?: string; attempt_id: string; is_correct: boolean; feedback: never; correct: never; attempts: number }>(
      "study_submit_activity", { p_activity: a.id, p_response: response, p_client_attempt: newId() });
    if (!r.ok) throw new Error(r.error);
    setMissing((m) => ({ ...m, activities: m.activities.map((x) => (x.code === a.code ? { ...x, state: "feedback_not_viewed" } : x)) }));
    return { ...r, response };
  }

  async function feedbackRead(attemptId: string) {
    const r = await call<{ ok: boolean; missing?: Missing }>("study_ack_feedback", { p_attempt: attemptId });
    if (r.ok && r.missing) setMissing(r.missing);
  }

  async function finish() {
    setBusy(true); setFinishMsg(null);
    try {
      const r = await call<{ ok: boolean; error?: string; missing?: Missing; progress?: ProgressSummary; course_completed?: boolean; chapter_newly_completed?: boolean }>(
        "study_finish_chapter", { p_chapter: chapter.id });
      if (r.missing) setMissing(r.missing);
      if (r.ok) {
        setStatus("completed");
        if (r.progress) setProgress(r.progress);
        setCourseDone(!!r.course_completed);
        setFinishMsg({ tone: "ok", text: r.course_completed
          ? "Chapter complete. You have completed every required chapter of the course."
          : `Chapter ${chapter.code} complete. ${r.progress ? `${r.progress.completed_chapters} of ${r.progress.required_chapters} chapters done.` : ""}` });
      } else {
        setFinishMsg({ tone: "info", text: "Not yet. The list above shows what's left." });
      }
    } catch { /* save status already explains */ } finally { setBusy(false); }
  }

  const renderActivity = (s: StudySection) => function ActivitySlot(code: string) {
    const a = s.activities.find((x) => x.code === code);
    if (!a) return null;
    return <ActivityCard key={a.id} activity={a} sectionOpen={s.opened} onSubmit={submitActivity} onFeedbackRead={feedbackRead} onReview={go} />;
  };

  // One line per section, so the list stays short and readable.
  const missingLines = useMemo(() => sections.flatMap((sec, i) => {
    const ms = missing.sections.find((x) => x.code === sec.code);
    const acts = missing.activities.filter((a) => a.section === sec.code);
    if (!ms && !acts.length) return [];
    const parts: string[] = [];
    if (ms?.state === "not_opened") parts.push("open it");
    if (ms) parts.push("mark it as studied");
    const answer = acts.filter((a) => a.state === "not_attempted").length;
    const read = acts.length - answer;
    if (answer) parts.push(`answer ${answer} ${answer === 1 ? "activity" : "activities"}`);
    if (read) parts.push(`read the feedback on ${read} ${read === 1 ? "activity" : "activities"}`);
    return [{ code: sec.code, text: `Section ${i + 1}, ${sec.title}: ${parts.join(", ")}` }];
  }), [missing, sections]);
  const sectionTodo = (code: string) => missing.sections.some((x) => x.code === code) || missing.activities.some((a) => a.section === code);

  const saveText = save.state === "saving" ? "Saving…" : save.state === "saved" ? "All changes saved" : save.state === "error" ? save.message : save.state === "expired" ? save.message : "";
  const showIndex = wide ? indexOpen : drawer;
  const toggleIndex = () => (wide ? setPref("index", !indexOpen) : setDrawer((d) => !d));
  const pageLabel = page.kind === "intro" ? "Chapter introduction" : page.kind === "finish" ? "Finish chapter" : `Section ${page.n} of ${sections.length}`;
  const hint = page.kind === "section" && section
    ? section.acknowledged ? (sectionTodo(section.code) ? "Activities still to answer on this page" : "Studied") : "Mark as studied when you're done"
    : page.kind === "finish" ? (status === "completed" ? "Chapter completed" : ready ? "Ready to finish" : `${missingLines.length} ${missingLines.length === 1 ? "section" : "sections"} still to do`) : "";
  const nextChapterHref = chapter.next ? `/study/${courseSlug}/${chapter.next}` : null;

  async function fullScreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setPref("index", false); }
  }

  /* ---------------- index ---------------- */
  const index = (
    <aside id="study-index" aria-label="Course index"
      className={`flex w-[300px] shrink-0 flex-col border-r border-hairline bg-white ${wide ? "" : "fixed bottom-0 left-0 top-nav z-30 shadow-mockup"} ${showIndex ? "" : "hidden"}`}>
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-body-sm font-semibold text-ink">Index</h2>
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-sky-tint" aria-hidden="true">
            <div className="h-full bg-action transition-[width] duration-300" style={{ width: `${(progress.completed_chapters / Math.max(progress.required_chapters, 1)) * 100}%` }} />
          </div>
          <span className="text-caption text-slate">{pct(progress.completed_chapters, progress.required_chapters)}%</span>
        </div>
        <p className="mt-1 text-caption text-slate">{progress.completed_chapters} of {progress.required_chapters} chapters completed</p>
      </div>
      <nav aria-label="Modules and chapters" className="flex-1 overflow-y-auto px-2 pb-5">
        <ul className="space-y-1">
          {outline.map((d) => {
            const open = openDomains.has(d.number);
            const dp = progress.domains.find((x) => x.number === d.number);
            return (
              <li key={d.number}>
                <button type="button" aria-expanded={open} aria-controls={`mod-${d.number}`}
                  onClick={() => setOpenDomains((s) => { const n = new Set(s); if (n.has(d.number)) n.delete(d.number); else n.add(d.number); return n; })}
                  className="flex w-full items-start gap-2 rounded-button px-3 py-2.5 text-left transition-colors duration-200 hover:bg-paper">
                  <span className={`mt-0.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}>{Icon.chevron}</span>
                  <span className="flex-1">
                    <span className="block text-caption text-slate">Module {d.number}{dp ? ` · ${dp.completed}/${dp.required}` : ""}</span>
                    <span className="block text-body-sm font-semibold leading-snug text-ink">{d.title}</span>
                  </span>
                  {dp?.is_complete && <span className="mt-1 text-forest-green">{Icon.check}<span className="sr-only">, module completed</span></span>}
                </button>
                {open && (
                  <ol id={`mod-${d.number}`} className="mb-1 ml-3 space-y-0.5 border-l border-hairline pl-2">
                    {d.chapters.map((c) => {
                      const here = c.code === chapter.code;
                      const st = here ? status : c.status;
                      return (
                        <li key={c.code}>
                          {here ? (
                            <button type="button" onClick={() => go(INTRO)} aria-current={current === INTRO ? "page" : undefined}
                              className="relative flex w-full items-start gap-2 rounded-button bg-sky-tint px-2.5 py-2 text-left text-body-sm font-semibold text-ink">
                              <span className="w-8 shrink-0 text-caption leading-5 text-slate">{c.code}</span>
                              <span className="flex-1">{c.title}</span>
                              <ChapterState status={st} />
                            </button>
                          ) : (
                            <Link href={`/study/${courseSlug}/${c.code}`}
                              className="flex items-start gap-2 rounded-button px-2.5 py-2 text-body-sm text-ink-95 transition-colors duration-200 hover:bg-paper">
                              <span className="w-8 shrink-0 text-caption leading-5 text-slate">{c.code}</span>
                              <span className="flex-1">{c.title}</span>
                              {c.has_content ? <ChapterState status={st} /> : <span className="shrink-0 text-caption text-slate">Soon</span>}
                            </Link>
                          )}
                          {here && sections.length > 0 && (
                            <ol aria-label={`Pages of chapter ${c.code}`} className="my-1 ml-4 space-y-0.5">
                              {pages.map((p) => {
                                const on = p.key === current;
                                const done = p.kind === "section" ? p.section!.acknowledged && !sectionTodo(p.key) : p.kind === "finish" ? status === "completed" : false;
                                const partial = p.kind === "section" && !done && (p.section!.opened || p.section!.acknowledged);
                                return (
                                  <li key={p.key}>
                                    <button type="button" onClick={() => go(p.key)} aria-current={on ? "page" : undefined}
                                      className={`relative flex w-full items-start gap-2 rounded-button px-2.5 py-1.5 text-left text-body-sm transition-colors duration-200 ${on ? "bg-sky-tint font-semibold text-ink before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-[3px] before:rounded-sm before:bg-action" : "text-ink-95 hover:bg-paper"}`}>
                                      <span className="w-5 shrink-0 text-caption leading-5 text-slate">{p.kind === "section" ? `${p.n}.` : ""}</span>
                                      <span className="flex-1">{p.kind === "intro" ? "Introduction" : p.kind === "finish" ? "Finish chapter" : p.section!.title}</span>
                                      {done ? <span className="mt-0.5 text-forest-green">{Icon.check}<span className="sr-only">, done</span></span>
                                        : partial ? <span className="mt-0.5 text-action">{Icon.half}<span className="sr-only">, started</span></span> : null}
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );

  /* ---------------- pages ---------------- */
  const tiles = (
    <div aria-hidden="true" className={`grid w-full -rotate-3 gap-3 ${outline.length > 7 ? "max-w-[460px] grid-cols-3" : "max-w-[400px] grid-cols-2"}`}>
      {outline.map((d, i) => (
        <div key={d.number} className={`flex min-h-[76px] flex-col justify-end rounded-card p-3.5 ${d.number === chapter.domain.number ? `${TILE[i % TILE.length]} shadow-mockup` : "border border-hairline bg-white text-graphite"} ${outline.length <= 7 && i === outline.length - 1 && outline.length % 2 ? "col-span-2" : ""}`}>
          <span className="text-caption">Module {d.number}</span>
          <b className="text-[15px] font-semibold leading-tight tracking-[-0.2px]">{d.title}</b>
        </div>
      ))}
    </div>
  );

  const introPage = (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_.95fr]">
      <div className="on-dark flex flex-col bg-midnight p-6 text-white sm:p-10 lg:p-12">
        <p className="text-body-sm font-medium text-white/75">Module {chapter.domain.number} of {outline.length} · {chapter.domain.title}</p>
        <h1 ref={current === INTRO ? headingRef : undefined} tabIndex={-1} className="mt-3 focus:outline-none text-[30px] font-semibold leading-[1.08] tracking-[-1px] sm:text-[40px] sm:tracking-[-1.4px]">
          <span className="mb-3 inline-block rounded-pill bg-marigold px-3.5 py-0.5 text-[20px] tracking-[-0.3px] text-ink sm:text-[24px]">Chapter {chapter.code}</span><br />{chapter.title}
        </h1>
        {chapter.meta.summary && <p className="mt-4 font-serif text-lead text-white/85">{chapter.meta.summary}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <StatusPill status={status} className="ring-1 ring-white/40" />
          {sections.length > 0 && <span className="pill bg-white/10 text-white">{sections.length} {sections.length === 1 ? "section" : "sections"}</span>}
          {sections.length > 0 && <span className="pill bg-white/10 text-white">{reqActs} {reqActs === 1 ? "activity" : "activities"}</span>}
          {chapter.est_minutes ? <span className="pill bg-white/10 text-white">About {chapter.est_minutes} min (editorial estimate)</span> : null}
          {chapter.source_pages && <span className="pill bg-white/10 text-white">Guide pp. {chapter.source_pages[0]}–{chapter.source_pages[1]}</span>}
          {chapter.is_prerequisite && <span className="pill bg-white/10 text-white">Prerequisite chapter</span>}
          {chapter.review_status !== "published" && chapter.review_status !== "approved" && <span className="pill bg-white/10 text-white">Draft · awaiting subject review</span>}
        </div>
        {isBeta(courseVersion) && <BetaNotice className="mt-4" source={profile.betaSource} />}
        <div className="mt-auto flex flex-wrap items-center gap-4 pt-8">
          {sections.length > 0 ? (
            <button type="button" className="btn bg-white text-midnight hover:bg-sky-tint" onClick={() => go(sections.find((s) => !s.acknowledged)?.code ?? sections[0].code)}>
              {ackCount === 0 ? "Begin" : status === "completed" ? "Review from the start" : "Continue"}
            </button>
          ) : null}
          <span className="text-body-sm text-white/75">{ackCount} of {sections.length} sections studied · progress saves to your account</span>
        </div>
      </div>
      <div className="flex flex-col gap-8 bg-paper p-6 sm:p-10">
        <div>
          <h2 className="text-heading-sm text-ink">{chapter.objectives.length ? "What this chapter covers" : "About this chapter"}</h2>
          <p className="mt-2 text-body-sm text-graphite">
            {chapter.objectives.length ? `${profile.blueprint} objective${chapter.objectives.length > 1 ? "s" : ""} ${chapter.objectives.join(", ")}` : "Prerequisite for the calculation objectives"}
          </p>
          {chapter.meta.objective_statement && <p className="mt-2 font-serif text-lead text-ink">{chapter.meta.objective_statement}</p>}
          {!!chapter.meta.outcomes?.length && (
            <>
              <p className="mt-5 text-body-sm font-semibold text-ink">By the end of this chapter, you will be able to:</p>
              <ol className="mt-3 space-y-3">
                {chapter.meta.outcomes.map((o, i) => (
                  <li key={i} className="grid grid-cols-[40px_1fr] items-baseline gap-2">
                    <span className="text-[34px] font-light leading-none tracking-[-1.5px] text-action" aria-hidden="true">{i + 1}</span>
                    <span className="text-body text-ink-95">{o}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        {!sections.length && (
          <div className="rounded-card border border-hairline bg-white p-5">
            <h2 className="text-heading-sm">This chapter is in preparation</h2>
            <p className="mt-2 text-body text-graphite">Its lessons are being written and reviewed. It can&apos;t be completed yet, so the course can&apos;t reach 100% until it is published. The study guide PDF covers it on pages {chapter.source_pages?.[0]}–{chapter.source_pages?.[1]} in the meantime.</p>
          </div>
        )}
        <div className="mt-auto hidden place-items-center py-4 lg:grid">{tiles}</div>
      </div>
    </div>
  );

  const sectionPage = section && (
    <article aria-labelledby="section-title" className="mx-auto w-full min-w-0 max-w-reading break-words px-5 py-8 sm:px-10 sm:py-11">
      <p className="text-body-sm font-medium text-graphite">Chapter {chapter.code} · Section {page.n} of {sections.length}{section.est_minutes ? ` · about ${section.est_minutes} min` : ""}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h2 id="section-title" ref={headingRef} tabIndex={-1} className="text-[28px] focus:outline-none font-semibold leading-[1.12] tracking-[-0.8px] text-ink sm:text-[36px] sm:tracking-[-1.1px]">{section.title}</h2>
        <button type="button" className="btn-text shrink-0" aria-pressed={section.bookmarked}
          onClick={async () => {
            const on = !section.bookmarked;
            patchSection(section.code, (s) => ({ ...s, bookmarked: on }));
            try { await call("study_set_bookmark", { p_section: section.id, p_on: on }); }
            catch { patchSection(section.code, (s) => ({ ...s, bookmarked: !on })); }
          }}>
          {section.bookmarked ? "Bookmarked" : "Bookmark"}
        </button>
      </div>

      <div className="mt-7 space-y-5">
        {section.blocks.map((b, i) => <StudyBlock key={i} block={b} renderActivity={renderActivity(section)} />)}
      </div>

      {provenance(section.blocks) && (
        <p className="mt-6 text-body-sm text-graphite">Drawn from {profile.guideName}, {provenance(section.blocks)}. {profile.practiceNote}</p>
      )}

      <div className={`mt-8 rounded-card p-5 ${section.acknowledged ? "bg-sky-tint" : "border border-hairline bg-paper"}`}>
        {section.acknowledged
          ? <p className="text-body text-ink"><span className="font-semibold">Section studied.</span> You can come back to it at any time.</p>
          : <>
              <p className="text-body text-charcoal">When you have worked through this section, mark it as studied. This is your own record of study; it doesn&apos;t test you. Moving on with <b>Next</b> doesn&apos;t mark it for you.</p>
              <button type="button" className="btn-dark mt-3" onClick={acknowledge} disabled={busy || !section.opened}>Mark section as studied</button>
            </>}
      </div>
    </article>
  );

  const finishPage = (
    <div className="grid min-h-full lg:grid-cols-2">
      <section aria-labelledby="finish-title" className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
        <p><StatusPill status={status} /></p>
        <h2 id="finish-title" ref={current === FINISH ? headingRef : undefined} tabIndex={-1} className="mt-3 focus:outline-none text-[34px] font-semibold leading-[1.08] tracking-[-1.2px] text-ink sm:text-[44px] sm:tracking-[-1.5px]">
          {status === "completed" ? "Chapter complete" : "Finish chapter"}
        </h2>
        {status === "completed" ? (
          <p className="mt-4 text-body text-graphite">You completed chapter {chapter.code}. It stays open for review.</p>
        ) : (
          <>
            <p className="mt-4 text-body text-graphite">A chapter is complete when every section is marked as studied and every required activity has been answered with its feedback read. Right or wrong answers both count: activities are practice, not a pass mark.</p>
            {missingLines.length > 0 ? (
              <div className="mt-4">
                <p className="text-body-sm font-semibold text-ink" id="finish-missing">Still to do in {missingLines.length} {missingLines.length === 1 ? "section" : "sections"}</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-charcoal">
                  {missingLines.map((l) => <li key={l.code}><button type="button" className="text-left underline underline-offset-2 hover:text-action" onClick={() => go(l.code)}>{l.text}</button></li>)}
                </ul>
              </div>
            ) : <p className="mt-4 text-body font-medium text-ink">Everything is done. Select <b>Finish chapter</b> to record it.</p>}
          </>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {status !== "completed" && (
            <button type="button" className="btn-primary" onClick={finish} disabled={busy} aria-disabled={!ready} aria-describedby={missingLines.length ? "finish-missing" : undefined}>Finish chapter</button>
          )}
          {status === "completed" && nextChapterHref && <Link className="btn-primary" href={nextChapterHref}>Next chapter ({chapter.next})</Link>}
          {courseDone && <Link className="btn-dark" href={`/learn/${courseSlug}/completion`}>View your completion record</Link>}
          <button type="button" className="btn-outline" onClick={() => go(INTRO)}>Review from the start</button>
          <Link className="btn-text" href={`/learn/${courseSlug}/domain/${chapter.domain.number}`}>Module {chapter.domain.number} overview</Link>
        </div>
        {finishMsg && <p role="status" className="mt-4 text-body text-ink">{finishMsg.text}</p>}
      </section>
      <div className="on-dark flex flex-col justify-center gap-6 bg-midnight p-6 text-white sm:p-10 lg:p-12">
        <div>
          <p className="text-body-sm font-medium text-white/75">Course progress</p>
          <p className="mt-1 text-[88px] font-bold leading-none tracking-[-4px] sm:text-[112px] sm:tracking-[-6px]">
            {progress.completed_chapters}<small className="text-[36px] tracking-[-1px] text-white/70"> / {progress.required_chapters}</small>
          </p>
          <p className="mt-2 text-body text-white/85">chapters completed · {progress.domains_completed} of {progress.domains_total} modules complete</p>
        </div>
        {domainProg && <ProgressMeter dark done={domainProg.completed} total={domainProg.required} label={`Module ${domainProg.number}: ${domainProg.title}`} />}
        <ProgressMeter dark done={progress.completed_chapters} total={progress.required_chapters} label="Whole course" />
        <p className="max-w-[420px] text-body-sm text-white/75">Study records show participation and formative practice, not exam readiness.</p>
      </div>
    </div>
  );

  return (
    <div className={`fixed inset-0 flex flex-col bg-paper ${prefs.large ? "study-large" : ""} ${prefs.calm ? "study-calm" : ""}`}>
      <a href="#study-stage" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-button focus:bg-white focus:px-4 focus:py-2">Skip to lesson</a>

      {/* top bar */}
      <header className="relative z-40 flex h-nav shrink-0 items-center gap-2 bg-white px-3 shadow-nav sm:gap-3 sm:px-4">
        <button type="button" className="icon-btn" onClick={toggleIndex} aria-label="Show or hide the course index" aria-expanded={showIndex} aria-controls="study-index">{Icon.menu}</button>
        <Link href={`/learn/${courseSlug}`} className="flex min-w-0 items-center gap-2.5 rounded-button" aria-label={`${courseTitle}: course overview`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iparkar-mark-primary.svg" width={32} height={32} alt="" className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <small className="hidden text-caption text-graphite sm:block">iParkar Learning · {courseTitle}</small>
            <strong className="truncate text-body-sm font-semibold">Chapter {chapter.code} · {chapter.title}</strong>
          </span>
        </Link>
        <p role="status" aria-live="polite" className="ml-auto hidden shrink-0 text-body-sm text-graphite xl:block">
          {saveText}
          {save.state === "error" && <button type="button" className="ml-2 font-medium text-ink underline" onClick={retry}>Retry</button>}
          {save.state === "expired" && <a className="ml-2 font-medium text-ink underline" href={`/login?next=${encodeURIComponent(`/study/${courseSlug}/${chapter.code}`)}`}>Sign in</a>}
        </p>
        <nav aria-label="Player" className="ml-auto flex shrink-0 items-center gap-0.5 xl:ml-2">
          {access?.source === "trial" && access.has_access && (
            <a href={buyHref && !buyHref.startsWith("mailto:") ? buyHref : `/learn/${courseSlug}`} className="mr-1 hidden rounded-button bg-sky-tint px-3 py-1.5 text-body-sm font-medium text-ink 2xl:inline-flex">
              Free access: {access.days_left} {access.days_left === 1 ? "day" : "days"} left
            </a>
          )}
          <Link href={`/learn/${courseSlug}`} className="topnav hidden md:inline-flex">Home</Link>
          <a href={`/learn/${courseSlug}/search`} className="topnav hidden md:inline-flex">Search</a>
          <a href={`/learn/${courseSlug}/resources/glossary`} target="_blank" rel="noopener" className="topnav hidden lg:inline-flex">Glossary<span className="sr-only"> (opens in a new tab)</span></a>
          {formulaHref && <a href={formulaHref} target="_blank" rel="noopener" className="topnav hidden lg:inline-flex">Formulas<span className="sr-only"> (opens in a new tab)</span></a>}
          {desktop && <button type="button" className="topnav" aria-pressed={calcOpen} onClick={() => setCalcOpen((o) => !o)}>{calcOpen ? "Hide calculator" : "Calculator"}</button>}
          {sections.length > 0 && <button type="button" className="topnav" onClick={() => setDialog("notes")}>Notes</button>}
          <Link href={`/learn/${courseSlug}`} className="topnav">Exit</Link>
        </nav>
      </header>
      {(save.state === "error" || save.state === "expired") && (
        <p role="alert" className="shrink-0 bg-coral px-4 py-2 text-center text-body-sm text-ink xl:hidden">
          {saveText}
          {save.state === "error" && <button type="button" className="ml-2 font-medium underline" onClick={retry}>Retry</button>}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {index}
        {!wide && drawer && <button type="button" aria-label="Close the index" className="fixed inset-0 top-nav z-20 bg-midnight/30" onClick={() => setDrawer(false)} />}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 px-3 pt-3 sm:px-7 sm:pt-6">
            <div ref={stageRef} id="study-stage" tabIndex={-1}
              className="relative mx-auto min-h-0 w-full max-w-[1280px] flex-1 overflow-y-auto rounded-card border border-hairline bg-white focus:outline-none">
              <div key={current} className="study-slide grid min-h-full grid-cols-[minmax(0,1fr)]">
                {page.kind === "intro" ? introPage : page.kind === "finish" ? finishPage : sectionPage}
              </div>
            </div>
          </div>

          {/* controls */}
          <nav aria-label="Page navigation" className="mx-auto flex h-[64px] w-full max-w-[1336px] shrink-0 items-center gap-1.5 px-3 sm:h-[68px] sm:gap-2 sm:px-7">
            <button type="button" className="icon-btn" aria-label="Display settings" onClick={() => setDialog("settings")}>{Icon.gear}</button>
            <button type="button" className="icon-btn hidden sm:inline-grid" aria-label="Full screen" onClick={fullScreen}>{Icon.expand}</button>
            <span className="ml-1 hidden text-body-sm font-medium text-graphite md:inline">{pageLabel} · page {pi + 1} of {pages.length}</span>
            <span className="flex-1" />
            <span className="hidden text-body-sm text-graphite lg:inline">{hint}</span>
            {section && !section.acknowledged && (
              <button type="button" className="btn-outline" onClick={acknowledge} disabled={busy || !section.opened}>Mark as studied</button>
            )}
            <button type="button" className="btn-text" onClick={() => goIndex(pi - 1)} disabled={pi === 0}>{Icon.prev}Back</button>
            {pi < pages.length - 1
              ? <button type="button" className="btn-primary" onClick={() => goIndex(pi + 1)} title="Next (→)">Next{Icon.next}</button>
              : status === "completed" && nextChapterHref
                ? <Link className="btn-primary" href={nextChapterHref}>Next chapter{Icon.next}</Link>
                : <button type="button" className="btn-primary" disabled>Next{Icon.next}</button>}
          </nav>
        </main>
      </div>

      <Dialog open={dialog === "settings"} title="Settings" onClose={() => setDialog(null)}>
        <Switch on={prefs.large} onChange={(v) => setPref("large", v)} label="Larger text" hint="Increase the reading size in the lesson." />
        <Switch on={prefs.calm} onChange={(v) => setPref("calm", v)} label="Reduce motion" hint="Turn off page and panel animations." />
        <Switch on={indexOpen} onChange={(v) => setPref("index", v)} label="Show the index" hint="On wide screens, keep the course index open beside the lesson." />
        <p className="mt-3 text-body-sm text-graphite">These settings stay on this device. Your study progress is saved to your account, not here.</p>
      </Dialog>
      <Dialog open={dialog === "notes"} title={`My notes · chapter ${chapter.code}`} onClose={() => setDialog(null)}
        footer={<><span className="mr-auto self-center text-body-sm text-graphite" aria-live="polite">{saveText}</span><button type="button" className="btn-primary" onClick={() => setDialog(null)}>Done</button></>}>
        <p className="text-body-sm text-graphite">Private to you. Saved automatically.</p>
        <label htmlFor="chapter-note" className="sr-only">Notes for chapter {chapter.code}</label>
        <textarea id="chapter-note" className="field-input mt-3 min-h-[220px]" maxLength={10000} value={note}
          onChange={(e) => { setNote(e.target.value); queueWrite("note", "study_save_note", { p_chapter: chapter.id, p_body: e.target.value }); }} />
      </Dialog>
      {desktop && <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />}
    </div>
  );
}

function ChapterState({ status }: { status: keyof typeof STATUS_LABEL }) {
  if (status === "completed") return <span className="mt-0.5 shrink-0 text-forest-green">{Icon.check}<span className="sr-only">, completed</span></span>;
  if (status === "in_progress") return <span className="mt-0.5 shrink-0 text-action">{Icon.half}<span className="sr-only">, in progress</span></span>;
  return null;
}
