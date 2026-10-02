"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/format";
import { safeNextPath } from "@/lib/password";
import { runAction } from "@/lib/run-action";
import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  readForm,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validators";
import {
  loginAccount,
  logoutAccount,
  registerAccount,
  registrationOpen,
  requestPasswordReset,
  resetPassword,
} from "@/services/auth-service";

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = registerSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    if (!(await registrationOpen())) {
      return { error: "The Urban Focus account already exists. Sign in instead." };
    }
    await registerAccount(parsed.data);
    redirect("/dashboard");
  });
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = loginSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await loginAccount(parsed.data.email, parsed.data.password);
    redirect(safeNextPath(parsed.data.next));
  });
}

export async function logoutAction() {
  await logoutAccount();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    const result = await requestPasswordReset(parsed.data.email);
    return {
      success: "If an account exists for that email, a reset link has been sent.",
      devResetUrl: result.devResetUrl,
    };
  });
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const parsed = resetPasswordSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    await resetPassword(parsed.data.token, parsed.data.password);
    redirect("/login?status=reset");
  });
}
