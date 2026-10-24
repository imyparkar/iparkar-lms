"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { startExam, type StartState } from "@/lib/exam/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";
import type { BlueprintDomain } from "@/lib/types";

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
            <li key={s.domain_code}>{s.domain_code} {s.domain_name}: needs {s.required}, {s.available} published</li>
          ))}
        </ul>
      )}
      {state.shortages && <p className="mt-1">The administrator has been notified. No questions are borrowed from other domains or courses.</p>}
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
