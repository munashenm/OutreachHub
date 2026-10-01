"use client";

import { useActionState } from "react";
import { saveQuoteSettingsAction } from "@/actions/settings-actions";
import { Field, buttonPrimary, inputClass, textAreaClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";
import type { PublicQuoteSettings } from "@/lib/quote-settings";

export function QuoteSettingsForm({ settings, canManage }: { settings: PublicQuoteSettings; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveQuoteSettingsAction, initialActionState);
  if (!canManage) return <p className="text-sm text-muted">An owner or admin can change quotation settings.</p>;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <Field label="Legal name" name="legalName"><input id="legalName" name="legalName" defaultValue={settings.legalName} className={inputClass} required /></Field>
      <Field label="Phone" name="phone"><input id="phone" name="phone" defaultValue={settings.phone} className={inputClass} /></Field>
      <Field label="Email" name="email"><input id="email" name="email" defaultValue={settings.email} className={inputClass} /></Field>
      <Field label="Website" name="website"><input id="website" name="website" defaultValue={settings.website} className={inputClass} /></Field>
      <Field label="Address" name="address"><textarea id="address" name="address" defaultValue={settings.addressLines.join("\n")} className={textAreaClass} /></Field>
      <Field label="VAT number" name="vatNumber"><input id="vatNumber" name="vatNumber" defaultValue={settings.vatNumber} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showVatNumber" value="true" defaultChecked={settings.showVatNumber} /> Show VAT number on quotations</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showBanking" value="true" defaultChecked={settings.showBanking} /> Show banking details on quotations</label>
      <Field label="Bank" name="bankName"><input id="bankName" name="bankName" defaultValue={settings.bankName} className={inputClass} /></Field>
      <Field label="Account name" name="accountName"><input id="accountName" name="accountName" defaultValue={settings.accountName} className={inputClass} /></Field>
      <Field label="Account number" name="accountNumber"><input id="accountNumber" name="accountNumber" type="password" autoComplete="off" placeholder={settings.hasAccountNumber ? "Saved. Enter a new value to replace it." : ""} className={inputClass} /></Field>
      <Field label="Branch code" name="branchCode"><input id="branchCode" name="branchCode" type="password" autoComplete="off" placeholder={settings.hasBranchCode ? "Saved. Enter a new value to replace it." : ""} className={inputClass} /></Field>
      <Field label="Account type" name="accountType"><input id="accountType" name="accountType" defaultValue={settings.accountType} className={inputClass} /></Field>
      <Field label="Availability" name="availability"><textarea id="availability" name="availability" defaultValue={settings.availability} className={textAreaClass} /></Field>
      <Field label="Lead time" name="leadTime"><textarea id="leadTime" name="leadTime" defaultValue={settings.leadTime} className={textAreaClass} /></Field>
      <Field label="Payment terms" name="paymentTerms"><textarea id="paymentTerms" name="paymentTerms" defaultValue={settings.paymentTerms} className={textAreaClass} /></Field>
      <Field label="Validity" name="validity"><textarea id="validity" name="validity" defaultValue={settings.validity} className={textAreaClass} /></Field>
      <Field label="Delivery" name="delivery"><textarea id="delivery" name="delivery" defaultValue={settings.delivery} className={textAreaClass} /></Field>
      <Field label="New / genuine" name="newGenuine"><textarea id="newGenuine" name="newGenuine" defaultValue={settings.newGenuine} className={textAreaClass} /></Field>
      <Field label="Substitution" name="substitution"><textarea id="substitution" name="substitution" defaultValue={settings.substitution} className={textAreaClass} /></Field>
      <Field label="Taxes / duties" name="taxes"><textarea id="taxes" name="taxes" defaultValue={settings.taxes} className={textAreaClass} /></Field>
      <Field label="Warranty" name="warranty"><textarea id="warranty" name="warranty" defaultValue={settings.warranty} className={textAreaClass} /></Field>
      <Field label="Export note" name="exportNote"><textarea id="exportNote" name="exportNote" defaultValue={settings.exportNote} className={textAreaClass} /></Field>
      {state.error ? <p className="text-sm text-red-700 md:col-span-2">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-800 md:col-span-2">{state.success}</p> : null}
      <button className={buttonPrimary} disabled={pending}>{pending ? "Saving..." : "Save quotation settings"}</button>
    </form>
  );
}
