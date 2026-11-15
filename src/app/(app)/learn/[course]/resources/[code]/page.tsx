import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode } from "@/lib/study/types";
import type { Block } from "@/lib/study/schema";
import { StudyBlock } from "@/components/study/Blocks";
import { NotEnrolled } from "@/components/study/NotEnrolled";
import { Paywall } from "@/components/study/Access";
import { PrintButton } from "@/components/study/PrintButton";
import { studyBuyUrl } from "@/lib/study/buy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course resource", robots: { index: false } };

/** Course-wide reference resources (glossary, bibliography). Same access rules as chapters. */
const ALLOWED = new Set(["glossary", "bibliography"]);

type Resource = {
  ok: true;
  course: { code: string; title: string; version: string };
  resource: { code: string; kind: string; title: string; source_pages: [number, number] | null; blocks: Block[]; review_status: string };
};

export default async function CourseResource({ params }: { params: Promise<{ course: string; code: string }> }) {
  const { course, code } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course) || !ALLOWED.has(code)) notFound();
  const { supabase, user } = await requireUser();
  const { data } = await supabase.rpc("get_study_resource", { p_course_code: courseCode(course), p_code: code });
  if (!data?.ok) {
    if (data?.error === "not_found") notFound();
    if (data?.error === "access_expired") {
      return <Paywall access={data.access} buyHref={studyBuyUrl(courseCode(course), user)} courseTitle="Self Paced Study Course" slug={course} />;
    }
    return <NotEnrolled offer={data?.offer} />;
  }
  const r = data as Resource;
  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite print:hidden">
        <Link href="/learn" className="hover:text-ink">My learning</Link> / <Link href={`/learn/${course}`} className="hover:text-ink">{r.course.title}</Link> /{" "}
        <span className="text-ink">{r.resource.title}</span>
      </nav>
      <header className="flex max-w-reading flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-subheading text-graphite">Course resource</p>
          <h1 className="mt-2 text-[36px] font-semibold leading-tight tracking-[-1px]">{r.resource.title}</h1>
          {r.resource.source_pages && <p className="mt-2 text-body-sm text-graphite">From the study guide, pp. {r.resource.source_pages[0]}–{r.resource.source_pages[1]}.</p>}
        </div>
        <div className="print:hidden"><PrintButton /></div>
      </header>
      <article className="max-w-reading space-y-5 rounded-card border border-hairline bg-white p-5 sm:p-8">
        {r.resource.blocks.map((b, i) => (
          <StudyBlock key={i} block={b} renderActivity={() => null} chapterHref={(c) => `/study/${course}/${c}`} />
        ))}
      </article>
    </div>
  );
}
