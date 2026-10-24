"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signIn, type FormState } from "@/lib/auth/actions";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      {notice && !state.error && <Alert tone="info">{notice}</Alert>}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="field-label" htmlFor="identifier">Username or email</label>
        <input id="identifier" name="identifier" className="field-input" autoComplete="username" required
               defaultValue={state.fields?.identifier} autoFocus />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="field-label" htmlFor="password">Password</label>
          <Link href="/reset-password" className="link text-body-sm">Forgot password?</Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" />
      </div>
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
