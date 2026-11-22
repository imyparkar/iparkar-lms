"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { courseCode, courseSlug } from "./types";

/** Start a self-enrol study course: begins the free trial (once per learner, never restarted). */
export async function startStudyCourse(form: FormData) {
  const slug = String(form.get("course") ?? "");
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(slug)) redirect("/learn");
  const { supabase } = await requireUser();
  const code = courseCode(slug);
  const { data } = await supabase.rpc("study_self_enroll", { p_course_code: code });
  revalidatePath("/learn");
  if (!data?.ok) redirect(`/learn?error=${encodeURIComponent(data?.error ?? "enrollment_closed")}`);
  if (data.started === false) {
    // The free trial runs once per learner. If they already had this course (an earlier trial, a revoked
    // pilot or an ended purchase) and have no access now, explain and offer to buy instead of opening a
    // chapter that would refuse them.
    const { data: course } = await supabase.rpc("get_study_course", { p_course_code: code });
    if (!(course?.ok && course.access?.has_access)) redirect(`/learn/${courseSlug(code)}/buy?notice=trial-used`);
  }
  redirect(`/study/${courseSlug(code)}/1.1`);
}
