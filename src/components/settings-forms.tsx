"use client";

import { useActionState } from "react";
import { createWorkspaceAction, renameWorkspaceAction } from "@/actions/settings-actions";
import { Field, Notice, buttonPrimary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";

export function RenameWorkspaceForm({ name, canManage }: { name: string; canManage: boolean }) {
  const [state, action, pending] = useActionState(renameWorkspaceAction, initialActionState);
  if (!canManage) return <p className="text-sm text-muted">Only owners and admins can rename the workspace.</p>;
  return (
    <form action={action} className="max-w-md space-y-3">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Field label="Workspace name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" defaultValue={name} className={inputClass} />
      </Field>
      <button className={buttonPrimary} disabled={pending}>Save name</button>
    </form>
  );
}

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, initialActionState);
  return (
    <form action={action} className="max-w-md space-y-3">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="New workspace name" name="name" id="new-workspace" error={state.fieldErrors?.name}>
        <input id="new-workspace" name="name" className={inputClass} />
      </Field>
      <button className={buttonPrimary} disabled={pending}>Create and switch</button>
    </form>
  );
}
