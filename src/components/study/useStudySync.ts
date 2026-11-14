"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * Talks to the study RPCs and reports save state.
 *
 * - `call` is for actions whose answer the learner needs now (submit an answer,
 *   acknowledge, finish). Transient failures retry with back-off; nothing is
 *   announced as saved until the server says so.
 * - `queue` is for idempotent background writes (resume position, notes). They are
 *   mirrored to localStorage under a key scoped to the signed-in learner, coalesced
 *   (the newest write per target wins) and flushed in order. Buffers belonging to any
 *   other account on this browser are discarded on load, so state never leaks across
 *   accounts; sign-out discards them too (see SignOutCleanup).
 */
export type SaveState = { state: "idle" | "saving" | "saved" | "error" | "expired"; message?: string };
type Pending = { key: string; fn: string; args: Record<string, unknown> };

export const STUDY_STORE_PREFIX = "iparkar:study:";
const storeKey = (userId: string) => `${STUDY_STORE_PREFIX}${userId}:pending`;

function read(userId: string): Pending[] {
  try { return JSON.parse(window.localStorage.getItem(storeKey(userId)) ?? "[]"); } catch { return []; }
}
function write(userId: string, q: Pending[]) {
  try {
    if (q.length) window.localStorage.setItem(storeKey(userId), JSON.stringify(q));
    else window.localStorage.removeItem(storeKey(userId));
  } catch { /* private mode */ }
}

const isAuthError = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST301" || e.code === "401" || /jwt|token|not authenticated/i.test(e.message ?? ""));

export function useStudySync(userId: string) {
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const queue = useRef<Pending[]>([]);
  const flushing = useRef(false);
  const backoff = useRef(1000);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(STUDY_STORE_PREFIX) && k !== storeKey(userId)) window.localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
    queue.current = read(userId);
  }, [userId]);

  const rpc = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await getBrowserClient().rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code, auth: isAuthError(error) });
    if (data && typeof data === "object" && "ok" in data && data.ok === false && data.error === "not_enrolled") {
      // A revoked enrollment or an expired session both land here.
      throw Object.assign(new Error("not_enrolled"), { auth: true });
    }
    return data;
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current[0];
        setSave({ state: "saving" });
        try {
          await rpc(job.fn, job.args);
          queue.current.shift();
          write(userId, queue.current);
          backoff.current = 1000;
        } catch (e) {
          const auth = (e as { auth?: boolean }).auth;
          setSave(auth ? { state: "expired", message: "Your session has ended. Sign in again; your place is kept on this device." }
                       : { state: "error", message: "Couldn't save. Retrying…" });
          if (!auth) {
            timer.current = setTimeout(() => { flushing.current = false; void flush(); }, backoff.current);
            backoff.current = Math.min(backoff.current * 2, 30000);
          }
          return;
        }
      }
      setSave({ state: "saved" });
    } finally {
      if (!timer.current) flushing.current = false;
      timer.current = null;
    }
  }, [rpc, userId]);

  const queueWrite = useCallback((key: string, fn: string, args: Record<string, unknown>) => {
    queue.current = [...queue.current.filter((p) => p.key !== key), { key, fn, args }];
    write(userId, queue.current);
    void flush();
  }, [flush, userId]);

  useEffect(() => {
    if (queue.current.length) void flush();
    const online = () => { backoff.current = 1000; void flush(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  /** A call whose result the learner is waiting for. Retries transient failures twice. */
  const call = useCallback(async <T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> => {
    setSave({ state: "saving" });
    let wait = 800;
    for (let tryNo = 0; ; tryNo++) {
      try {
        const data = await rpc(fn, args);
        setSave(queue.current.length ? { state: "saving" } : { state: "saved" });
        return data as T;
      } catch (e) {
        const auth = (e as { auth?: boolean }).auth;
        if (auth) {
          setSave({ state: "expired", message: "Your session has ended. Sign in again to keep going; nothing was marked complete." });
          throw e;
        }
        if (tryNo >= 2) {
          setSave({ state: "error", message: "Couldn't reach the server. Check your connection and try again." });
          throw e;
        }
        await new Promise((r) => setTimeout(r, wait));
        wait *= 2;
      }
    }
  }, [rpc]);

  return { save, call, queueWrite, retry: () => { backoff.current = 1000; void flush(); } };
}
