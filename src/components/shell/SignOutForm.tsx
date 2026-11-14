"use client";
import { STUDY_STORE_PREFIX } from "@/components/study/useStudySync";

/** Sign out, discarding any unsynced study buffers so nothing carries to the next account on this browser. */
export function SignOutForm() {
  return (
    <form action="/auth/signout" method="post" onSubmit={() => {
      try {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(STUDY_STORE_PREFIX)) window.localStorage.removeItem(k);
        }
      } catch { /* storage unavailable */ }
    }}>
      <button className="btn-text whitespace-nowrap" type="submit">Sign out</button>
    </form>
  );
}
