/** A course version labelled "-beta" is open to learners while its content is still under subject review. */
export const isBeta = (version: string | null | undefined) => /-beta/.test(version ?? "");

export function BetaNotice({ className = "", source = "the course study guide" }: { className?: string; source?: string }) {
  return (
    <div role="note" className={`rounded-card bg-marigold p-4 text-body-sm text-ink ${className}`}>
      <span className="font-semibold">Beta · content under review.</span>{" "}
      These lessons were converted from {source} and are still being checked. If something looks wrong,
      check the study guide and tell us at <a className="underline underline-offset-2" href="mailto:support@iparkar.com">support@iparkar.com</a>.
    </div>
  );
}
