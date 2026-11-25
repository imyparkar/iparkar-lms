"use client";

import { useId, useRef, useState } from "react";

type Issued = { certificate_code: string; name_on_certificate: string; issued_at: string | null };

/**
 * Completion screen: the learner types and confirms their name exactly as it should appear, then generates the
 * certificate. The button is disabled while a request is in flight (the server also de-duplicates concurrent
 * requests). Errors are announced and leave the form filled in so the learner can retry.
 */
export function GenerateCertificate({ course, suggestedName, issued, hint = "for example as on your ID or your PMI application" }:
  { course: string; suggestedName: string; issued: Issued | null; hint?: string }) {
  const id = useId();
  const [name, setName] = useState(suggestedName);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Issued | null>(issued);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!name.trim()) return setError("Enter your name as it should appear on the certificate.");
    if (name.normalize("NFC").replace(/\s+/g, " ").trim() !== confirm.normalize("NFC").replace(/\s+/g, " ").trim()) {
      return setError("The two names don't match. Type the same name in both fields.");
    }
    inFlight.current = true;
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch("/api/certificates/generate", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course, name, confirm }),
        });
        const body = await res.json().catch(() => ({ ok: false, message: "We couldn't reach the server. Check your connection and try again." }));
        if (body.ok) {
          setDone({ certificate_code: body.certificate_code, name_on_certificate: name.normalize("NFC").replace(/\s+/g, " ").trim(), issued_at: new Date().toISOString() });
          if (body.already_issued) window.location.reload();
          return;
        }
        // Another tab or device is generating it right now: wait and ask again.
        if (body.error === "in_progress" && attempt < 3) { await new Promise((r) => setTimeout(r, 2500)); continue; }
        setError(body.message ?? "Something went wrong. Try again.");
        return;
      }
    } catch {
      setError("We couldn't reach the server. Check your connection and try again. Nothing was issued.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <p className="text-body text-ink">
          <span className="font-semibold">Your certificate is ready.</span> Certificate no. <span className="font-mono">{done.certificate_code}</span>, issued to {done.name_on_certificate}.
        </p>
        <div className="flex flex-wrap gap-3">
          <a className="btn-primary" href={`/api/certificates/${done.certificate_code}`} download>Download Certificate</a>
          <a className="btn-outline" href="/certificates">Go to Certificates</a>
        </div>
        <p className="text-body-sm text-graphite">It&apos;s saved to your account. You can download it again from Certificates at any time. The name can&apos;t be changed after issue.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-describedby={`${id}-help`}>
      <p id={`${id}-help`} className="text-body text-graphite">
        Type your name exactly as it should appear, {hint}. Accents, apostrophes and hyphens are fine. It can&apos;t be changed after the certificate is issued.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className="field-label">Name on certificate</label>
          <input id={`${id}-name`} className="field-input" autoComplete="name" maxLength={70} required value={name}
                 onChange={(e) => setName(e.target.value)} aria-invalid={!!error} aria-errormessage={error ? `${id}-err` : undefined} />
        </div>
        <div>
          <label htmlFor={`${id}-confirm`} className="field-label">Confirm name</label>
          <input id={`${id}-confirm`} className="field-input" autoComplete="off" maxLength={70} required value={confirm}
                 onChange={(e) => setConfirm(e.target.value)} onPaste={(e) => e.preventDefault()} aria-invalid={!!error} />
        </div>
      </div>
      {name.trim() && <p className="text-body-sm text-graphite">Preview: <span className="font-serif text-[18px] text-ink">{name.normalize("NFC").replace(/\s+/g, " ").trim()}</span></p>}
      <div aria-live="assertive">{error && <p id={`${id}-err`} className="rounded-small border border-[#c33] bg-[#fff4f4] px-3 py-2 text-body-sm text-[#8a1f1f]">{error}</p>}</div>
      <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Generating your certificate…" : "Generate Certificate"}</button>
    </form>
  );
}
