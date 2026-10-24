"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator as CalcIcon, ChevronLeft, ChevronRight, Flag, Maximize2, Minimize2, LayoutGrid, Check, CloudOff, Loader2 } from "lucide-react";
import type { AttemptPayload, AttemptQuestion } from "@/lib/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { clockLevel, createSync, formatClock, remainingMs, type ClockSync } from "@/lib/exam/clock";
import { letter, rpcMessage } from "@/lib/format";
import { Calculator } from "./Calculator";
import { useAnswerSync } from "./useAnswerSync";
import { QuestionNav, type NavFilter } from "./QuestionNav";
import { SubmitDialog } from "./SubmitDialog";

type QState = { selected: string | null; flagged: boolean; locked: boolean; feedback: AttemptQuestion["feedback"] };

export function ExamWorkspace({ data }: { data: AttemptPayload }) {
  const router = useRouter();
  const { attempt, questions } = data;
  const immediate = attempt.feedback_policy === "immediate";
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<Record<string, QState>>(() =>
    Object.fromEntries(questions.map((q) => [q.question_id, { selected: q.selected_option_id, flagged: q.flagged, locked: q.locked, feedback: q.feedback }])));
  const [draft, setDraft] = useState<Record<string, string | null>>({}); // immediate mode: selection before "Check"
  const [calcOpen, setCalcOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [filter, setFilter] = useState<NavFilter>("all");
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const sync = useRef<ClockSync>(createSync(attempt.expires_at, attempt.server_now, 0));
  const [left, setLeft] = useState(() => remainingMs(sync.current, 0));
  const autoSubmitted = useRef(false);
  const stemRef = useRef<HTMLHeadingElement>(null);

  const finishAndLeave = useCallback(() => {
    router.replace(`/results/${attempt.id}`);
  }, [router, attempt.id]);

  const onClosed = useCallback((reason: string) => {
    setNotice(rpcMessage(reason));
    setTimeout(finishAndLeave, 1500);
  }, [finishAndLeave]);

  const { enqueue, restore, drain, status, clearLocal, markClosed } = useAnswerSync(attempt.id, onClosed);

  // ---- clock: server-authoritative, monotonic locally ----
  useEffect(() => {
    sync.current = createSync(attempt.expires_at, attempt.server_now, performance.now());
    const tick = setInterval(() => setLeft(remainingMs(sync.current, performance.now())), 250);
    const resync = async () => {
      const t0 = performance.now();
      const { data: c } = await getBrowserClient().rpc("get_attempt_clock", { p_attempt: attempt.id });
      if (!c?.ok) return;
      if (c.status !== "in_progress") return onClosed("ATTEMPT_CLOSED");
      // assume the server stamped the time halfway through the round trip
      sync.current = createSync(c.expires_at, c.server_now, (t0 + performance.now()) / 2);
    };
    const every = setInterval(resync, 60_000);
    const vis = () => document.visibilityState === "visible" && void resync();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(tick); clearInterval(every); document.removeEventListener("visibilitychange", vis); };
  }, [attempt.id, attempt.expires_at, attempt.server_now, onClosed]);

  // ---- restore unsynced local changes after a refresh ----
  useEffect(() => {
    const pending = restore();
    if (!pending.length) return;
    setState((s) => {
      const next = { ...s };
      for (const c of pending) {
        const q = next[c.questionId];
        if (!q) continue;
        next[c.questionId] = c.kind === "answer" ? { ...q, selected: c.optionId } : { ...q, flagged: c.flagged };
      }
      return next;
    });
  }, [restore]);

  useEffect(() => {
    setCanFullscreen(typeof document !== "undefined" && !!document.documentElement.requestFullscreen);
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const submit = useCallback(async (auto: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    setNotice(auto ? "Time is up — submitting your answers…" : "Submitting…");
    await drain(auto ? 4000 : 8000);
    markClosed();
    const supabase = getBrowserClient();
    for (let attemptNo = 0; attemptNo < 5; attemptNo++) {
      const { data: r, error } = await supabase.rpc("submit_attempt", { p_attempt: attempt.id });
      if (!error && r?.ok) {
        clearLocal();
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
        finishAndLeave();
        return;
      }
      await new Promise((res) => setTimeout(res, 1000 * (attemptNo + 1)));
    }
    // the server will still finalize at expiry; answers already saved are safe
    setNotice("We couldn’t confirm your submission. Your saved answers are safe — check your connection and try again.");
    setSubmitting(false);
  }, [submitting, drain, markClosed, attempt.id, clearLocal, finishAndLeave]);

  useEffect(() => {
    if (left <= 0 && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void submit(true);
    }
  }, [left, submit]);

  const q = questions[index];
  const qs = state[q.question_id];
  const counts = useMemo(() => {
    const vals = Object.values(state);
    return {
      answered: vals.filter((v) => v.selected).length,
      flagged: vals.filter((v) => v.flagged).length,
    };
  }, [state]);

  const go = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(questions.length - 1, i)));
    setNavOpen(false);
  }, [questions.length]);

  useEffect(() => { stemRef.current?.focus({ preventScroll: false }); }, [index]);

  const choose = useCallback((optionId: string) => {
    if (submitting || qs.locked) return;
    if (immediate) {
      setDraft((d) => ({ ...d, [q.question_id]: optionId }));
      return;
    }
    const value = qs.selected === optionId ? null : optionId; // click again to clear
    setState((s) => ({ ...s, [q.question_id]: { ...s[q.question_id], selected: value } }));
    enqueue({ kind: "answer", questionId: q.question_id, optionId: value });
  }, [submitting, qs, immediate, q.question_id, enqueue]);

  const check = useCallback(async () => {
    const optionId = draft[q.question_id];
    if (!optionId) return;
    const { data: r } = await getBrowserClient().rpc("save_answer", {
      p_attempt: attempt.id, p_question: q.question_id, p_option: optionId, p_client_seq: Date.now(),
    });
    if (r?.ok) {
      setState((s) => ({ ...s, [q.question_id]: { ...s[q.question_id], selected: optionId, locked: true, feedback: r.feedback } }));
    } else if (r?.error === "ATTEMPT_EXPIRED" || r?.error === "ATTEMPT_CLOSED") onClosed(r.error);
    else setNotice(rpcMessage(r?.error));
  }, [draft, q.question_id, attempt.id, onClosed]);

  const toggleFlag = useCallback(() => {
    const flagged = !qs.flagged;
    setState((s) => ({ ...s, [q.question_id]: { ...s[q.question_id], flagged } }));
    enqueue({ kind: "flag", questionId: q.question_id, flagged });
  }, [qs.flagged, q.question_id, enqueue]);

  // keyboard shortcuts (ignored while typing in the calculator or a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (confirm || t.closest("[role=dialog]") || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const optIdx = "abcdefgh".indexOf(k) >= 0 ? "abcdefgh".indexOf(k) : "12345678".indexOf(k);
      if (optIdx >= 0 && optIdx < q.options.length) { e.preventDefault(); choose(q.options[optIdx].id); }
      else if (k === "arrowright" || k === "n") { e.preventDefault(); go(index + 1); }
      else if (k === "arrowleft" || k === "p") { e.preventDefault(); go(index - 1); }
      else if (k === "f") { e.preventDefault(); toggleFlag(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, q.options, choose, go, index, toggleFlag]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* user or browser declined */ }
  };

  const level = clockLevel(left, attempt.duration_seconds);
  const selectedId = immediate && !qs.locked ? draft[q.question_id] ?? null : qs.selected;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-white">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iparkar-mark-primary.svg" alt="iParkar" width={30} height={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold">{attempt.course.code} · {attempt.course.name}</p>
            <p className="truncate text-caption text-slate">
              {attempt.mode === "mixed" ? "Full mixed practice exam" : `Domain exam — ${attempt.domain?.code} ${attempt.domain?.name}`}
              <span className="hidden sm:inline"> · Question {index + 1} of {questions.length}</span>
            </p>
          </div>
          <SaveIndicator status={status} />
          <button type="button" onClick={() => setCalcOpen((o) => !o)} className="btn-ghost px-3" aria-pressed={calcOpen}>
            <CalcIcon size={16} aria-hidden /><span className="hidden md:inline">{calcOpen ? "Hide calculator" : "Show calculator"}</span>
          </button>
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} className="btn-text hidden px-2 sm:inline-flex" aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}>
              {fullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
            </button>
          )}
          <div role="timer" aria-live={level === "critical" ? "assertive" : "off"} aria-label={`Time remaining ${formatClock(left)}`}
            className={`rounded-button px-3 py-1.5 font-semibold tabular-nums text-[18px] ${level === "critical" ? "bg-coral text-ink" : level === "warning" ? "bg-marigold text-ink" : "bg-midnight text-white"}`}>
            {formatClock(left)}
          </div>
        </div>
      </header>

      {notice && (
        <div role="status" className="bg-midnight px-4 py-2 text-center text-body-sm text-white">{notice}</div>
      )}

      <div className="mx-auto flex w-full max-w-page flex-1 gap-6 px-3 py-6 sm:px-6">
        {/* ---------- question ---------- */}
        <main className="min-w-0 flex-1">
          <article className="card mx-auto max-w-[820px] p-5 sm:p-8" aria-labelledby="stem">
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-slate">Question {index + 1} of {questions.length}</p>
              <button type="button" onClick={toggleFlag} aria-pressed={qs.flagged} disabled={submitting}
                className={`btn px-3 py-1.5 ${qs.flagged ? "bg-marigold text-ink" : "bg-paper text-ink hover:bg-[#ecebea]"}`}>
                <Flag size={15} aria-hidden fill={qs.flagged ? "currentColor" : "none"} />
                {qs.flagged ? "Flagged for review" : "Flag for review"}
              </button>
            </div>
            <h1 id="stem" ref={stemRef} tabIndex={-1} className="mt-4 whitespace-pre-line text-[18px] font-medium leading-relaxed text-ink outline-none">
              {q.stem}
            </h1>
            <fieldset className="mt-6" disabled={submitting || qs.locked}>
              <legend className="sr-only">Answer options</legend>
              <ul className="space-y-2.5">
                {q.options.map((o, i) => {
                  const chosen = selectedId === o.id;
                  const fb = qs.feedback;
                  const isCorrect = fb && fb.correct_option_id === o.id;
                  const isWrongPick = fb && chosen && !fb.is_correct;
                  return (
                    <li key={o.id}>
                      <label className={`flex cursor-pointer items-start gap-3 rounded-button border px-4 py-3 transition-colors duration-200
                        ${isCorrect ? "border-[#2f8f4e] bg-[#e3f4e8]" : isWrongPick ? "border-coral bg-[#fde8e5]" : chosen ? "border-midnight bg-sky-tint" : "border-ink-20 bg-white hover:bg-paper"}`}>
                        <input type="radio" name={`q-${q.question_id}`} className="sr-only" checked={chosen} onChange={() => choose(o.id)}
                               onClick={() => !immediate && chosen && choose(o.id)} />
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill border text-body-sm font-semibold
                          ${chosen ? "border-midnight bg-midnight text-white" : "border-ink-20 bg-white text-ink"}`} aria-hidden>
                          {letter(i)}
                        </span>
                        <span className="pt-0.5 text-body text-ink">{o.body}</span>
                        {isCorrect && <span className="ml-auto pill bg-[#2f8f4e] text-white">Correct answer</span>}
                        {isWrongPick && <span className="ml-auto pill bg-coral text-ink">Your answer</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            {immediate && !qs.locked && (
              <button type="button" className="btn-primary mt-5" onClick={check} disabled={!draft[q.question_id] || submitting}>Check answer</button>
            )}
            {qs.feedback && (
              <div className="mt-5 rounded-button bg-paper p-4 text-body-sm">
                <p className="font-semibold">{qs.feedback.is_correct ? "Correct." : "Not quite."}</p>
                {qs.feedback.explanation && <p className="mt-1 text-graphite">{qs.feedback.explanation}</p>}
              </div>
            )}
            {!immediate && qs.selected && (
              <p className="mt-4 text-caption text-slate">Tip: select your answer again to clear it.</p>
            )}
          </article>
        </main>

        {/* ---------- navigator (desktop) ---------- */}
        <aside className="hidden w-[300px] shrink-0 lg:block" aria-label="Question navigator">
          <div className="sticky top-24">
            <QuestionNav questions={questions} state={state} current={index} onGo={go} filter={filter} setFilter={setFilter} />
          </div>
        </aside>
      </div>

      {/* ---------- bottom bar ---------- */}
      <footer className="sticky bottom-0 z-20 border-t border-hairline bg-white">
        <div className="mx-auto flex max-w-page items-center justify-between gap-2 px-3 py-3 sm:px-6">
          <div className="flex gap-2">
            <button type="button" className="btn-outline" onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft size={16} aria-hidden /> <span className="hidden sm:inline">Previous</span>
            </button>
            <button type="button" className="btn-outline" onClick={() => go(index + 1)} disabled={index === questions.length - 1}>
              <span className="hidden sm:inline">Next</span> <ChevronRight size={16} aria-hidden />
            </button>
            <button type="button" className="btn-ghost lg:hidden" onClick={() => setNavOpen(true)} aria-haspopup="dialog">
              <LayoutGrid size={16} aria-hidden /> {index + 1}/{questions.length}
            </button>
          </div>
          <p className="hidden text-body-sm text-graphite md:block">
            {counts.answered} answered · {questions.length - counts.answered} unanswered · {counts.flagged} flagged
          </p>
          <button type="button" className="btn-primary" onClick={() => setConfirm(true)} disabled={submitting}>Submit exam</button>
        </div>
      </footer>

      {/* ---------- navigator (mobile drawer) ---------- */}
      {navOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/40 lg:hidden" onClick={() => setNavOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Question navigator" className="max-h-[80vh] w-full overflow-y-auto rounded-t-card bg-white p-4"
               onClick={(e) => e.stopPropagation()}>
            <QuestionNav questions={questions} state={state} current={index} onGo={go} filter={filter} setFilter={setFilter} />
            <button type="button" className="btn-text mt-3 w-full" onClick={() => setNavOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />

      <SubmitDialog open={confirm} total={questions.length} answered={counts.answered} flagged={counts.flagged}
        unansweredList={questions.filter((x) => !state[x.question_id].selected).map((x) => x.position)}
        flaggedList={questions.filter((x) => state[x.question_id].flagged).map((x) => x.position)}
        pendingSync={status.pending}
        onCancel={() => setConfirm(false)}
        onGo={(pos) => { setConfirm(false); go(pos - 1); }}
        onConfirm={() => { setConfirm(false); void submit(false); }} />
    </div>
  );
}

function SaveIndicator({ status }: { status: ReturnType<typeof useAnswerSync>["status"] }) {
  const map = {
    saved: { icon: <Check size={14} aria-hidden />, text: "All answers saved", cls: "text-graphite" },
    saving: { icon: <Loader2 size={14} className="animate-spin" aria-hidden />, text: `Saving${status.pending > 1 ? ` ${status.pending}` : ""}…`, cls: "text-graphite" },
    offline: { icon: <CloudOff size={14} aria-hidden />, text: `Offline · ${status.pending} waiting`, cls: "text-vermillion" },
    error: { icon: <CloudOff size={14} aria-hidden />, text: `Retrying · ${status.pending} waiting`, cls: "text-vermillion" },
    closed: { icon: <Check size={14} aria-hidden />, text: "Exam closed", cls: "text-graphite" },
  }[status.state];
  return (
    <p className={`items-center gap-1.5 text-caption ${status.state === "offline" || status.state === "error" ? "flex" : "hidden sm:flex"} ${map.cls}`} role="status" aria-live="polite" title={status.message}>
      {map.icon}{map.text}
    </p>
  );
}
