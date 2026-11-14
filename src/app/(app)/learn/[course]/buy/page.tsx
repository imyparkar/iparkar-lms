import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { courseCode, courseSlug } from "@/lib/study/types";
import type { StudyAccess, StudyOffer } from "@/lib/study/types";
import { studyBuyUrl, isAccessRequest } from "@/lib/study/buy";
import { guideForStudyCourse } from "@/lib/studyGuides";
import { accessLine } from "@/components/study/Access";
import { startStudyCourse } from "@/lib/study/accessActions";

export const metadata = { title: "Buy study course" };
export const dynamic = "force-dynamic";

const period = (days: number | null) => (days === 365 ? "365 days" : days ? `${days} days` : "");

/** Buy (or request) paid access to a Self Paced Study Course. Linked from iparkar.com/resources. */
export default async function BuyStudyCourse({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  if (!/^[a-z]{2,8}(-[a-z]{2,8})?$/.test(course)) notFound();
  const code = courseCode(course);
  const { supabase, user } = await requireUser();
  const { data } = await supabase.rpc("get_study_course", { p_course_code: code });

  const enrolled = data?.ok === true;
  const offer = (enrolled ? null : data?.offer) as StudyOffer | null;
  const access = (enrolled ? data.access : null) as StudyAccess | null;
  const title: string | undefined = enrolled ? data.course?.title : offer?.title;
  const guide = guideForStudyCourse(code);
  const slug = courseSlug(code);

  if (!title) {
    return (
      <div className="card max-w-[720px]">
        <p className="text-caption text-slate">iParkar Learning · Self Paced Study Course</p>
        <h1 className="mt-1 text-heading-sm">{code.replace("-SPS", "")} Self Paced Study Course — coming soon</h1>
        <p className="mt-2 text-body text-graphite">This course isn’t open yet. It will be listed on the iParkar Learning Resources page as soon as it’s ready.</p>
        <a href="https://iparkar.com/resources/" className="btn-outline mt-4">Back to Resources</a>
      </div>
    );
  }

  const price = offer?.price_label ?? access?.price_label ?? null;
  const days = offer?.access_days ?? access?.access_days ?? null;
  const buy = studyBuyUrl(code, user);
  const request = isAccessRequest(buy);

  return (
    <div className="max-w-[720px] space-y-6">
      <nav aria-label="Breadcrumb" className="text-body-sm text-graphite"><Link href="/learn" className="hover:text-ink">My learning</Link> / <span className="text-ink">Buy</span></nav>
      <section className="card">
        <p className="text-caption text-slate">iParkar Learning · Self Paced Study Course</p>
        <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-[-0.8px]">{title}</h1>
        {price && <p className="mt-3 text-[28px] font-semibold tracking-[-0.6px]">{price} <span className="text-body font-normal text-graphite">/ {period(days)} access</span></p>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-body text-charcoal">
          <li>Every chapter, practice activity and formula sheet, with your progress saved across devices</li>
          {guide && <li>The {guide.title} PDF to download and keep</li>}
          <li>One-time payment, no automatic renewal; your trial progress carries over</li>
        </ul>
        {access && <p className="mt-4 text-body-sm font-medium text-ink">Your access now: {accessLine(access)}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={buy} className="btn-primary" rel="noopener">{request ? "Request for Access" : `Buy ${period(days)} access${price ? ` · ${price}` : ""}`}</a>
          {offer?.self_enroll && offer.trial_days && (
            <form action={startStudyCourse}>
              <input type="hidden" name="course" value={slug} />
              <button type="submit" className="btn-outline">Start {offer.trial_days}-day free trial first</button>
            </form>
          )}
          {enrolled && <Link href={`/learn/${slug}`} className="btn-outline">Course overview</Link>}
        </div>
        {request && <p className="mt-4 text-caption text-graphite">This opens an email to support@iparkar.com with your account details. We’ll reply with payment details and switch on your access once payment is received.</p>}
      </section>
    </div>
  );
}
