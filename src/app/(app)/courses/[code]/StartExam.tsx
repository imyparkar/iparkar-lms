"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { startExam, type StartState } from "@/lib/exam/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";
import type { BlueprintDomain, SubjectArea } from "@/lib/types";

function Problem({ state }: { state: StartState }) {
  if (!state.error) return null;
  return (
    <Alert tone={state.code === "ACTIVE_ATTEMPT" ? "warning" : "error"} title={state.error}>
      {state.code === "ACTIVE_ATTEMPT" && state.attemptId && (
        <>Finish or submit it before starting another. <Link className="link" href={`/exam/${state.attemptId}`}>Resume that exam</Link></>
      )}
      {state.shortages && (
        <ul className="mt-1 list-disc pl-5">
          {state.shortages.map((s) => (
            <li key={s.domain_code}>
              {s.domain_code === s.domain_name ? s.domain_name : `${s.domain_code} ${s.domain_name}`}: needs {s.required}, {s.available} published
            </li>
          ))}
        </ul>
      )}
      {state.shortages && <p className="mt-1">The administrator has been notified. No questions are borrowed from another domain, subject area or course.</p>}
    </Alert>
  );
}

export function StartMixed({ courseId, blueprintId, count, minutes }: { courseId: string; blueprintId: string; count: number; minutes: number }) {
  const [state, action] = useActionState<StartState, FormData>(startExam, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="blueprint_id" value={blueprintId} />
      <input type="hidden" name="mode" value="mixed" />
      <Problem state={state} />
      <SubmitButton className="btn-primary" pendingText="Building your exam…">Start {count}-question exam · {minutes} min</SubmitButton>
    </form>
  );
}

export function StartSubject({ courseId, blueprintId, subjects, count, minutes }: {
  courseId: string; blueprintId: string; subjects: SubjectArea[]; count: number; minutes: number;
}) {
  const [state, action] = useActionState<StartState, FormData>(startExam, {});
  const [subject, setSubject] = useState("");
  const chosen = subjects.find((s) => s.subject_area === subject);
  const willAsk = chosen ? Math.min(count, chosen.published) : count;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="blueprint_id" value={blueprintId} />
      <input type="hidden" name="mode" value="subject" />
      <div>
        <label htmlFor="subject_area" className="field-label">Subject area</label>
        <select id="subject_area" name="subject_area" className="field-input" required
                value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="" disabled>Choose a subject area…</option>
          {subjects.map((s) => (
            <option key={s.subject_area} value={s.subject_area}>{s.subject_area} ({s.published})</option>
          ))}
        </select>
        <p className="mt-1 text-caption text-graphite">
          {chosen
            ? `${chosen.published} published questions in this subject area; this set draws ${willAsk} at random.`
            : "The number beside each subject area is how many published questions it holds."}
        </p>
      </div>
      <Problem state={state} />
      <SubmitButton className="btn-outline" pendingText="Building your set…">
        Start {willAsk}-question subject set · {minutes} min
      </SubmitButton>
    </form>
  );
}

export function StartDomain({ courseId, blueprintId, domains, count, minutes }: {
  courseId: string; blueprintId: string; domains: BlueprintDomain[]; count: number; minutes: number;
}) {
  const [state, action] = useActionState<StartState, FormData>(startExam, {});
  const [domain, setDomain] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="blueprint_id" value={blueprintId} />
      <input type="hidden" name="mode" value="domain" />
      <div>
        <label htmlFor="domain_id" className="field-label">Domain</label>
        <select id="domain_id" name="domain_id" className="field-input" required value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="" disabled>Choose a domain…</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
          ))}
        </select>
      </div>
      <Problem state={state} />
      <SubmitButton className="btn-outline" pendingText="Building your exam…">Start {count}-question domain exam · {minutes} min</SubmitButton>
    </form>
  );
}
