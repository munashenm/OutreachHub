"use client";

import { useActionState, useState, useTransition } from "react";
import { createTemplateAction, draftTemplateAction, updateTemplateAction } from "@/actions/template-actions";
import { Field, Notice, buttonPrimary, buttonSecondary, inputClass, textAreaClass } from "@/components/ui";
import { MERGE_TAGS } from "@/lib/merge";
import { initialActionState } from "@/lib/format";

export function TemplateForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: { name: string; subject: string; body: string; htmlBody?: string };
}) {
  const action = mode === "create" ? createTemplateAction : updateTemplateAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [htmlBody, setHtmlBody] = useState(initial?.htmlBody ?? "");
  const [brief, setBrief] = useState("");
  const [draftMessage, setDraftMessage] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const [drafting, startDraft] = useTransition();

  return (
    <form action={formAction} className="space-y-4">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Field label="Name" name="name" error={state.fieldErrors?.name}>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} required className={inputClass} />
      </Field>
      <Field label="What should this email say?" name="brief">
        <textarea id="brief" name="brief" value={brief} onChange={(event) => setBrief(event.target.value)} className={textAreaClass} placeholder="For example: introduce a quote follow-up for IT equipment buyers." />
      </Field>
      <div>
        <button
          type="button"
          className={buttonSecondary}
          disabled={drafting || pending}
          onClick={() => startDraft(async () => {
            const data = new FormData();
            data.set("brief", brief);
            data.set("name", name);
            data.set("subject", subject);
            data.set("body", body);
            const result = await draftTemplateAction(data);
            setDraftError(result.error ?? result.fieldErrors?.brief);
            setDraftMessage(result.success);
            if (result.draft) {
              setSubject(result.draft.subject);
              setBody(result.draft.body);
            }
          })}
        >
          {drafting ? "Drafting..." : "Draft with AI"}
        </button>
        {draftError ? <p className="mt-2 text-sm text-red-700">{draftError}</p> : null}
        {draftMessage ? <p className="mt-2 text-sm text-muted">{draftMessage}</p> : null}
      </div>
      <Field label="Subject" name="subject" error={state.fieldErrors?.subject}>
        <input id="subject" name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} required className={inputClass} />
      </Field>
      <Field label="Message" name="body" error={state.fieldErrors?.body}>
        <textarea id="body" name="body" value={body} onChange={(event) => setBody(event.target.value)} required className={textAreaClass} />
      </Field>
      <Field label="HTML body" name="htmlBody" error={state.fieldErrors?.htmlBody}>
        <textarea id="htmlBody" name="htmlBody" value={htmlBody} onChange={(event) => setHtmlBody(event.target.value)} className={textAreaClass} placeholder="Optional HTML alternative for promotional campaigns." />
      </Field>
      <p className="text-sm text-muted">Merge tags: {MERGE_TAGS.map((tag) => `{{${tag}}}`).join(", ")}. A draft is not sent until you save it and use it in an active campaign.</p>
      <button className={buttonPrimary} disabled={pending || drafting}>{pending ? "Saving..." : "Save template"}</button>
    </form>
  );
}
