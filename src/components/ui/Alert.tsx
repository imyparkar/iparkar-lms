export function Alert({ tone = "info", title, children }: { tone?: "info" | "error" | "warning" | "success"; title?: string; children?: React.ReactNode }) {
  const styles = {
    info: "bg-sky-tint border-sky-wash/40",
    error: "bg-[#fde8e5] border-coral/40",
    warning: "bg-[#fff4dc] border-marigold/60",
    success: "bg-[#e3f4e8] border-[#2f8f4e]/30",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-button border px-4 py-3 text-body-sm text-ink ${styles}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1 text-graphite" : ""}>{children}</div>}
    </div>
  );
}
