"use client";
import { useActionState } from "react";
import type { AdminState } from "@/lib/live/adminActions";

/** A server-action form that announces the result (role=status) next to its submit button. */
export function AdminForm({ action, children, submit, className = "", tone = "btn-primary" }: {
  action: (s: AdminState, f: FormData) => Promise<AdminState>; children: React.ReactNode; submit: string; className?: string; tone?: string;
}) {
  const [state, run, pending] = useActionState<AdminState, FormData>(action, {});
  return (
    <form action={run} className={className}>
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className={tone} disabled={pending}>{pending ? "Saving…" : submit}</button>
        <span role="status" className={`text-body-sm ${state.error ? "text-[#b3261e]" : "text-graphite"}`}>{state.error ?? state.message ?? ""}</span>
      </div>
    </form>
  );
}
