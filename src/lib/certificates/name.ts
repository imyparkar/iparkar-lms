import { unsupportedCharacters } from "./pdf";

/**
 * Name on certificate: what the learner typed, normalised to NFC with invisible/control characters removed and
 * whitespace collapsed. Letters and combining marks from any script the certificate font covers, with single
 * spaces, apostrophes (' or ’), hyphens and full stops between them ("Zoë O’Brien-Núñez", "Dée-Ann St. John").
 * The database re-checks the basic rules (study_certificate_name_ok).
 */
const NAME_RE = /^[\p{L}\p{M}](?:[\p{L}\p{M}]|[ '’.\-‐](?=[\p{L}\p{M}])|\.(?= ))*\.?$/u;

export function normalizeName(s: unknown) {
  return String(s ?? "").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu, "")
    .replace(/\s+/gu, " ").trim();
}

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

export function validateCertificateName(name: unknown, confirmName: unknown, serifFont?: Uint8Array): NameCheck {
  const v = normalizeName(name), c = normalizeName(confirmName);
  const len = [...v].length;
  if (!v) return { ok: false, error: "Enter your name as it should appear on the certificate." };
  if (len < 2) return { ok: false, error: "The name is too short." };
  if (len > 70) return { ok: false, error: "The name is longer than 70 characters. Use the form of your name you use on official documents." };
  if (!NAME_RE.test(v)) return { ok: false, error: "Use letters, spaces, apostrophes, hyphens and full stops only, with no numbers or other symbols." };
  if ([...v.matchAll(/\p{L}/gu)].length < 2) return { ok: false, error: "The name must contain at least two letters." };
  if (v !== c) return { ok: false, error: "The two names don't match. Type the same name in both fields." };
  if (serifFont) {
    const bad = unsupportedCharacters(v, serifFont);
    if (bad.length) return { ok: false, error: `These characters can't be printed on the certificate: ${bad.join(" ")}. Use the Latin-script form of your name, as on your ID.` };
  }
  return { ok: true, value: v };
}
