import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { LiveExam, type LiveAttempt, type LiveItem } from "@/components/live/LiveExam";

export const metadata = { title: "Examination in progress" };
export const dynamic = "force-dynamic";

export default async function LiveExamAttempt({ params }: { params: Promise<{ course: string; attemptId: string }> }) {
  const { course, attemptId } = await params;
  if (!/^[a-z]{2,8}$/.test(course) || !/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("live_exam_get", { p_attempt: attemptId });
  if (!data?.ok) notFound();
  const a = data.attempt as LiveAttempt;
  if (a.status !== "in_progress") redirect(`/live/${course}/exam/${attemptId}/result`);
  return <LiveExam course={course} attempt={a} items={data.items as LiveItem[]} title={data.course.title} />;
}
