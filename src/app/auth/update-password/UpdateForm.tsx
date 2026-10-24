"use client";
import { useActionState } from "react";
import { updatePassword, type FormState } from "@/lib/auth/actions";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Alert } from "@/components/ui/Alert";

export function UpdateForm() {
  const [state, action] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div>
        <label className="field-label" htmlFor="password">New password</label>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} />
      </div>
      <div>
        <label className="field-label" htmlFor="confirm">Confirm new password</label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} />
      </div>
      <SubmitButton pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
