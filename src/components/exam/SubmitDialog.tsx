"use client";
import { useEffect, useRef } from "react";

export function SubmitDialog({ open, total, answered, flagged, unansweredList, flaggedList, pendingSync, onCancel, onConfirm, onGo }: {
  open: boolean; total: number; answered: number; flagged: number; unansweredList: number[]; flaggedList: number[];
  pendingSync: number; onCancel: () => void; onConfirm: () => void; onGo: (position: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const Jump = ({ list }: { list: number[] }) => (
    <span className="mt-1 flex flex-wrap gap-1">
      {list.slice(0, 30).map((p) => (
        <button key={p} type="button" className="rounded-small border border-ink-20 px-2 py-0.5 text-caption hover:bg-paper" onClick={() => onGo(p)}>{p}</button>
      ))}
      {list.length > 30 && <span className="text-caption text-slate">+{list.length - 30} more</span>}
    </span>
  );

  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="submit-h"
      className="w-[min(520px,calc(100vw-32px))] rounded-card border border-hairline p-0 backdrop:bg-ink/40">
      <div className="p-6">
        <h2 id="submit-h" className="text-heading-sm">Submit your exam?</h2>
        <p className="mt-1 text-body-sm text-graphite">After you submit, answers can’t be changed.</p>
        <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
          {[["Total", total], ["Answered", answered], ["Unanswered", total - answered], ["Flagged", flagged]].map(([k, v]) => (
            <div key={k as string} className="rounded-button bg-paper p-3">
              <dt className="text-caption text-slate">{k}</dt>
              <dd className="text-[22px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {unansweredList.length > 0 && (
          <p className="mt-4 text-body-sm">Unanswered questions count as incorrect. Go to: <Jump list={unansweredList} /></p>
        )}
        {flaggedList.length > 0 && <p className="mt-3 text-body-sm">Flagged for review: <Jump list={flaggedList} /></p>}
        {pendingSync > 0 && (
          <p className="mt-3 rounded-button bg-[#fff4dc] px-3 py-2 text-body-sm">{pendingSync} change{pendingSync === 1 ? " is" : "s are"} still syncing. We’ll finish saving before submitting.</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onCancel} autoFocus>Return to exam</button>
          <button type="button" className="btn-primary" onClick={onConfirm}>Submit exam</button>
        </div>
      </div>
    </dialog>
  );
}
