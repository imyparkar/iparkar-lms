import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { IdleLogout } from "@/components/shell/IdleLogout";
import { ScormPlayer } from "@/components/scorm/ScormPlayer";
import { SLUG, type ScormCourse, type ScormLaunch } from "@/lib/scorm/types";

export const metadata = { title: "Course module" };
export const dynamic = "force-dynamic";

/** Full-viewport player for one SCORM module of a free course (signed-in learners). */
export default async function ScormModulePage({ params }: { params: Promise<{ course: string; module: string }> }) {
  const { course, module } = await params;
  if (!SLUG.test(course) || !SLUG.test(module)) notFound();
  const { supabase } = await requireUser();
  const [{ data: c }, { data: launch, error }] = await Promise.all([
    supabase.rpc("scorm_get_course", { p_course: course }),
    supabase.rpc("scorm_launch", { p_course: course, p_module: module }),
  ]);
  if (!c || error || !launch) notFound();
  const mods = (c as ScormCourse).modules;
  const i = mods.findIndex((m) => m.code === module);
  const next = mods[i + 1];
  return (
    <>
      <IdleLogout />
      <ScormPlayer
        launch={launch as ScormLaunch}
        courseHref={`/free/${course}`}
        position={i + 1}
        total={mods.length}
        nextHref={next ? `/scorm/${course}/${next.code}` : null}
      />
    </>
  );
}
