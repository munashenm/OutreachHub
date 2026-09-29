"use client";

import { useActionState, useTransition } from "react";
import { createProspectFromMessageAction, createRfqAction, ignoreMessageAction, linkProspectAction, replyAction, setCategoryAction } from "@/actions/inbox-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass, textAreaClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";
import { INBOX_CATEGORIES, INBOX_CATEGORY_LABELS, type InboxCategory } from "@/lib/labels";

export function CategorySelect({ messageId, category }: { messageId: string; category: InboxCategory | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      aria-label="Category"
      className={inputClass}
      defaultValue={category ?? ""}
      disabled={pending}
      onChange={(event) => {
        const value = event.target.value;
        if (!value) return;
        startTransition(async () => {
          await setCategoryAction(messageId, value);
        });
      }}
    >
      <option value="">Uncategorised</option>
      {INBOX_CATEGORIES.map((item) => <option key={item} value={item}>{INBOX_CATEGORY_LABELS[item]}</option>)}
    </select>
  );
}

export function UnknownSenderActions({ messageId }: { messageId: string }) {
  const [state, formAction, pending] = useActionState(linkProspectAction, initialActionState);
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <p className="font-medium">Unknown sender</p>
      <div className="flex flex-wrap gap-2">
        <form action={async () => { await createProspectFromMessageAction(messageId); }}>
          <button className={buttonPrimary}>Create Prospect</button>
        </form>
        <form action={async () => { await ignoreMessageAction(messageId); }}>
          <button className={buttonSecondary}>Ignore</button>
        </form>
      </div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="messageId" value={messageId} />
        <Field label="Link existing prospect by email" name="email">
          <input id="email" name="email" type="email" required className={inputClass} />
        </Field>
        <button className={buttonSecondary} disabled={pending}>Link Existing Prospect</button>
      </form>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
    </div>
  );
}

export function CreateRfqButton({ messageId }: { messageId: string }) {
  return (
    <form action={async () => { await createRfqAction(messageId); }}>
      <button className={buttonSecondary}>Create RFQ</button>
    </form>
  );
}

export function ReplyForm({
  messageId,
  to,
  subject,
}: {
  messageId: string;
  to: string;
  subject: string;
}) {
  const [state, formAction, pending] = useActionState(replyAction, initialActionState);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="messageId" value={messageId} />
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-muted">{state.success}</p> : null}
      <Field label="To" name="to" error={state.fieldErrors?.to}>
        <input id="to" name="to" defaultValue={to} required className={inputClass} />
      </Field>
      <Field label="CC" name="cc" error={state.fieldErrors?.cc}>
        <input id="cc" name="cc" className={inputClass} />
      </Field>
      <Field label="Subject" name="subject" error={state.fieldErrors?.subject}>
        <input id="subject" name="subject" defaultValue={subject} required className={inputClass} />
      </Field>
      <Field label="Body" name="body" error={state.fieldErrors?.body}>
        <textarea id="body" name="body" required className={textAreaClass} />
      </Field>
      <button className={buttonPrimary} disabled={pending}>{pending ? "Sending..." : "Send reply"}</button>
    </form>
  );
}
