"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Small modal confirmation used by Save & Exit and Cancel in the exam workspace. */
export function ConfirmDialog({ open, id, title, children, cancelLabel, confirmLabel, tone = "primary", busy, onCancel, onConfirm }: {
  open: boolean; id: string; title: string; children: ReactNode; cancelLabel: string; confirmLabel: string;
  tone?: "primary" | "danger"; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} aria-labelledby={`${id}-h`}
      className="w-[min(480px,calc(100vw-32px))] rounded-card border border-hairline p-0 backdrop:bg-ink/40">
      <div className="p-6">
        <h2 id={`${id}-h`} className="text-heading-sm">{title}</h2>
        <div className="mt-2 space-y-2 text-body-sm text-graphite">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onCancel} disabled={busy} autoFocus>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className={tone === "danger" ? "btn bg-vermillion text-white hover:bg-[#c42510] disabled:bg-ink-20 disabled:text-stone" : "btn-primary"}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
