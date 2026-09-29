"use client";

import { useActionState } from "react";
import {
  forgotPasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
} from "@/actions/auth-actions";
import { initialActionState } from "@/lib/format";
import { Field, Notice, buttonPrimary, inputClass } from "@/components/ui";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <input type="hidden" name="next" value={nextPath ?? ""} />
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label="Password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <button className={`${buttonPrimary} w-full`} disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="Your name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" required className={inputClass} />
      </Field>
      <Field label="Work email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label="Password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" required className={inputClass} />
      </Field>
      <Field label="Workspace name" name="workspaceName" error={state.fieldErrors?.workspaceName}>
        <input id="workspaceName" name="workspaceName" required defaultValue="Urban Focus" className={inputClass} />
      </Field>
      <button className={`${buttonPrimary} w-full`} disabled={pending}>
        {pending ? "Creating..." : "Create store account"}
      </button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      {state.devResetUrl ? (
        <Notice tone="info">
          Development reset link: <a className="underline" href={state.devResetUrl}>{state.devResetUrl}</a>
        </Notice>
      ) : null}
      <Field label="Email" name="email" error={state.fieldErrors?.email}>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <button className={`${buttonPrimary} w-full`} disabled={pending}>
        {pending ? "Preparing..." : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialActionState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" required className={inputClass} />
      </Field>
      <Field label="Confirm password" name="confirmPassword" error={state.fieldErrors?.confirmPassword}>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={inputClass} />
      </Field>
      <button className={`${buttonPrimary} w-full`} disabled={pending}>
        {pending ? "Saving..." : "Update password"}
      </button>
    </form>
  );
}
