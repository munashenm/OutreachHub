import Link from "next/link";
import { analyseDocumentsAction, correctAnalysisAction, findDocumentProductsAction } from "@/actions/document-actions";
import { ApproveSendButton, GenerateQuoteButton } from "@/components/document-analysis-actions";
import { buttonSecondary } from "@/components/ui";
import type { StoredDocumentAnalysis } from "@/lib/document-analysis";
import { formatCents } from "@/lib/quote";

export function DocumentAnalysisPanel({ rfqId, documents, sendBlocked, quotePreview }: { rfqId: string; documents: Array<{ id: string; record: StoredDocumentAnalysis; approvedById: string }>; sendBlocked: string; quotePreview: Array<{ description: string; quantity: string; unitPriceCents: number; scheduleNumber: string }> }) {
  const combined = documents.map((document) => document.record);
  const items = combined.flatMap((document) => document.items);
  const matches = combined.flatMap((document) => document.matches);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <form action={analyseDocumentsAction}><input type="hidden" name="id" value={rfqId} /><button className={buttonSecondary}>Analyse Documents</button></form>
        <form action={analyseDocumentsAction}><input type="hidden" name="id" value={rfqId} /><button className={buttonSecondary}>Re-analyse</button></form>
        <form action={findDocumentProductsAction}><input type="hidden" name="id" value={rfqId} /><button className={buttonSecondary}>Find Products</button></form>
        <GenerateQuoteButton rfqId={rfqId} />
        <ApproveSendButton rfqId={rfqId} disabled={Boolean(sendBlocked)} reason={sendBlocked} />
        <Link className={buttonSecondary} href={`/api/rfqs/${rfqId}/tender-pack`}>Download Tender Pack</Link>
      </div>
      {documents.length === 0 ? <p className="text-sm text-muted">No document analysis yet. Analyse Documents reads the email and any saved PDF, Word, Excel, CSV, or image attachment.</p> : null}
      {combined.map((document, index) => (
        <div key={`${document.referenceNumber}-${index}`} className="space-y-3 text-sm">
          <h3 className="font-semibold">Request summary</h3>
          <p>{document.documentType}{document.referenceNumber ? ` · ${document.referenceNumber}` : ""} · {document.responseMode}</p>
          <p>{document.requestTitle}</p>
          <p><span className="text-muted">Customer: </span>{document.customerName || "Not stated"}</p>
          <p><span className="text-muted">Submission deadline: </span>{[document.closingDate, document.closingTime].filter(Boolean).join(" ") || "Not stated"}</p>
          <p><span className="text-muted">VAT: </span>{document.vatTreatment || "Not stated"} · <span className="text-muted">Currency: </span>{document.currency || "Not stated"}</p>
          <p><span className="text-muted">Submission: </span>{document.submissionMethod || "Not stated"}</p>
          <EditField rfqId={rfqId} analysisId={documents[index]?.id ?? ""} field="referenceNumber" label="Reference" value={document.referenceNumber} />
        </div>
      ))}
      <div>
        <h3 className="font-semibold">Extracted products</h3>
        {items.length === 0 ? <p className="mt-2 text-sm text-muted">No product line was stated.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {items.map((item, index) => (
              <li key={`${item.sourceDocument}-${item.lineNumber}-${index}`}>
                {item.lineNumber || index + 1}. {item.quantity == null ? "" : `${item.quantity} ${item.unit} `}{item.description}
                <span className="text-muted"> · {item.sourceDocument}{item.sourcePage == null ? "" : ` page ${item.sourcePage}`} · confidence {item.extractionConfidence}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold">Technical requirements</h3>
        <ul className="mt-2 space-y-1 text-sm">{items.flatMap((item) => Object.entries(item.mandatorySpecs).map(([key, value]) => <li key={`${item.lineNumber}-${key}`}>{key}: {value}</li>))}</ul>
      </div>
      <List title="Mandatory requirements" values={combined.flatMap((document) => document.mandatoryRequirements.map((item) => `${item.value} (${item.sourceDocument} p.${item.sourcePage ?? "?"})`))} />
      <List title="Compliance checklist" values={combined.flatMap((document) => [...document.returnableDocuments, ...document.eligibilityRequirements].map((item) => item.value))} />
      <div>
        <h3 className="font-semibold">Product matches</h3>
        {matches.length === 0 ? <p className="mt-2 text-sm text-muted">Find Products has not been run.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {matches.map((match, index) => <li key={`${match.lineNumber}-${index}`}><span className="font-medium">{match.match}.</span> {match.explanation} {match.pricedFromSupplier ? "Supplier cost can be used." : match.observedPriceCents ? "Observed web price is not a supplier cost." : "No supplier cost."}</li>)}
          </ul>
        )}
      </div>
      <List title="Pricing sources" values={matches.filter((match) => match.sourceName).map((match) => `${match.sourceName}${match.sourceUrl ? ` ${match.sourceUrl}` : ""} · ${match.pricedFromSupplier ? "supplier cost" : "not a confirmed supplier cost"} · ${match.observedAt}`)} />
      <div>
        <h3 className="font-semibold">Customer pricing schedule</h3>
        {items.length === 0 ? <p className="mt-2 text-sm text-muted">No lines were stated.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {items.map((item, index) => {
              const match = matches.find((entry) => entry.lineNumber === item.lineNumber);
              return (
                <li key={`schedule-${item.lineNumber}-${index}`}>
                  {item.lineNumber || index + 1}. {item.description}
                  {item.quantity == null ? "" : ` · ${item.quantity} ${item.unit}`}
                  {match?.productName ? ` · ${match.productName} ${match.sku}` : ""}
                  <span className="block text-muted">{priceLine(match)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold">Quote preview</h3>
        {quotePreview.length === 0 ? <p className="mt-2 text-sm text-muted">No priced quotation lines yet.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {quotePreview.map((line) => <li key={`${line.scheduleNumber}-${line.description}`}>{line.scheduleNumber || "-"}. {line.quantity} × {line.description} — {formatCents(line.unitPriceCents)} excluding VAT</li>)}
          </ul>
        )}
      </div>
      <List title="Extraction warnings" values={combined.flatMap((document) => [...document.warnings, ...document.ambiguities])} />
    </section>
  );
}

function priceLine(match: { supplierCostCents: number | null; shippingCostCents: number | null; otherCostCents: number | null; configuredMarginPercent: number | null; sellingPriceExVatCents: number | null; vatCents: number | null; sellingPriceInclVatCents: number | null; lineTotalCents: number | null } | undefined) {
  if (!match) return "Not priced.";
  const money = (cents: number | null) => cents == null ? "not stated" : formatCents(cents);
  return `Supplier ${money(match.supplierCostCents)} · Shipping ${money(match.shippingCostCents)} · Other ${money(match.otherCostCents)} · Margin ${match.configuredMarginPercent == null ? "not stated" : `${match.configuredMarginPercent}%`} · Ex VAT ${money(match.sellingPriceExVatCents)} · VAT ${money(match.vatCents)} · Incl VAT ${money(match.sellingPriceInclVatCents)} · Line total ${money(match.lineTotalCents)}`;
}

function List({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      {values.length === 0 ? <p className="mt-2 text-sm text-muted">None stated.</p> : <ul className="mt-2 space-y-1 text-sm">{values.map((value) => <li key={value}>{value}</li>)}</ul>}
    </div>
  );
}

function EditField({ rfqId, analysisId, field, label, value }: { rfqId: string; analysisId: string; field: string; label: string; value: string }) {
  if (!analysisId) return null;
  return (
    <form action={correctAnalysisAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="analysisId" value={analysisId} />
      <input type="hidden" name="field" value={field} />
      <label className="text-sm"><span className="text-muted">{label}</span><input name="value" defaultValue={value} className="mt-1 block rounded-lg border border-line px-3 py-2" /></label>
      <button className={buttonSecondary}>Save correction</button>
    </form>
  );
}
