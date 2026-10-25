import { Calculator, Clock, Flag, CheckCircle2 } from "lucide-react";

/**
 * Decorative product illustration for the sign-in / sign-up side panel.
 * Pure markup (no images to load), built from iParkar design tokens.
 * Hidden from assistive technology — the panel's text carries the meaning.
 */
export function AuthArtwork() {
  const options = ["w-[78%]", "w-[64%]", "w-[86%]", "w-[58%]"];
  const domains = [
    { label: "Risk Management", pct: 84, tone: "bg-sky-wash" },
    { label: "Program Management", pct: 71, tone: "bg-marigold" },
    { label: "Emergency Management", pct: 66, tone: "bg-marigold" },
    { label: "Applied Science", pct: 52, tone: "bg-coral" },
  ];

  return (
    <div aria-hidden="true" className="relative mx-auto h-[340px] w-full max-w-[520px] select-none">
      {/* Background: dot grid + soft glows */}
      <div
        className="absolute inset-0 rounded-[28px] opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />
      <div className="absolute -left-6 top-6 h-48 w-48 rounded-full bg-action/30 blur-3xl" />
      <div className="absolute bottom-0 right-4 h-40 w-40 rounded-full bg-marigold/20 blur-3xl" />

      {/* Exam question card */}
      <div className="absolute left-0 top-4 w-[64%] -rotate-[2deg] rounded-card bg-white p-5 text-ink shadow-[0_24px_48px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between">
          <span className="text-caption text-graphite">CSP · Mixed exam</span>
          <span className="inline-flex items-center gap-1 rounded-pill bg-sky-tint px-2 py-0.5 text-caption text-midnight">
            <Clock size={12} strokeWidth={2.25} />
            01:24:18
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-body-sm font-semibold">Question 42 of 100</span>
          <Flag size={14} className="text-marigold" fill="currentColor" />
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="h-2 w-full rounded-pill bg-ink/10" />
          <div className="h-2 w-[82%] rounded-pill bg-ink/10" />
        </div>
        <div className="mt-4 space-y-2">
          {options.map((w, i) => {
            const selected = i === 2;
            return (
              <div
                key={i}
                className={`flex items-center gap-2.5 rounded-button border px-2.5 py-2 ${
                  selected ? "border-action bg-sky-tint" : "border-hairline"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold ${
                    selected ? "border-action bg-action text-white" : "border-ink/25 text-graphite"
                  }`}
                >
                  {"ABCD"[i]}
                </span>
                <div className={`h-1.5 rounded-pill ${selected ? "bg-action/50" : "bg-ink/10"} ${w}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Calculator chip */}
      <div className="absolute right-[6%] top-0 rotate-[4deg] rounded-card bg-charcoal/90 p-3 shadow-[0_16px_32px_rgba(0,0,0,0.35)] ring-1 ring-white/10">
        <div className="flex items-center gap-1.5 text-caption text-white/70">
          <Calculator size={13} /> Calculator
        </div>
        <div className="mt-2 rounded-small bg-white/10 px-2 py-1 text-right font-mono text-[13px] text-white">
          √(2.5e3) = 50
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {["x²", "√", "π", "log", "sin", "ln", "eˣ", "n!"].map((k) => (
            <span key={k} className="rounded-[4px] bg-white/10 px-1.5 py-0.5 text-center text-[10px] text-white/85">
              {k}
            </span>
          ))}
        </div>
      </div>

      {/* Domain analytics card */}
      <div className="absolute bottom-0 right-0 w-[60%] rotate-[1.5deg] rounded-card bg-[#0b1550] p-4 shadow-[0_24px_48px_rgba(0,0,0,0.4)] ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="text-caption text-white/70">Domain performance</span>
          <span className="inline-flex items-center gap-1 text-caption text-sky-wash">
            <CheckCircle2 size={12} /> 74%
          </span>
        </div>
        <div className="mt-3 space-y-2.5">
          {domains.map((d) => (
            <div key={d.label}>
              <div className="flex justify-between text-[11px] text-white/80">
                <span>{d.label}</span>
                <span className="tabular-nums">{d.pct}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-pill bg-white/10">
                <div className={`h-1.5 rounded-pill ${d.tone}`} style={{ width: `${d.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
