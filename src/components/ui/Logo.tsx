import Link from "next/link";

export function Logo({ reversed = false, href = "/dashboard", size = 32 }: { reversed?: boolean; href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-button" aria-label="iParkar home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reversed ? "/brand/iparkar-mark-reversed.svg" : "/brand/iparkar-mark-primary.svg"} width={size} height={size} alt="" />
      <span className={`text-[17px] font-semibold tracking-[-0.2px] ${reversed ? "text-white" : "text-ink"}`}>iParkar</span>
    </Link>
  );
}
