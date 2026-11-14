"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { STUDY_STORE_PREFIX } from "@/components/study/useStudySync";

/** Signed-in pages sign the learner out after this long with no mouse, keyboard, touch or scroll activity. */
export const IDLE_LIMIT_MS = 10 * 60_000;
/** A warning with a countdown appears this long before the sign-out. */
const WARN_BEFORE_MS = 60_000;
/** Shared across tabs, so activity in one open tab keeps the others signed in too. */
const KEY = "iparkar:last-activity";
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

function readLast(fallback: number) {
  try { return Number(window.localStorage.getItem(KEY)) || fallback; } catch { return fallback; }
}
function writeLast(t: number) {
  try { window.localStorage.setItem(KEY, String(t)); } catch { /* storage unavailable */ }
}

export function clearStudyBuffers() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(STUDY_STORE_PREFIX)) window.localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}

/**
 * Automatic sign-out after 10 minutes without activity. Mounted on every signed-in page.
 * The server session is ended through the normal /auth/signout route; the learner lands on
 * the sign-in page with a notice and returns to the same page after signing in again.
 */
export function IdleLogout() {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const local = useRef(0);
  const written = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const secondsRef = useRef<number | null>(null);
  useEffect(() => { secondsRef.current = secondsLeft; }, [secondsLeft]);

  const touch = useCallback(() => {
    const now = Date.now();
    local.current = now;
    if (now - written.current > 5_000) { written.current = now; writeLast(now); } // throttle storage writes
  }, []);

  const signOut = useCallback(() => {
    if (done.current) return;
    done.current = true;
    clearStudyBuffers();
    if (nextRef.current) nextRef.current.value = window.location.pathname + window.location.search;
    formRef.current?.requestSubmit();
  }, []);

  useEffect(() => {
    const start = Date.now();
    local.current = start; written.current = start; writeLast(start);

    const check = () => {
      if (done.current) return;
      const last = Math.max(local.current, readLast(local.current));
      const idle = Date.now() - last;
      if (idle >= IDLE_LIMIT_MS) return signOut();
      const left = IDLE_LIMIT_MS - idle;
      setSecondsLeft(left <= WARN_BEFORE_MS ? Math.ceil(left / 1000) : null);
    };

    // While the warning is showing, only the button keeps the session; stray mouse moves don't dismiss it silently.
    const onActivity = () => { if (secondsRef.current === null) touch(); };
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    const onVisible = () => { if (document.visibilityState === "visible") check(); }; // e.g. laptop woken from sleep
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 1_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [signOut, touch]);

  const stay = () => {
    const now = Date.now();
    local.current = now; written.current = now; writeLast(now);
    setSecondsLeft(null);
  };

  return (
    <>
      <form ref={formRef} action="/auth/signout" method="post" hidden>
        <input type="hidden" name="reason" value="idle" />
        <input ref={nextRef} type="hidden" name="next" defaultValue="" />
      </form>
      {secondsLeft !== null && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="idle-h" aria-describedby="idle-d"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4 no-print">
          <div className="w-[min(440px,100%)] rounded-card border border-hairline bg-white p-6 shadow-lg">
            <h2 id="idle-h" className="text-heading-sm">Are you still there?</h2>
            <p id="idle-d" className="mt-2 text-body-sm text-graphite">
              For your security you’ll be signed out in <span className="font-semibold tabular-nums text-ink">{secondsLeft}</span> second{secondsLeft === 1 ? "" : "s"} because there has been no activity for a while. Your progress is saved.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-outline" onClick={signOut}>Sign out now</button>
              <button type="button" className="btn-primary" onClick={stay} autoFocus>Stay signed in</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
