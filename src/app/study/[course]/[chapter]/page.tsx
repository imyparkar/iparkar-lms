import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode } from "@/lib/study/types";
import type { StudyChapter, StudyCourse } from "@/lib/study/types";
import { Player } from "@/components/study/Player";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }) {
  const { chapter } = await params;
  return { title: `Chapter ${chapter}`, robots: { index: false } };
}

export default async function ChapterPage({ params, searchParams }: {
  params: Promise<{ course: string; chapter: string }>; searchParams: Promise<{ s?: string }>;
}) {
  const { course, chapter } = await params;
  const sp = await searchParams;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course) || !/^\d{1,2}\.\d{1,2}$/.test(chapter)) notFound();
  const { supabase, user } = await requireUser();
  const [{ data }, { data: courseData }] = await Promise.all([
    supabase.rpc("get_study_chapter", { p_course_code: courseCode(course), p_chapter_code: chapter }),
    supabase.rpc("get_study_course", { p_course_code: courseCode(course) }),
  ]);

  if (!data?.ok) {
    if (data?.error === "not_found") notFound();
    return (
      <main className="mx-auto max-w-reading px-4 py-20">
        <div className="card">
          <h1 className="text-heading-sm">You&apos;re not enrolled in this course</h1>
          <p className="mt-2 text-body text-graphite">Your account doesn&apos;t have an active enrollment for this study course, or your enrollment has ended. Lesson content is only shown to enrolled learners.</p>
          <Link href="/learn" className="btn-primary mt-4">Go to My learning</Link>
        </div>
      </main>
    );
  }
  const c = courseData as StudyCourse;
  const outline = c.domains.map((d) => ({
    number: d.number, title: d.title,
    chapters: d.chapters.map((ch) => ({ code: ch.code, title: ch.title, status: ch.status, has_content: ch.has_content })),
  }));
  return <Player userId={user.id} courseSlug={course} courseTitle={c.course.title} data={data as StudyChapter}
                 outline={outline} startSection={sp.s ?? null} />;
}
