import Link from "next/link";

export function Logo({ reversed = false, href = "/dashboard", size = 32 }: { reversed?: boolean; href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-button" aria-label="iParkar Learning home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reversed ? "/brand/iparkar-mark-reversed-tm.svg" : "/brand/iparkar-mark-primary-tm.svg"} width={Math.round(size * 1.28)} height={size} alt="" />
      <span className={`hidden text-[17px] font-semibold tracking-[-0.2px] min-[480px]:inline ${reversed ? "text-white" : "text-ink"}`}>iParkar Learning<sup className="ml-px align-super text-[9px] font-normal leading-none">™</sup></span>
    </Link>
  );
}
