/** SCORM 1.2 courses (free for signed-in learners). Shapes returned by the scorm_* RPCs. */

export type ScormStatus = "passed" | "completed" | "failed" | "incomplete" | "browsed" | "not attempted";

export type ScormModuleRow = {
  code: string;
  title: string;
  summary: string | null;
  sort_order: number;
  minutes: number | null;
  status: ScormStatus;
  score: number | null;
  completed_at: string | null;
  last_launched_at: string | null;
};

export type ScormCourse = {
  code: string;
  title: string;
  summary: string | null;
  status: "draft" | "published" | "retired";
  modules: ScormModuleRow[];
};

export type ScormCourseSummary = {
  code: string;
  title: string;
  summary: string | null;
  status: "draft" | "published" | "retired";
  modules_total: number;
  modules_done: number;
  started: boolean;
  last_activity_at: string | null;
};

export type ScormLaunch = {
  course: { code: string; title: string };
  module: { code: string; title: string; launch_path: string; package_version: string; mastery_score: number | null };
  cmi: {
    student_id: string;
    student_name: string;
    lesson_status: ScormStatus;
    lesson_location: string;
    suspend_data: string;
    score_raw: string;
    total_time: string;
    entry: "ab-initio" | "resume";
    mastery_score: string;
  };
};

export const SLUG = /^[a-z0-9-]{2,40}$/;

export const isDone = (s: ScormStatus) => s === "passed" || s === "completed";

/** Learner-facing status word (the word carries the meaning; colour only reinforces it). */
export function statusLabel(s: ScormStatus): { label: string; tone: string } {
  if (s === "passed") return { label: "Passed", tone: "bg-midnight text-white" };
  if (s === "completed") return { label: "Completed", tone: "bg-midnight text-white" };
  if (s === "failed") return { label: "Not passed yet", tone: "bg-coral text-ink" };
  if (s === "incomplete" || s === "browsed") return { label: "In progress", tone: "bg-marigold text-ink" };
  return { label: "Not started", tone: "bg-sky-tint text-ink" };
}

/** The module to open next: the first not yet passed/completed, else the first. */
export function nextModule(mods: ScormModuleRow[]): ScormModuleRow | undefined {
  return mods.find((m) => !isDone(m.status)) ?? mods[0];
}
