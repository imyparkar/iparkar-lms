/** Shapes returned by the live-course RPCs (supabase/migrations/20261125000100_live_courses.sql). */
export type LiveSession = {
  id: string; no: number; title: string; minutes: number; starts_at: string | null; ends_at: string | null; instructor: string | null;
  join_url: string | null; recording_url: string | null; attendance: "present" | "absent" | null; makeup_task: string | null;
  makeup_status: "open" | "submitted" | "approved" | "returned" | null; makeup_feedback: string | null; makeup_deadline: string | null; satisfied: boolean;
};
export type LiveSubmission = {
  id: string; attempt_no: number; route: string; submitted_at: string; file_name: string | null; has_response: boolean;
  mark: number | null; max: number; feedback: string | null; marked_at: string | null;
};
export type LivePractical = { code: string; title: string; session_no: number; submissions: LiveSubmission[]; passed: boolean };
export type LiveModule = { course: string; module: string; title: string; minutes: number | null; status: string; completed_at: string | null; done: boolean };
export type LiveExamStatus = {
  items: number; minutes: number; pass_mark: number; max_attempts: number; cooldown_days: number; extra_pct: number; minutes_allowed: number;
  attempts_used: number; open_attempt: string | null; next_allowed_at: string | null; can_start: boolean;
  blocked_reason: "passed" | "access_ended" | "activities_incomplete" | "no_attempts_left" | "cooldown" | "exam_not_open" | null;
  passed: boolean; best: { score: number; max: number; passed: boolean; attempt_id: string } | null;
  history: { id: string; attempt_no: number; status: string; score: number | null; max: number | null; passed: boolean | null; finished_at: string | null }[];
};
export type LiveDashboard = {
  ok: true;
  course: { code: string; title: string; description: string | null; version: string; designed_hours: number };
  access: { has_access: boolean; expires_at: string | null; source: string } & Record<string, unknown>;
  purchase_verified: boolean; links_visible: boolean;
  cohort: { code: string; title: string; time_zone: string; status: string } | null;
  sessions: LiveSession[]; practicals: LivePractical[];
  practical_rules: { max: number; pass: number; resubmit_days: number };
  independent: LiveModule[]; activities_complete: boolean; exam: LiveExamStatus;
  certificate: {
    offered: boolean; eligible: boolean; conditions: { purchase: boolean; activities: boolean; exam: boolean };
    issued: { certificate_code: string; name_on_certificate: string; issued_at: string | null } | null; suggested_name: string;
  };
};
export type LiveNotEnrolled = {
  ok: false; error: "not_enrolled" | "not_found" | "not_signed_in";
  course?: { code: string; title: string; description: string | null; price_label: string | null; access_days: number | null };
};

/** Live courses use these codes (study_courses.delivery = 'live'). */
export const LIVE_COURSES = new Set(["OHBP"]);
export const isLiveCourse = (code: string) => LIVE_COURSES.has(code.toUpperCase());
export const liveSlug = (code: string) => code.toLowerCase();

export const EXAM_BLOCKED: Record<string, string> = {
  passed: "You have passed the final examination.",
  access_ended: "Your course access has ended.",
  activities_incomplete: "The examination opens when every live session (or approved make-up), practical and independent-study module is complete.",
  no_attempts_left: "You have used all your attempts. Contact your instructor about next steps.",
  cooldown: "You can retake the examination after the waiting period.",
  exam_not_open: "The examination isn't open yet. Your instructor will let you know when it is.",
};

export const PRACTICAL_ERRORS: Record<string, string> = {
  not_enrolled: "You're not enrolled in this course.",
  access_ended: "Your course access has ended.",
  not_found: "That practical wasn't found.",
  awaiting_marking: "Your submission is waiting to be marked. You'll see feedback here within 7 days.",
  already_passed: "You've already passed this practical.",
  no_resubmissions_left: "You've used your resubmission. Book the make-up clinic with your instructor.",
  deadline_passed: "The resubmission window has closed. Contact your instructor.",
  empty: "Add your answer or attach a file.",
  bad_file: "That file couldn't be accepted.",
  already_submitted: "This attempt has already been submitted.",
};

export const MAKEUP_ERRORS: Record<string, string> = {
  not_found: "That session wasn't found.",
  access_ended: "Your course access has ended.",
  not_missed: "Make-up tasks are only for sessions marked as missed.",
  watch_recording: "Confirm that you watched the full recording.",
  too_short: "Write at least a few sentences (20 characters or more).",
  deadline_passed: "The 14-day make-up window has closed. Contact your instructor.",
};
