"use client";
import { useActionState } from "react";
import { signUp, type FormState } from "@/lib/auth/actions";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";
import { Turnstile } from "@/components/ui/Turnstile";
import { MARKETING_URL } from "@/lib/env";

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  if (state.message) return <Alert tone="success" title="Almost there">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div>
        <label className="field-label" htmlFor="full_name">Full name</label>
        <input id="full_name" name="full_name" className="field-input" autoComplete="name" required defaultValue={state.fields?.full_name} />
      </div>
      <div>
        <label className="field-label" htmlFor="username">Username</label>
        <input id="username" name="username" className="field-input" autoComplete="username" required
               pattern="[A-Za-z0-9._-]{3,32}" defaultValue={state.fields?.username} aria-describedby="username-hint" />
        <p id="username-hint" className="mt-1 text-caption text-graphite">You can sign in with this or your email.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="field-input" autoComplete="email" required defaultValue={state.fields?.email} />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} />
        <p className="mt-1 text-caption text-graphite">At least 10 characters.</p>
      </div>
      <label className="flex items-start gap-3 text-body-sm text-graphite">
        <input type="checkbox" name="terms" className="mt-1 h-4 w-4 accent-[#02093a]" required />
        <span>I agree to the <a className="link" href={`${MARKETING_URL}/terms.html`} target="_blank" rel="noreferrer">terms</a> and{" "}
          <a className="link" href={`${MARKETING_URL}/privacy.html`} target="_blank" rel="noreferrer">privacy notice</a>.</span>
      </label>
      <Turnstile resetKey={state} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
