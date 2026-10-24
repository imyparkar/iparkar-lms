"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * Reliable answer persistence.
 * - Every change is queued, mirrored to localStorage, and sent to the
 *   save_answer / set_flag RPCs in order.
 * - Network failures retry with back-off; nothing is dropped silently.
 * - A monotonically increasing client_seq lets the server ignore stale writes.
 */
export type ChangeInput = { kind: "answer"; questionId: string; optionId: string | null }
                        | { kind: "flag"; questionId: string; flagged: boolean };
type Change = ChangeInput & { seq: number };

export type SyncStatus = { state: "saved" | "saving" | "offline" | "error" | "closed"; pending: number; message?: string };

const storeKey = (attemptId: string) => `iparkar:attempt:${attemptId}:pending`;
const seqKey = (attemptId: string) => `iparkar:attempt:${attemptId}:seq`;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode) — the in-memory queue still works */
  }
}

export function useAnswerSync(attemptId: string, onClosed: (reason: string) => void) {
  const queue = useRef<Change[]>([]);
  const running = useRef(false);
  const backoff = useRef(1000);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: "saved", pending: 0 });
  const closed = useRef(false);

  const persist = useCallback(() => writeStore(storeKey(attemptId), queue.current), [attemptId]);

  const nextSeq = useCallback(() => {
    const last = readStore<number>(seqKey(attemptId), 0);
    const now = Math.floor((performance.timeOrigin + performance.now()) * 1000);
    const seq = Math.max(last + 1, now);
    writeStore(seqKey(attemptId), seq);
    return seq;
  }, [attemptId]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (running.current || closed.current) return queue.current.length === 0;
    running.current = true;
    const supabase = getBrowserClient();
    try {
      while (queue.current.length && !closed.current) {
        const c = queue.current[0];
        setStatus({ state: "saving", pending: queue.current.length });
        const res = c.kind === "answer"
          ? await supabase.rpc("save_answer", { p_attempt: attemptId, p_question: c.questionId, p_option: c.optionId, p_client_seq: c.seq })
          : await supabase.rpc("set_flag", { p_attempt: attemptId, p_question: c.questionId, p_flagged: c.flagged });
        if (res.error) throw res.error; // network / transport: retry
        const data = res.data as { ok: boolean; error?: string };
        if (!data.ok && ["ATTEMPT_CLOSED", "ATTEMPT_EXPIRED", "NOT_FOUND"].includes(data.error ?? "")) {
          closed.current = true;
          queue.current = [];
          persist();
          setStatus({ state: "closed", pending: 0 });
          onClosed(data.error!);
          return false;
        }
        // other logical rejections (e.g. ANSWER_LOCKED) are dropped: retrying cannot succeed
        queue.current.shift();
        persist();
        backoff.current = 1000;
      }
      setStatus({ state: "saved", pending: 0 });
      return true;
    } catch {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setStatus({ state: offline ? "offline" : "error", pending: queue.current.length,
                  message: offline ? "You’re offline. Answers are kept on this device and will sync when you reconnect." : "Couldn’t reach the server. Retrying…" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), backoff.current);
      backoff.current = Math.min(backoff.current * 2, 15000);
      return false;
    } finally {
      running.current = false;
    }
  }, [attemptId, onClosed, persist]);

  const enqueue = useCallback((c: ChangeInput) => {
    // collapse superseded changes of the same kind for the same question
    queue.current = queue.current.filter((x) => !(x.kind === c.kind && x.questionId === c.questionId));
    queue.current.push({ ...c, seq: nextSeq() });
    persist();
    setStatus((s) => ({ ...s, state: "saving", pending: queue.current.length }));
    void flush();
  }, [flush, nextSeq, persist]);

  /** Restore unsynced changes from a previous page load and re-send them. */
  const restore = useCallback(() => {
    const saved = readStore<Change[]>(storeKey(attemptId), []);
    if (saved.length) {
      queue.current = saved;
      void flush();
    }
    return saved;
  }, [attemptId, flush]);

  /** Wait (bounded) for the queue to drain — used before submitting. */
  const drain = useCallback(async (timeoutMs = 8000) => {
    const start = performance.now();
    while (queue.current.length && performance.now() - start < timeoutMs && !closed.current) {
      const ok = await flush();
      if (!ok) await new Promise((r) => setTimeout(r, 500));
    }
    return queue.current.length === 0;
  }, [flush]);

  const clearLocal = useCallback(() => {
    try {
      window.localStorage.removeItem(storeKey(attemptId));
      window.localStorage.removeItem(seqKey(attemptId));
    } catch { /* ignore */ }
  }, [attemptId]);

  useEffect(() => {
    const online = () => { backoff.current = 1000; void flush(); };
    window.addEventListener("online", online);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.current.length) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return { enqueue, restore, drain, status, clearLocal, markClosed: () => { closed.current = true; } };
}
