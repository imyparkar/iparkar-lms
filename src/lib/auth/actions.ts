"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/env";

export type FormState = { error?: string; message?: string; fields?: Record<string, string> };

const GENERIC_LOGIN_ERROR = "That username/email and password combination didn’t work.";
const CAPTCHA_ERROR = "Please complete the security check and try again.";

/** Turnstile token added to the form by <Turnstile/>; Supabase verifies it when CAPTCHA protection is on. */
function captchaToken(form: FormData): string | undefined {
  const t = form.get("cf-turnstile-response");
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

function isCaptchaError(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(error && (error.code === "captcha_failed" || error.message?.toLowerCase().includes("captcha")));
}

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

async function clientIp() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** true = allowed. Fails open only if the limiter itself is unreachable. */
async function allow(bucket: string, max: number, windowSeconds: number) {
  try {
    const { data, error } = await getServiceClient().rpc("hit_rate_limit", {
      p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds,
    });
    return error ? true : Boolean(data);
  } catch {
    return true;
  }
}

const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your username or email.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
});

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ identifier: form.get("identifier"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { identifier, password } = parsed.data;

  const ip = await clientIp();
  if (!(await allow(`login:ip:${ip}`, 30, 900)) || !(await allow(`login:id:${identifier.toLowerCase()}`, 10, 900))) {
    return { error: "Too many sign-in attempts. Wait 15 minutes and try again." };
  }

  let email = identifier;
  if (!identifier.includes("@")) {
    // username → email on the server only; no public username directory
    const { data } = await getServiceClient().rpc("resolve_login_email", { p_identifier: identifier });
    if (!data) return { error: GENERIC_LOGIN_ERROR, fields: { identifier } };
    email = data as string;
  }

  const supabase = await getServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken(form) } });
  if (isCaptchaError(error)) return { error: CAPTCHA_ERROR, fields: { identifier } };
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("email not confirmed"))
      return { error: "Confirm your email first — check your inbox for the link.", fields: { identifier } };
    return { error: GENERIC_LOGIN_ERROR, fields: { identifier } };
  }

  const { data: profile } = await supabase.from("profiles").select("status").eq("id", data.user.id).single();
  if (profile?.status !== "active") {
    await supabase.auth.signOut();
    return { error: "This account is suspended. Contact imran@iparkar.com." };
  }
  redirect(safeNext(form.get("next")));
}

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name.").max(120),
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/, "Usernames use 3–32 letters, numbers, dots, dashes or underscores."),
  email: z.email("Enter a valid email."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  terms: z.literal("on", { error: "Accept the terms to continue." }),
});

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(["full_name", "username", "email", "password", "terms"].map((k) => [k, k === "password" ? form.get(k) ?? undefined : (form.get(k) as string | null)?.trim() ?? undefined]));
  const parsed = signupSchema.safeParse(raw);
  const fields = { full_name: String(raw.full_name ?? ""), username: String(raw.username ?? ""), email: String(raw.email ?? "") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const ip = await clientIp();
  if (!(await allow(`signup:ip:${ip}`, 10, 3600))) return { error: "Too many sign-ups from this network. Try later.", fields };

  const svc = getServiceClient();
  const { data: taken } = await svc.from("profiles").select("id").ilike("username", parsed.data.username).maybeSingle();
  if (taken) return { error: "That username is taken.", fields };

  const supabase = await getServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      captchaToken: captchaToken(form),
      data: { username: parsed.data.username, full_name: parsed.data.full_name },
      emailRedirectTo: `${SITE_URL}/auth/confirm?next=/dashboard`,
    },
  });
  if (isCaptchaError(error)) return { error: CAPTCHA_ERROR, fields };
  if (error) return { error: error.message.includes("Password") ? error.message : "We couldn’t create the account. Try again.", fields };
  return { message: "Check your email to confirm your account, then sign in." };
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!email.success) return { error: "Enter the email on your account." };
  const ip = await clientIp();
  if (await allow(`reset:ip:${ip}`, 5, 3600)) {
    const supabase = await getServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${SITE_URL}/auth/callback?next=/auth/update-password`,
      captchaToken: captchaToken(form),
    });
    if (isCaptchaError(error)) return { error: CAPTCHA_ERROR };
  }
  // same answer whether or not the account exists
  return { message: "If an account uses that email, a reset link is on its way." };
}

export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const pw = String(form.get("password") ?? "");
  if (pw.length < 10) return { error: "Use at least 10 characters." };
  if (pw !== String(form.get("confirm") ?? "")) return { error: "The passwords don’t match." };
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect("/dashboard?password=updated");
}
