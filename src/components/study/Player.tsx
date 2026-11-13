"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Missing, ProgressSummary, StudyActivity, StudyChapter, StudySection } from "@/lib/study/types";
import { STATUS_LABEL, pct } from "@/lib/study/types";
import { StudyBlock, provenance } from "./Blocks";
import { ActivityCard } from "./Activity";
import { StatusPill } from "./Progress";
import { useStudySync } from "./useStudySync";

type Outline = { number: number; title: string; chapters: { code: string; title: string; status: keyof typeof STATUS_LABEL; has_content: boolean }[] }[];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/[^0-9a-f-]/g, "0"));

export function Player({ userId, courseSlug, courseTitle, data, outline, startSection }: {
  userId: string; courseSlug: string; courseTitle: string; data: StudyChapter; outline: Outline; startSection: string | null;
}) {
  const { chapter } = data;
  const [sections, setSections] = useState<StudySection[]>(data.sections);
  const [missing, setMissing] = useState<Missing>(data.missing);
  const [progress, setProgress] = useState<ProgressSummary>(data.progress);
  const [status, setStatus] = useState(chapter.status);
  const [current, setCurrent] = useState<string | null>(() => {
    if (startSection && data.sections.some((s) => s.code === startSection)) return startSection;
    return (data.sections.find((s) => !s.acknowledged) ?? data.sections[0])?.code ?? null;
  });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [note, setNote] = useState(chapter.note ?? "");
  const [finishMsg, setFinishMsg] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const [courseDone, setCourseDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { save, call, queueWrite, retry } = useStudySync(userId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const idx = sections.findIndex((s) => s.code === current);
  const section = idx >= 0 ? sections[idx] : null;
  const ackCount = sections.filter((s) => s.acknowledged).length;
  const ready = missing.has_content && missing.sections.length === 0 && missing.activities.length === 0;

  const patchSection = useCallback((code: string, f: (s: StudySection) => StudySection) =>
    setSections((all) => all.map((s) => (s.code === code ? f(s) : s))), []);

  // Opening a section is recorded on the server; resume position is queued (debounced, stale-safe).
  useEffect(() => {
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
    const url = new URL(window.location.href);
    url.searchParams.set("s", section.code);
    window.history.replaceState(null, "", url);
    if (!firstRender.current) headingRef.current?.focus();
    firstRender.current = false;
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Optional active-time estimate: counts only while the tab is visible and the learner was recently active.
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => { lastInput = Date.now(); };
    const evts = ["keydown", "pointerdown", "scroll"] as const;
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const iv = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < 120_000) {
        void call("study_record_time", { p_chapter: chapter.id, p_seconds: 60 }).catch(() => {});
      }
    }, 60_000);
    return () => { clearInterval(iv); evts.forEach((e) => window.removeEventListener(e, mark)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setFinishMsg({ tone: "info", text: "Not yet. The list beside the button shows what's left." });
      }
    } catch { /* save status already explains */ } finally { setBusy(false); }
  }

  function go(code: string) {
    setCurrent(code);
    setOutlineOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
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

  const saveText = save.state === "saving" ? "Saving…" : save.state === "saved" ? "All changes saved" : save.state === "error" ? save.message : save.state === "expired" ? save.message : "";

  return (
    <div className="min-h-screen bg-paper">
      <a href="#lesson" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-button focus:bg-white focus:px-4 focus:py-2">Skip to lesson</a>
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-white shadow-nav">
        <div className="mx-auto flex h-nav max-w-page items-center gap-3 px-4 sm:px-6">
          <Link href={`/learn/${courseSlug}`} className="btn-text shrink-0" aria-label="Exit to course overview">Exit</Link>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1 text-body-sm text-graphite">
              <li className="hidden truncate sm:block"><Link href="/learn" className="hover:text-ink">My learning</Link><span aria-hidden="true"> / </span></li>
              <li className="hidden truncate md:block"><Link href={`/learn/${courseSlug}/domain/${chapter.domain.number}`} className="hover:text-ink">Domain {chapter.domain.number}</Link><span aria-hidden="true"> / </span></li>
              <li className="truncate font-medium text-ink" aria-current="page">Chapter {chapter.code}</li>
            </ol>
          </nav>
          <p role="status" aria-live="polite" className="hidden text-body-sm text-graphite sm:block">
            {saveText}
            {save.state === "error" && <button type="button" className="ml-2 font-medium text-ink underline" onClick={retry}>Retry</button>}
            {save.state === "expired" && <a className="ml-2 font-medium text-ink underline" href={`/login?next=${encodeURIComponent(`/study/${courseSlug}/${chapter.code}`)}`}>Sign in</a>}
          </p>
          <button type="button" className="btn-text hidden shrink-0 lg:inline-flex" aria-pressed={focus} onClick={() => setFocus((f) => !f)}>{focus ? "Show outline" : "Focus mode"}</button>
          <button type="button" className="btn-text shrink-0 lg:hidden" aria-expanded={outlineOpen} aria-controls="outline" onClick={() => setOutlineOpen((o) => !o)}>Outline</button>
        </div>
        <div className="h-1 bg-ink-20" aria-hidden="true"><div className="h-1 bg-action" style={{ width: `${(progress.completed_chapters / Math.max(progress.required_chapters, 1)) * 100}%` }} /></div>
      </header>
      {(save.state === "error" || save.state === "expired") && (
        <p role="alert" className="bg-coral px-4 py-2 text-center text-body-sm text-ink sm:hidden">{saveText}</p>
      )}

      <div className={`mx-auto flex max-w-page gap-8 px-4 sm:px-6 ${focus ? "justify-center" : ""}`}>
        {/* outline */}
        <aside id="outline" aria-label="Course outline"
          className={`${outlineOpen ? "fixed inset-x-0 bottom-0 top-[68px] z-20 block overflow-y-auto bg-white p-4" : "hidden"} ${focus ? "" : "lg:sticky lg:top-[84px] lg:block lg:max-h-[calc(100vh-100px)] lg:w-[300px] lg:shrink-0 lg:overflow-y-auto lg:bg-transparent lg:p-0 lg:pt-6"}`}>
          <div className="rounded-card border border-hairline bg-white p-4">
            <p className="text-caption text-slate">This chapter</p>
            <p className="mt-1 text-body-sm font-semibold text-ink">{chapter.code} · {chapter.title}</p>
            <p className="mt-1 text-body-sm text-graphite">{ackCount} of {sections.length} sections studied</p>
            <ol className="mt-3 space-y-1">
              {sections.map((s, i) => (
                <li key={s.code}>
                  <button type="button" onClick={() => go(s.code)} aria-current={s.code === current ? "step" : undefined}
                    className={`flex w-full items-start gap-2 rounded-button px-2 py-2 text-left text-body-sm transition-colors duration-200 ${s.code === current ? "bg-sky-tint text-ink" : "text-ink-95 hover:bg-paper"}`}>
                    <span className="w-5 shrink-0 font-semibold">{i + 1}.</span>
                    <span className="flex-1">{s.title}</span>
                    <span className="sr-only">{s.acknowledged ? ", studied" : s.opened ? ", opened" : ", not opened"}</span>
                    <span aria-hidden="true" className="shrink-0 text-caption text-slate">{s.acknowledged ? "Done" : s.opened ? "Open" : ""}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <details className="mt-4 rounded-card border border-hairline bg-white p-4">
            <summary className="cursor-pointer text-body-sm font-semibold text-ink">All chapters</summary>
            <div className="mt-3 space-y-3">
              {outline.map((d) => (
                <div key={d.number}>
                  <p className="text-caption text-slate">Domain {d.number} · {d.title}</p>
                  <ul className="mt-1 space-y-0.5">
                    {d.chapters.map((c) => (
                      <li key={c.code}>
                        <Link href={`/study/${courseSlug}/${c.code}`} aria-current={c.code === chapter.code ? "page" : undefined}
                          className={`flex gap-2 rounded-button px-2 py-1 text-body-sm ${c.code === chapter.code ? "bg-sky-tint text-ink" : "text-ink-95 hover:bg-paper"}`}>
                          <span className="w-9 shrink-0 font-medium">{c.code}</span>
                          <span className="flex-1">{c.title}</span>
                          <span className="shrink-0 text-caption text-slate">{c.status === "completed" ? "Done" : !c.has_content ? "Soon" : ""}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </aside>

        {/* lesson */}
        <main id="lesson" className="min-w-0 max-w-reading flex-1 pb-24 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            <span className="text-body-sm text-graphite">Domain {chapter.domain.number} · {chapter.domain.title}</span>
            {chapter.is_prerequisite && <span className="pill bg-paper text-ink border border-hairline">Prerequisite chapter</span>}
            {chapter.review_status !== "published" && chapter.review_status !== "approved" && <span className="pill bg-paper text-ink border border-hairline">Draft · awaiting subject review</span>}
          </div>
          <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.8px] text-ink sm:text-[40px]">
            <span className="text-graphite">{chapter.code}</span> {chapter.title}
          </h1>
          {chapter.meta.summary && <p className="lead mt-3">{chapter.meta.summary}</p>}
          <p className="mt-2 text-body-sm text-graphite">
            {chapter.objectives.length ? `ASP11 objective ${chapter.objectives.join(", ")}` : "Prerequisite for the calculation objectives"}
            {chapter.est_minutes ? ` · about ${chapter.est_minutes} min (editorial estimate)` : ""}
            {chapter.source_pages ? ` · guide pp. ${chapter.source_pages[0]}–${chapter.source_pages[1]}` : ""}
          </p>

          {!sections.length && (
            <div className="mt-8 rounded-card border border-hairline bg-white p-6">
              <h2 className="text-heading-sm">This chapter is in preparation</h2>
              <p className="mt-2 text-body text-graphite">Its lessons are being written and reviewed. It can&apos;t be completed yet, so the course can&apos;t reach 100% until it is published. The study guide PDF covers it on pages {chapter.source_pages?.[0]}–{chapter.source_pages?.[1]} in the meantime.</p>
            </div>
          )}

          {section && (
            <article className="mt-8" aria-labelledby="section-title">
              <p className="text-caption text-slate">Section {idx + 1} of {sections.length}{section.est_minutes ? ` · about ${section.est_minutes} min` : ""}</p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <h2 id="section-title" ref={headingRef} tabIndex={-1} className="text-[26px] font-semibold leading-tight tracking-[-0.4px] text-ink">{section.title}</h2>
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

              <div className="mt-6 space-y-5">
                {section.blocks.map((b, i) => <StudyBlock key={i} block={b} renderActivity={renderActivity(section)} />)}
              </div>

              {provenance(section.blocks) && (
                <p className="mt-6 text-body-sm text-graphite">Drawn from the iParkar ASP Exam Study Guide, Edition 1.0, {provenance(section.blocks)}. Practice questions are original to this course and are not examination items.</p>
              )}

              <div className="mt-8 rounded-card border border-hairline bg-white p-5">
                {section.acknowledged
                  ? <p className="text-body text-ink"><span className="font-semibold">Section studied.</span> You can come back to it at any time.</p>
                  : <>
                      <p className="text-body text-charcoal">When you have worked through this section, mark it as studied. This is your own record of study; it doesn&apos;t test you.</p>
                      <button type="button" className="btn-outline mt-3" onClick={acknowledge} disabled={busy || !section.opened}>Mark section as studied</button>
                    </>}
              </div>

              <nav aria-label="Section navigation" className="mt-6 flex items-center justify-between gap-2">
                {idx > 0 ? <button type="button" className="btn-outline" onClick={() => go(sections[idx - 1].code)}>Previous section</button> : <span />}
                {idx < sections.length - 1 && <button type="button" className="btn-outline" onClick={() => go(sections[idx + 1].code)}>Next section</button>}
              </nav>
            </article>
          )}

          {/* Finish chapter */}
          {sections.length > 0 && (
            <section aria-labelledby="finish-title" className="mt-10 rounded-card border border-hairline bg-white p-6">
              <h2 id="finish-title" className="text-heading-sm text-ink">Finish chapter</h2>
              {status === "completed" ? (
                <p className="mt-2 text-body text-ink">You completed this chapter. It stays open for review.</p>
              ) : (
                <>
                  <p className="mt-2 text-body text-graphite">A chapter is complete when every section is marked as studied and every required activity has been answered with its feedback read. Right or wrong answers both count: activities are practice, not a pass mark.</p>
                  {missingLines.length > 0 && (
                    <div className="mt-3">
                      <p className="text-body-sm font-semibold text-ink" id="finish-missing">Still to do in {missingLines.length} {missingLines.length === 1 ? "section" : "sections"}</p>
                      <ul className="mt-1 space-y-1 text-body-sm text-charcoal">{missingLines.map((l) => <li key={l.code}><button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => go(l.code)}>{l.text}</button></li>)}</ul>
                    </div>
                  )}
                  <button type="button" className="btn-primary mt-4" onClick={finish} disabled={busy}
                    aria-disabled={!ready} aria-describedby={missingLines.length ? "finish-missing" : undefined}>
                    Finish chapter
                  </button>
                </>
              )}
              {finishMsg && <p role="status" className="mt-3 text-body text-ink">{finishMsg.text}</p>}
              {courseDone && <Link className="btn-dark mt-3" href={`/learn/${courseSlug}/completion`}>View your completion record</Link>}
              <p className="mt-4 text-body-sm text-graphite">Course progress: {progress.completed_chapters} of {progress.required_chapters} chapters · {pct(progress.completed_chapters, progress.required_chapters)}%</p>
            </section>
          )}

          {/* Notes */}
          {sections.length > 0 && (
            <section aria-labelledby="notes-title" className="mt-6 rounded-card border border-hairline bg-white p-6">
              <h2 id="notes-title" className="text-heading-sm text-ink">My notes</h2>
              <p className="mt-1 text-body-sm text-graphite">Private to you. Saved automatically.</p>
              <label htmlFor="chapter-note" className="sr-only">Notes for chapter {chapter.code}</label>
              <textarea id="chapter-note" className="field-input mt-3 min-h-[120px]" maxLength={10000} value={note}
                onChange={(e) => { setNote(e.target.value); queueWrite("note", "study_save_note", { p_chapter: chapter.id, p_body: e.target.value }); }} />
            </section>
          )}

          <nav aria-label="Chapter navigation" className="mt-8 flex items-center justify-between gap-2">
            {chapter.prev ? <Link className="btn-text" href={`/study/${courseSlug}/${chapter.prev}`}>Previous chapter ({chapter.prev})</Link> : <span />}
            {chapter.next && <Link className="btn-text" href={`/study/${courseSlug}/${chapter.next}`}>Next chapter ({chapter.next})</Link>}
          </nav>
          <p className="mt-6 text-caption text-graphite">{courseTitle}. Study records show participation and formative practice, not exam readiness. Not affiliated with or endorsed by BCSP.</p>
        </main>
      </div>
    </div>
  );
}

