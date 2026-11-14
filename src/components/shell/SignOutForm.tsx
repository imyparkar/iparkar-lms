"use client";
import { clearStudyBuffers } from "./IdleLogout";

/** Sign out, discarding any unsynced study buffers so nothing carries to the next account on this browser. */
export function SignOutForm() {
  return (
    <form action="/auth/signout" method="post" onSubmit={clearStudyBuffers}>
      <button className="btn-text whitespace-nowrap" type="submit">Sign out</button>
    </form>
  );
}
