import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode } from "@/lib/study/types";
import type { StudyChapter, StudyCourse } from "@/lib/study/types";
import { Player } from "@/components/study/Player";
import { NotEnrolled } from "@/components/study/NotEnrolled";
import { Paywall } from "@/components/study/Access";
import { studyBuyUrl } from "@/lib/study/buy";

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
      <main id="main" className="mx-auto max-w-reading px-4 py-20">
        <p className="mb-6 text-body-sm"><Link href="/learn" className="text-ink underline underline-offset-2">← My learning</Link></p>
        {data?.error === "access_expired" && courseData?.ok
          ? <Paywall access={data.access} buyHref={studyBuyUrl(courseCode(course), user)} courseTitle={(courseData as StudyCourse).course.title}
                     done={data.progress?.completed_chapters} total={data.progress?.required_chapters} slug={course} />
          : <NotEnrolled offer={data?.offer} />}
      </main>
    );
  }
  const c = courseData as StudyCourse;
  const sheet = c.resources.find((r) => r.kind === "formula_sheet" && r.domain === (data as StudyChapter).chapter.domain.number);
  const outline = c.domains.map((d) => ({
    number: d.number, title: d.title,
    chapters: d.chapters.map((ch) => ({ code: ch.code, title: ch.title, status: ch.status, has_content: ch.has_content })),
  }));
  return <Player userId={user.id} courseSlug={course} courseTitle={c.course.title} data={data as StudyChapter}
                 outline={outline} startSection={sp.s ?? null}
                 formulaHref={sheet ? `/learn/${course}/formulas/${sheet.domain}` : null}
                 buyHref={studyBuyUrl(c.course.code, user)} courseVersion={c.course.version} />;
}
