"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startCheckout } from "@/lib/payments/actions";
import { Alert } from "@/components/ui/Alert";

type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void };
declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve(true), { once: true });
    s.addEventListener("error", () => resolve(false), { once: true });
    if (!existing) { s.src = SCRIPT; s.async = true; document.body.appendChild(s); }
  });
}

type Status = { tone: "info" | "success" | "error" | "warning"; title: string; body?: string } | null;

/** Opens Razorpay Checkout for one package (practice exams or a study course); access opens once the server confirms the payment. */
export function RazorpayButton({ code, days, label, successHref, className = "btn-dark" }:
  { code: string; days: number; label: string; successHref: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function confirm(r: RazorpaySuccess) {
    setStatus({ tone: "info", title: "Confirming your payment…", body: "Please keep this page open." });
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch("/api/payments/razorpay/verify", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok && !json.pending) {
        setStatus({ tone: "success", title: "Payment received — your access is open." });
        router.replace(successHref);
        router.refresh();
        return;
      }
      if (res && res.status >= 400 && res.status < 500 && res.status !== 409) break;
      await new Promise((ok) => setTimeout(ok, 2500));
    }
    setStatus({
      tone: "warning", title: "Payment received — access is on its way",
      body: `It can take a few minutes to confirm. Refresh this page shortly. If access hasn’t opened within 30 minutes, email support@iparkar.com with payment ID ${r.razorpay_payment_id}.`,
    });
    setBusy(false);
  }

  async function pay() {
    setBusy(true);
    setStatus(null);
    const [order, loaded] = await Promise.all([startCheckout(code, days), loadScript()]);
    if (order.error || !order.orderId) { setStatus({ tone: "error", title: order.error ?? "Payment couldn’t start." }); setBusy(false); return; }
    if (!loaded || !window.Razorpay) {
      setStatus({ tone: "error", title: "The payment window couldn’t load.", body: "Check your connection or disable content blockers for this page, then try again." });
      setBusy(false);
      return;
    }
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "iParkar Learning",
      description: order.description,
      image: "https://app.iparkar.com/apple-touch-icon.png",
      prefill: order.prefill,
      notes: { course: code, days: String(days) },
      theme: { color: "#02093a" },
      handler: (r: RazorpaySuccess) => { void confirm(r); },
      modal: { ondismiss: () => setBusy(false), confirm_close: true },
    });
    rzp.on("payment.failed", (r) => {
      setStatus({
        tone: "error", title: "Payment didn’t go through",
        body: `${r.error?.description ?? "Your bank declined the payment."} You haven’t been charged for a failed payment; if money left your account it is refunded automatically. You can try again or use another method.`,
      });
    });
    rzp.open();
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={pay} disabled={busy} className={`${className} disabled:opacity-60`} aria-busy={busy}>
        {busy ? "Opening secure payment…" : label}
      </button>
      {status && <Alert tone={status.tone} title={status.title}>{status.body}</Alert>}
    </div>
  );
}
