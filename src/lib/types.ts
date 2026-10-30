/** Shapes returned by the database RPCs (see supabase/migrations). */
export type ExamMode = "mixed" | "domain" | "subject";
export type SubjectArea = { subject_area: string; published: number };
export type FeedbackPolicy = "immediate" | "after_submit" | "delayed" | "restricted";

export type BlueprintDomain = { id: string; code: string; number: number; name: string; weight: number };

export type MyCourse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  exams_enabled: boolean;
  has_access: boolean;
  access_expires_at: string | null;
  has_lifetime_access: boolean;
  active_attempt_id: string | null;
  completed_attempts: number;
  last_score: number | null;
  blueprint: {
    id: string;
    name: string;
    version: string;
    verification_status: "unverified" | "verified";
    domains: BlueprintDomain[] | null;
  } | null;
  exams: { mode: ExamMode; title: string; question_count: number; duration_minutes: number; feedback_policy: FeedbackPolicy }[] | null;
  subject_areas: SubjectArea[] | null;
};

export type SubjectPerformance = {
  subject_area: string;
  total: number;
  correct: number;
  pct: number;
  attempts?: number;
};

export type AttemptQuestion = {
  position: number;
  question_id: string;
  stem: string;
  options: { id: string; body: string }[];
  selected_option_id: string | null;
  flagged: boolean;
  locked: boolean;
  feedback: { is_correct: boolean; correct_option_id: string; explanation: string | null } | null;
};

export type AttemptPayload = {
  ok: true;
  attempt: {
    id: string;
    status: "in_progress" | "submitted" | "expired";
    mode: ExamMode;
    course: { id: string; code: string; name: string };
    domain: { code: string; name: string } | null;
    blueprint: { id: string; version: string; name: string };
    question_count: number;
    duration_seconds: number;
    started_at: string;
    expires_at: string;
    server_now: string;
    feedback_policy: FeedbackPolicy;
  };
  questions: AttemptQuestion[];
};

export type ResultDomain = {
  domain_id: string; code: string; number: number; name: string; weight: number;
  total: number; answered: number; correct: number; pct: number;
};

export type ReviewItem = {
  position: number;
  external_ref: string | null;
  domain_code: string;
  task_code: string | null;
  stem: string;
  options: { id: string; body: string }[];
  selected_option_id: string | null;
  correct_option_id: string;
  is_correct: boolean;
  flagged: boolean;
  explanation: string | null;
  reference: string | null;
};

export type AttemptResult = {
  ok: true;
  attempt: {
    id: string; status: "submitted" | "expired"; mode: ExamMode; finalized_reason: string;
    course: { id: string; code: string; name: string };
    domain: { code: string; name: string } | null;
    blueprint: { id: string; version: string; name: string };
    question_count: number; correct: number; incorrect: number; unanswered: number; score_pct: number;
    started_at: string; submitted_at: string; time_used_seconds: number;
    feedback_policy: FeedbackPolicy; review_available_at: string | null;
  };
  domains: ResultDomain[];
  review_allowed: boolean;
  review: ReviewItem[];
};

export type CourseAnalytics = {
  ok: true;
  blueprint_id: string;
  indicators: { strong: number; developing: number; min_questions: number };
  summary: {
    completed: number; average_score: number | null; best_score: number | null;
    questions_attempted: number; correct: number; accuracy: number | null;
  };
  trend: { attempt_id: string; submitted_at: string; score_pct: number; mode: ExamMode }[];
  domains: { domain_id: string; code: string; number: number; name: string; weight: number;
             total: number; correct: number; pct: number | null; attempts: number; recent_pct: number | null }[];
  tasks: { task_id: string; code: string; name: string; domain_code: string; total: number; correct: number; pct: number }[];
  missed_topics: { label: string; domain_code: string; misses: number }[];
  history: {
    attempt_id: string; mode: ExamMode; status: string; domain_name: string | null; blueprint_version: string;
    started_at: string; submitted_at: string | null; score_pct: number | null; correct: number | null;
    question_count: number; time_used_seconds: number | null; review_available: boolean;
  }[];
  attempts_on_other_blueprints: number;
};

export type RpcError = { ok: false; error: string; [k: string]: unknown };
