import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import type { AttemptPayload } from "@/lib/types";
import { ExamWorkspace } from "@/components/exam/ExamWorkspace";

export const metadata = { title: "Exam in progress" };
export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("get_attempt", { p_attempt: attemptId });
  if (!data?.ok) notFound();
  const payload = data as AttemptPayload;
  if (payload.attempt.status !== "in_progress") redirect(`/results/${attemptId}`);
  return <ExamWorkspace data={payload} />;
}
