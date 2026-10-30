const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtPct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${Number(n).toFixed(digits).replace(/\.0+$/, "")}%`;
export const modeLabel = (m: string) =>
  m === "mixed" ? "Full mixed exam" : m === "subject" ? "Subject-area practice" : "Domain exam";
export const letter = (i: number) => String.fromCharCode(65 + i);

/** Human messages for RPC error codes. */
export const RPC_ERRORS: Record<string, string> = {
  NOT_AUTHENTICATED: "Please sign in again.",
  ACCOUNT_INACTIVE: "Your account is suspended. Contact support.",
  COURSE_NOT_FOUND: "That course doesn’t exist.",
  NO_ENTITLEMENT: "You don’t have access to this course yet.",
  EXAMS_NOT_ENABLED: "Practice exams for this course aren’t open yet.",
  INVALID_BLUEPRINT: "The course blueprint has been updated. Refresh the page and try again.",
  BLUEPRINT_WEIGHTS_INVALID: "This course’s blueprint is being updated. Try again later.",
  MODE_NOT_AVAILABLE: "This exam mode isn’t available for the course.",
  INVALID_DOMAIN: "Choose a domain from this course.",
  INVALID_SUBJECT: "Choose a subject area from this course.",
  ACTIVE_ATTEMPT: "You already have an exam in progress for this course.",
  INSUFFICIENT_QUESTIONS: "There aren’t enough published questions to build this exam yet.",
  NOT_FOUND: "Exam not found.",
  ATTEMPT_CLOSED: "This exam has already been submitted.",
  ATTEMPT_EXPIRED: "Time is up — your exam was submitted automatically.",
  ANSWER_LOCKED: "This answer is locked.",
  FORBIDDEN: "Administrator access required.",
};
export const rpcMessage = (code: string | undefined) => (code && RPC_ERRORS[code]) || "Something went wrong. Please try again.";
