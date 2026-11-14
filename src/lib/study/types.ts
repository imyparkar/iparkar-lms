import type { Block } from "./schema";

export type ProgressStatus = "not_started" | "in_progress" | "completed";

export type DomainProgress = { number: number; title: string; weight: number | null; required: number; completed: number; is_complete: boolean };
export type ProgressSummary = {
  required_chapters: number; completed_chapters: number; domains_total: number; domains_completed: number; domains: DomainProgress[];
};

export type MyStudyCourse = {
  code: string; title: string; version: string; version_status: string; is_pilot: boolean;
  enrolled_at: string; last_activity_at: string | null; completed_at: string | null;
  progress: ProgressSummary;
  resume: { chapter: string; chapter_title: string; section: string | null } | null;
  recent: { chapter: string; title: string; status: ProgressStatus; at: string }[];
  bookmarks: { chapter: string; section: string; section_title: string; chapter_title: string }[];
};

export type CourseChapter = {
  code: string; title: string; objectives: string[]; is_prerequisite: boolean; is_required: boolean;
  est_minutes: number | null; source_pages: [number, number] | null; review_status: string;
  has_content: boolean; sections: number; status: ProgressStatus;
};
export type CourseDomain = { number: number; title: string; weight: number | null; intro: string | null; chapters: CourseChapter[] };
export type StudyCourse = {
  ok: true;
  course: { code: string; title: string; product: string; version: string; version_status: string; source_title: string | null;
            source_edition: string | null; stated_blueprint: string | null; is_pilot: boolean; completed_at: string | null };
  progress: ProgressSummary;
  resume: { chapter: string; section: string | null; chapter_title: string } | null;
  domains: CourseDomain[];
};

export type ActivityFeedback = { explanation: string; options?: Record<string, string>; review_section?: string };
export type ActivityLast = {
  id: string; response: Record<string, unknown>; is_correct: boolean; feedback_viewed: boolean;
  feedback: ActivityFeedback; correct: Record<string, unknown>; attempts: number;
};
export type ActivitySpec = {
  prompt: string; options?: { id: string; text: string }[]; items?: { id: string; text: string }[];
  unit?: string; hint?: string | null; tolerance_note?: string;
};
export type StudyActivity = {
  id: string; code: string; kind: "single_choice" | "multi_choice" | "numeric" | "ordering" | "self_check"; is_required: boolean;
  spec: ActivitySpec; last: ActivityLast | null;
};
export type StudySection = {
  id: string; code: string; title: string; est_minutes: number | null; is_required: boolean; blocks: Block[];
  opened: boolean; acknowledged: boolean; bookmarked: boolean; activities: StudyActivity[];
};
export type Missing = {
  has_content: boolean;
  sections: { code: string; title: string; state: "not_opened" | "not_acknowledged" }[];
  activities: { code: string; section: string; state: "not_attempted" | "feedback_not_viewed" }[];
};
export type StudyChapter = {
  ok: true;
  chapter: {
    id: string; code: string; title: string; objectives: string[]; is_prerequisite: boolean; is_required: boolean; est_minutes: number | null;
    source_pages: [number, number] | null; review_status: string; status: ProgressStatus; completed_at: string | null;
    note: string | null; prev: string | null; next: string | null; domain: { number: number; title: string };
    meta: { summary?: string; outcomes?: string[]; objective_statement?: string | null; [k: string]: unknown };
  };
  sections: StudySection[];
  missing: Missing;
  progress: ProgressSummary;
};

export const STATUS_LABEL: Record<ProgressStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export function pct(done: number, total: number) {
  // Floor so 98/99 never displays as 100%.
  return total > 0 ? Math.floor((done / total) * 100) : 0;
}

export const courseSlug = (code: string) => code.toLowerCase();
export const courseCode = (slug: string) => slug.toUpperCase();
