import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { startStudyCourse } from "@/lib/study/accessActions";
import { courseSlug, type StudyAccess, type StudyOffer } from "@/lib/study/types";
import { isAccessRequest } from "@/lib/study/buy";
import { guideForStudyCourse } from "@/lib/studyGuides";

const period = (days: number | null) => (days === 365 ? "12 months" : days ? `${days} days` : "");

function BuyButton({ access, buyHref, className = "btn-primary" }: { access: Pick<StudyAccess, "price_label" | "access_days">; buyHref: string | null; className?: string }) {
  if (!buyHref) return null;
  const label = isAccessRequest(buyHref)
    ? "Request for Access"
    : `Buy ${period(access.access_days)} access${access.price_label ? ` · ${access.price_label}` : ""}`;
  return <a href={buyHref} className={className} rel="noopener">{label}</a>;
}

/** One-line access status for headers and dashboards. */
export function accessLine(a: StudyAccess): string {
  if (a.expires_at === null) return a.source === "pilot" ? "Pilot access · no time limit" : "Access · no time limit";
  if (!a.has_access) return `Access ended ${fmtDate(a.expires_at)}`;
  if (a.source === "trial") return `Free access · ${a.days_left} ${a.days_left === 1 ? "day" : "days"} left`;
  return `Access until ${fmtDate(a.expires_at)}`;
}

/** Shown while the free trial is running: how long is left and how to keep going. */
export function TrialNotice({ access, buyHref }: { access: StudyAccess; buyHref: string | null }) {
  if (!access.has_access || access.source !== "trial") return null;
  return (
    <section aria-label="Free access" className="rounded-card bg-sky-tint p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-body font-semibold text-ink">Free access: {access.days_left} {access.days_left === 1 ? "day" : "days"} left</p>
        <p className="mt-1 text-body-sm text-charcoal">Your {access.trial_days}-day free access ends {fmtDate(access.expires_at)}. {buyHref && isAccessRequest(buyHref) ? "Request" : "Buy"} {period(access.access_days)} of access{access.price_label ? ` (${access.price_label})` : ""} to keep studying; your progress carries over.</p>
      </div>
      <div className="mt-3 shrink-0 sm:mt-0"><BuyButton access={access} buyHref={buyHref} /></div>
    </section>
  );
}

/** Replaces lesson content once access has lapsed. Progress is kept and shown. */
export function Paywall({ access, buyHref, courseTitle, done, total, slug }: {
  access: StudyAccess; buyHref: string | null; courseTitle: string; done?: number; total?: number; slug: string;
}) {
  const trial = access.source === "trial";
  return (
    <div className="card max-w-[720px]">
      <p className="text-caption text-slate">{courseTitle}</p>
      <h1 className="mt-1 text-heading-sm">{trial ? `Your ${access.trial_days}-day free access has ended` : "Your access to this course has ended"}</h1>
      <p className="mt-2 text-body text-graphite">
        Access ended on {fmtDate(access.expires_at)}. Your progress, notes and bookmarks are saved
        {typeof done === "number" && typeof total === "number" ? ` (${done} of ${total} chapters completed)` : ""} and will be waiting when you continue.
      </p>
      <p className="mt-2 text-body-sm text-graphite">The study course is sold separately from the ASP practice exams; buying one does not include the other.</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <BuyButton access={access} buyHref={buyHref} />
        <Link href={`/learn/${slug}`} className="btn-outline">Course overview</Link>
      </div>
    </div>
  );
}

/** Course not started yet: start the free trial. */
export function StartOffer({ offer, compact = false }: { offer: StudyOffer; compact?: boolean }) {
  const slug = courseSlug(offer.code);
  const guide = guideForStudyCourse(offer.code);
  return (
    <section aria-labelledby={`offer-${slug}`} className={compact ? "" : "card max-w-[720px]"}>
      <p className="text-caption text-slate">iParkar Learning · Self-paced study</p>
      <h2 id={`offer-${slug}`} className="mt-1 text-heading-sm">{offer.title}</h2>
      {offer.description && <p className="mt-2 text-body text-graphite">{offer.description}</p>}
      <p className="mt-2 text-body text-charcoal">
        {offer.trial_days ? `Start with ${offer.trial_days} days of free access to every chapter${guide ? ` and the ${guide.code} study guide PDF` : ""}. ` : ""}
        {offer.access_days ? `After that, ${period(offer.access_days)} of access${offer.price_label ? ` is ${offer.price_label}` : " can be bought"}. ` : ""}
        Sold separately from the ASP practice exams.
      </p>
      {offer.self_enroll ? (
        <form action={startStudyCourse} className="mt-4">
          <input type="hidden" name="course" value={slug} />
          <button type="submit" className="btn-primary">{offer.trial_days ? `Start ${offer.trial_days}-day free access` : "Start the course"}</button>
          <Link href={`/learn/${slug}/buy`} className="btn-outline ml-2">Buy{offer.price_label ? ` · ${offer.price_label}` : ""}</Link>
        </form>
      ) : (
        <p className="mt-3 text-body-sm text-graphite">Enrollment for this course is not open yet.</p>
      )}
    </section>
  );
}

export { BuyButton };
