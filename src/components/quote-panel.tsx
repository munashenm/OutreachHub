"use client";

import { useActionState, useState } from "react";
import { addQuoteLineAction, removeQuoteLineAction, sendQuoteAction } from "@/actions/quote-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass, textAreaClass } from "@/components/ui";
import { formatCents, formatQuoteEmail, lineTotalCents, quoteTotalCents } from "@/lib/quote";
import { linesExceedingStock } from "@/lib/stock";
import { initialActionState } from "@/lib/format";

type Line = { id: string; description: string; quantity: string; unitPriceCents: number; productId: string | null; specifications: string; imageUrls: string[] };
type ProductOption = { id: string; sku: string; name: string; unitPrice: string; unitPriceCents: number; costCents: number | null; stockLeft: number };

export function QuotePanel({
  rfqId,
  lines,
  currency,
  sent,
  products,
  subject,
  customerName,
  companyName,
}: {
  rfqId: string;
  lines: Line[];
  currency: string;
  sent: boolean;
  products: ProductOption[];
  subject: string;
  customerName: string;
  companyName: string;
}) {
  const [state, formAction, pending] = useActionState(addQuoteLineAction, initialActionState);
  const [productId, setProductId] = useState("");
  const [description, setDescription] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string>();
  const [validDays, setValidDays] = useState("14");
  const [notes, setNotes] = useState("");
  const selected = products.find((item) => item.id === productId);
  const leftByProduct = new Map(products.map((product) => [product.id, product.stockLeft]));
  const shortProductIds = new Set(linesExceedingStock(
    lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
    leftByProduct,
  ));
  const shortNames = products.filter((product) => shortProductIds.has(product.id)).map((product) => product.sku);
  const total = quoteTotalCents(lines.map((line) => ({ quantity: Number(line.quantity), unitPriceCents: line.unitPriceCents })));
  const preview = lines.length === 0 ? "" : formatQuoteEmail({
    subject,
    currency,
    validDays: Number(validDays),
    customerName,
    companyName,
    notes,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceCents: line.unitPriceCents,
      specifications: line.specifications,
      imageUrls: line.imageUrls,
    })),
  });

  return (
    <div className="space-y-4">
      {lines.length === 0 ? <p className="text-sm text-muted">No quote lines yet. Choose a catalogue product or type a line.</p> : (
        <table className="data-table">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th><th></th></tr></thead>
          <tbody>
            {lines.map((line) => {
              const amount = lineTotalCents(Number(line.quantity), line.unitPriceCents);
              return (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{formatCents(line.unitPriceCents, currency)}</td>
                  <td>{amount === null ? "—" : formatCents(amount, currency)}</td>
                  <td>
                    {sent ? null : (
                      <button
                        type="button"
                        className={buttonSecondary}
                        onClick={() => { void removeQuoteLineAction(rfqId, line.id); }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-sm font-medium">Total {total === null ? "—" : formatCents(total, currency)}</p>
      {shortNames.length > 0 ? (
        <p className="text-sm text-amber-900">This draft asks for more than is left of {shortNames.join(", ")}. Sending it will reserve that quantity.</p>
      ) : null}
      {sent ? <p className="text-sm text-muted">This quote was sent in the Gmail thread. Add a new line to start another draft.</p> : (
        <>
          <form action={formAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="rfqId" value={rfqId} />
            <input type="hidden" name="productId" value={productId} />
            <Field label="Catalogue product" name="productPick">
              <select
                className={inputClass}
                value={productId}
                onChange={(event) => {
                  const id = event.target.value;
                  setProductId(id);
                  const product = products.find((item) => item.id === id);
                  if (!product) return;
                  setDescription(`${product.sku} ${product.name}`);
                  setUnitPrice(product.unitPrice);
                }}
              >
                <option value="">Custom line</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name} ({product.stockLeft} left)</option>)}
              </select>
            </Field>
            {selected?.costCents != null ? <p className="text-sm text-muted md:col-span-2">Selected supplier cost {formatCents(selected.costCents, currency)}. The unit price stays the catalogue sell price until you change it.</p> : null}
            <Field label="Description" name="description" error={state.fieldErrors?.description}>
              <input id="description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} required className={inputClass} />
            </Field>
            <Field label="Quantity" name="quantity" error={state.fieldErrors?.quantity}>
              <input id="quantity" name="quantity" defaultValue="1" required className={inputClass} />
            </Field>
            <Field label="Unit price (ZAR)" name="unitPrice" error={state.fieldErrors?.unitPrice}>
              <input id="unitPrice" name="unitPrice" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} required className={inputClass} />
            </Field>
            {state.error ? <p className="text-sm text-red-700 md:col-span-2">{state.error}</p> : null}
            <button className={buttonSecondary} disabled={pending}>{pending ? "Adding..." : "Add line"}</button>
          </form>
          <form
            className="grid gap-3 md:grid-cols-2"
            action={async (formData) => {
              setSending(true);
              const result = await sendQuoteAction(initialActionState, formData);
              setSendMessage(result.error ?? result.success);
              setSending(false);
            }}
          >
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field label="Valid for" name="validDays">
              <select id="validDays" name="validDays" className={inputClass} value={validDays} onChange={(event) => setValidDays(event.target.value)}>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
              </select>
            </Field>
            <Field label="Terms on the quotation" name="notes">
              <textarea id="notes" name="notes" className={textAreaClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <button className={buttonPrimary} disabled={sending || lines.length === 0}>{sending ? "Sending..." : "Send quotation"}</button>
          </form>
          {sendMessage ? <p className="text-sm text-muted">{sendMessage}</p> : null}
          {preview ? <pre className="whitespace-pre-wrap rounded-lg bg-canvas p-4 text-sm">{preview}</pre> : null}
        </>
      )}
    </div>
  );
}
