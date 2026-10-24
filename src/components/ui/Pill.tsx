const TONES = {
  marigold: "bg-marigold text-ink",
  peach: "bg-peach text-ink",
  sky: "bg-sky-tint text-ink",
  coral: "bg-coral text-ink",
  dark: "bg-midnight text-white",
  neutral: "bg-paper text-graphite border border-hairline",
  strong: "bg-[#dff3e4] text-[#14532d]",
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({ tone = "neutral", children, className = "" }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={`pill ${TONES[tone]} ${className}`}>{children}</span>;
}
