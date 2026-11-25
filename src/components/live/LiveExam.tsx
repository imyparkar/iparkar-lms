"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";
import { clockLevel, createSync, formatClock, remainingMs, type ClockSync } from "@/lib/exam/clock";
import { letter } from "@/lib/format";

export type LiveItem = { id: string; n: number; stem: string; options: string[]; choice: number | null };
export type LiveAttempt = { id: string; status: string; attempt_no: number; minutes: number; started_at: string; deadline_at: string; server_now: string };

type Pending = { item: string; choice: number | null; seq: number };
const qKey = (a: string) => `iparkar:live-exam:${a}:pending`;
const fKey = (a: string) => `iparkar:live-exam:${a}:flags`;
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/**
 * Final-exam workspace. The server's deadline is authoritative; the countdown uses server time plus a monotonic
 * clock, so changing the device clock changes nothing. Every answer is queued, mirrored to localStorage and sent in
 * order with a sequence number; failures retry. At zero the saved answers are submitted.
 */
export function LiveExam({ course, attempt, items: initial, title }: { course: string; attempt: LiveAttempt; items: LiveItem[]; title: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [i, setI] = useState(0);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [left, setLeft] = useState<number>(() => Date.parse(attempt.deadline_at) - Date.parse(attempt.server_now));
  const [save, setSave] = useState<"saved" | "saving" | "offline">("saved");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sync = useRef<ClockSync>(createSync(attempt.deadline_at, attempt.server_now, typeof performance !== "undefined" ? performance.now() : 0));
  const queue = useRef<Pending[]>([]);
  const running = useRef(false);
  const closed = useRef(false);
  const seqRef = useRef(0);

  const finish = useCallback(async () => {
    if (closed.current) return;
    closed.current = true;
    setSubmitting(true);
    const supabase = getBrowserClient();
    // Best effort to send anything still queued, then submit (the server also closes it on expiry).
    for (const p of queue.current) {
      await supabase.rpc("live_exam_save", { p_attempt: attempt.id, p_item: p.item, p_choice: p.choice, p_client_seq: p.seq }).then(() => {}, () => {});
    }
    for (let k = 0; k < 5; k++) {
      const { data, error } = await supabase.rpc("live_exam_submit", { p_attempt: attempt.id });
      if (!error && data) break;
      await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
    }
    write(qKey(attempt.id), []);
    router.replace(`/live/${course}/exam/${attempt.id}/result`);
  }, [attempt.id, course, router]);

  const flush = useCallback(async () => {
    if (running.current || closed.current) return;
    running.current = true;
    const supabase = getBrowserClient();
    try {
      while (queue.current.length && !closed.current) {
        const p = queue.current[0];
        setSave("saving");
        const { data, error } = await supabase.rpc("live_exam_save", { p_attempt: attempt.id, p_item: p.item, p_choice: p.choice, p_client_seq: p.seq });
        if (error) throw error;
        if (data?.server_now && data?.deadline_at) sync.current = createSync(data.deadline_at, data.server_now, performance.now());
        if (!data?.ok && ["ATTEMPT_CLOSED", "ATTEMPT_EXPIRED", "NOT_FOUND"].includes(data?.error)) { await finish(); return; }
        queue.current.shift();
        write(qKey(attempt.id), queue.current);
      }
      setSave("saved");
    } catch {
      setSave("offline");
      setTimeout(() => { running.current = false; void flush(); }, 3000);
      return;
    }
    running.current = false;
  }, [attempt.id, finish]);

  // Restore anything not yet sent (e.g. after a reload while offline) and the review flags.
  useEffect(() => {
    const pending = read<Pending[]>(qKey(attempt.id), []);
    setFlags(read(fKey(attempt.id), {}));
    if (pending.length) {
      queue.current = pending;
      seqRef.current = Math.max(...pending.map((p) => p.seq));
      setItems((xs) => xs.map((x) => { const p = [...pending].reverse().find((q) => q.item === x.id); return p ? { ...x, choice: p.choice } : x; }));
      void flush();
    }
  }, [attempt.id, flush]);

  useEffect(() => {
    const t = setInterval(() => {
      const ms = remainingMs(sync.current, performance.now());
      setLeft(ms);
      if (ms <= 0) { clearInterval(t); void finish(); }
    }, 250);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => { clearInterval(t); window.removeEventListener("online", online); };
  }, [finish, flush]);

  function choose(choice: number) {
    if (closed.current) return;
    const item = items[i];
    seqRef.current = Math.max(seqRef.current + 1, Date.now() * 1000);
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, choice } : x)));
    queue.current = [...queue.current.filter((p) => p.item !== item.id), { item: item.id, choice, seq: seqRef.current }];
    write(qKey(attempt.id), queue.current);
    void flush();
  }
  function toggleFlag() {
    const id = items[i].id;
    const f = { ...flags, [id]: !flags[id] };
    setFlags(f); write(fKey(attempt.id), f);
  }

  const q = items[i];
  const answered = items.filter((x) => x.choice !== null).length;
  const level = clockLevel(left, attempt.minutes * 60);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-white/95 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-caption text-slate">{title} · Final examination · attempt {attempt.attempt_no}</p>
          <p className="text-body-sm text-graphite">{answered} of {items.length} answered · <span aria-live="polite">{save === "saved" ? "All answers saved" : save === "saving" ? "Saving…" : "Offline — answers kept on this device and will be sent when you reconnect"}</span></p>
        </div>
        <div role="timer" aria-label="Time remaining" className={`rounded-button px-3 py-1.5 font-mono text-[20px] font-semibold ${level === "critical" ? "bg-[#b3261e] text-white" : level === "warning" ? "bg-marigold text-ink" : "bg-sky-tint text-ink"}`}>
          {formatClock(left)}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <section aria-labelledby="q-stem" className="card space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-slate">Question {i + 1} of {items.length}</p>
            <button type="button" onClick={toggleFlag} className="btn-text" aria-pressed={!!flags[q.id]}>{flags[q.id] ? "★ Marked for review" : "☆ Mark for review"}</button>
          </div>
          <h2 id="q-stem" className="text-[19px] font-medium leading-relaxed">{q.stem}</h2>
          <fieldset className="space-y-2">
            <legend className="sr-only">Choose one answer</legend>
            {q.options.map((o, k) => (
              <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-button border px-4 py-3 text-body transition-colors ${q.choice === k ? "border-midnight bg-sky-tint" : "border-hairline hover:border-ink-54"}`}>
                <input type="radio" name={`q-${q.id}`} className="mt-1" checked={q.choice === k} onChange={() => choose(k)} disabled={submitting} />
                <span><span className="font-semibold">{letter(k)}.</span> {o}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-outline" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>Previous</button>
            {i < items.length - 1
              ? <button type="button" className="btn-primary" onClick={() => setI((x) => x + 1)}>Next</button>
              : <button type="button" className="btn-dark" onClick={() => setConfirming(true)}>Review and submit</button>}
          </div>
        </section>

        <nav aria-label="Questions" className="card h-fit space-y-3">
          <p className="text-body-sm font-semibold">Questions</p>
          <ol className="grid grid-cols-8 gap-1.5 lg:grid-cols-5">
            {items.map((x, k) => (
              <li key={x.id}>
                <button type="button" onClick={() => setI(k)} aria-current={k === i ? "step" : undefined}
                        aria-label={`Question ${k + 1}${x.choice !== null ? ", answered" : ", not answered"}${flags[x.id] ? ", marked for review" : ""}`}
                        className={`relative h-9 w-full rounded-[6px] text-body-sm font-semibold ${k === i ? "ring-2 ring-midnight" : ""} ${x.choice !== null ? "bg-midnight text-white" : "bg-ink-20 text-ink"}`}>
                  {k + 1}{flags[x.id] && <span aria-hidden="true" className="absolute -right-1 -top-1 text-[11px] text-marigold">★</span>}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn-dark w-full" onClick={() => setConfirming(true)} disabled={submitting}>Submit examination</button>
        </nav>
      </div>

      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="sub-t" className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="card max-w-[460px] space-y-4 bg-white">
            <h2 id="sub-t" className="text-heading-sm">Submit your examination?</h2>
            <p className="text-body">{answered} of {items.length} questions answered.{answered < items.length ? ` ${items.length - answered} unanswered will score zero.` : ""} You can&apos;t change your answers after submitting.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-dark" onClick={() => { setConfirming(false); void finish(); }} disabled={submitting} autoFocus>{submitting ? "Submitting…" : "Submit now"}</button>
              <button type="button" className="btn-outline" onClick={() => setConfirming(false)}>Keep working</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
