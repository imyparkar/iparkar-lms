import Link from "next/link";
import type { StudyOffer } from "@/lib/study/types";
import { StartOffer } from "./Access";

/** Not enrolled: offer the free start when the course allows it, otherwise explain. */
export function NotEnrolled({ offer }: { offer?: StudyOffer | null }) {
  if (offer?.self_enroll) return <StartOffer offer={offer} />;
  return (
    <div className="card max-w-[720px]">
      <h1 className="text-heading-sm">You&apos;re not enrolled in this course</h1>
      <p className="mt-2 text-body text-graphite">Your account doesn&apos;t have an active enrollment for this study course, or the enrollment has ended. Course content is shown only to enrolled learners.</p>
      <Link href="/learn" className="btn-primary mt-4">Go to My learning</Link>
    </div>
  );
}
