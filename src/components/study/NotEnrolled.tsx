import Link from "next/link";

export function NotEnrolled() {
  return (
    <div className="card max-w-[720px]">
      <h1 className="text-heading-sm">You&apos;re not enrolled in this course</h1>
      <p className="mt-2 text-body text-graphite">Your account doesn&apos;t have an active enrollment for this study course, or the enrollment has ended. Course content is shown only to enrolled learners.</p>
      <Link href="/learn" className="btn-primary mt-4">Go to My learning</Link>
    </div>
  );
}
