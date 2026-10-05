import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm } from "@/components/inbox-actions";
import { RfqStatusForm } from "@/components/rfq-status-form";
import { DocumentAnalysisPanel } from "@/components/document-analysis-panel";
import { QuotePanel } from "@/components/quote-panel";
import { rerunRfqAction } from "@/actions/rfq-actions";
import { PageHeader, Panel, buttonSecondary } from "@/components/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { formatCents } from "@/lib/quote";
import { urbanFocusQuoteNumber } from "@/lib/quotation-document";
import { replyTargets } from "@/lib/gmail-message";
import type { RfqStatus } from "@/lib/labels";
import { centsToInput } from "@/services/product-service";
import { listProducts } from "@/services/product-service";
import { quoteApprovalLimits, quotesForRfq } from "@/services/quote-service";
import { lowestCostsByProduct } from "@/services/supplier-service";
import { reservedByProduct } from "@/services/stock-sync-service";
import { stockLeft } from "@/lib/stock";
import { requireSession } from "@/services/auth-service";
import { getThread } from "@/services/reply-service";
import { getRfq } from "@/services/rfq-service";
import { listTenderAnalyses, responseModeForRfq } from "@/services/document-analysis-service";

function sourceLabel(kind: string) {
  if (kind === "URBAN_FOCUS_CATALOGUE") return "Internal catalogue";
  if (kind === "SUPPLIER_FEED" || kind === "SUPPLIER_API") return "Supplier";
  if (kind === "EXTERNAL_SOURCE") return "External";
  return "Not selected";
}

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const rfq = await getRfq(session.workspace.id, id);
  if (!rfq) notFound();
  const [thread, quotes, products, limits, analyses, documentMode] = await Promise.all([
    getThread(session.workspace.id, rfq.sourceMessageId),
    quotesForRfq(session.workspace.id, rfq.id),
    listProducts(session.workspace.id),
    quoteApprovalLimits(session.workspace.id),
    listTenderAnalyses(session.workspace.id, rfq.id),
    responseModeForRfq(rfq.id),
  ]);
  const costs = await lowestCostsByProduct(session.workspace.id, products.map((product) => product.id));
  const reserved = await reservedByProduct(session.workspace.id);
  const target = replyTargets(rfq.sourceMessage);
  const draft = quotes.find((quote) => quote.status === "DRAFT");
  const sentQuotes = quotes.filter((quote) => quote.status === "SENT");
  const sendBlocked = documentMode === "TENDER_PACKAGE"
    ? "This tender requires the official submission method. An email quotation will not be sent."
    : documentMode === "CANNOT_QUOTE"
      ? "A mandatory specification is missing or cannot be satisfied, so a quotation email will not be sent."
      : "";
  return (
    <div className="space-y-4">
      <PageHeader title={rfq.subject} description={`Created ${formatDateTime(rfq.createdAt)}`} actions={<Link href="/rfqs" className="text-sm text-accent">Back to RFQs</Link>} />
      <nav className="flex gap-4 text-sm">
        <a className="text-accent" href="#sourcing">Sourcing</a>
        <a className="text-accent" href="#documents">Document Analysis</a>
        <a className="text-accent" href="#quote">Quotation</a>
      </nav>
      <Panel className="grid gap-3 p-5 text-sm md:grid-cols-2">
        <p><span className="text-muted">Customer: </span>{rfq.prospect ? <Link className="hover:underline" href={`/prospects/${rfq.prospect.id}`}>{fullName(rfq.prospect.firstName, rfq.prospect.lastName)}</Link> : rfq.sourceMessage.fromName || rfq.sourceMessage.fromEmail || "Unknown sender"}</p>
        <p><span className="text-muted">Company: </span>{rfq.company ? <Link className="hover:underline" href={`/companies/${rfq.company.id}`}>{rfq.company.companyName}</Link> : "—"}</p>
        <p className="md:col-span-2"><span className="text-muted">Original enquiry: </span><Link className="hover:underline" href={`/inbox/${rfq.sourceMessageId}`}>{rfq.sourceMessage.subject}</Link></p>
        {rfq.automationNote ? <p className="md:col-span-2"><span className="text-muted">Automation: </span>{rfq.automationNote}</p> : null}
      </Panel>
      <Panel className="p-5" id="sourcing">
          <h2 className="font-semibold">Sourcing</h2>
          {rfq.lines.length === 0 ? <p className="mt-3 text-sm text-muted">No specification line yet. Search again reads the original enquiry and does not send an email.</p> : (
          <ul className="mt-3 space-y-4 text-sm">
            {rfq.lines.map((line) => (
              <li key={line.id} className="grid gap-1">
                <p><span className="text-muted">Requested: </span>{line.quantity == null ? "" : `${Number(line.quantity)} × `}{line.description}</p>
                {line.specifications ? <p><span className="text-muted">Specification: </span>{line.specifications}</p> : null}
                <p><span className="text-muted">Sourced product: </span>{line.sourcedName || "Still sourcing"}</p>
                <p><span className="text-muted">Source: </span>{sourceLabel(line.sourceKind)}</p>
                <p><span className="text-muted">Match: </span>{line.matchGrade || line.matchNote || "Not selected"}</p>
                <p><span className="text-muted">Cost status: </span>{line.costStatus === "VERIFIED" ? "Verified" : line.costStatus === "NEEDS_REVIEW" ? "Needs review" : "Needs review"}</p>
                <p><span className="text-muted">Stock: </span>{line.stockNote || "Not confirmed"}</p>
              </li>
            ))}
          </ul>
          )}
          {draft && draft.lines.length > 0 ? (
            <div className="mt-4 space-y-1 text-sm">
              {draft.lines.map((line) => (
                <p key={line.id}><span className="text-muted">Sell price: </span>{line.description} — {formatCents(line.unitPriceCents)}</p>
              ))}
            </div>
          ) : <p className="mt-4 text-sm"><span className="text-muted">Sell price: </span>Not priced yet</p>}
          <p className="mt-4 text-sm text-muted">Send Quote approves the priced option. Ask Customer uses the reply box when a detail is still missing. Search again checks the catalogue and supplier products and does not send another email. Manual Source is a line added on the quotation.</p>
          <form action={rerunRfqAction} className="mt-3">
            <input type="hidden" name="id" value={rfq.id} />
            <button className={buttonSecondary}>Search again</button>
          </form>
        </Panel>
      <Panel className="p-5" id="documents">
        <h2 className="font-semibold">Document Analysis</h2>
        <div className="mt-4">
          <DocumentAnalysisPanel
            rfqId={rfq.id}
            documents={analyses.map((row) => ({ id: row.id, record: row.record, approvedById: row.approvedById }))}
            sendBlocked={sendBlocked}
            quotePreview={(draft?.lines ?? []).map((line) => ({
              description: line.description,
              quantity: Number(line.quantity).toString(),
              unitPriceCents: line.unitPriceCents,
              scheduleNumber: line.scheduleNumber,
            }))}
          />
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="font-semibold">Conversation</h2>
        <div className="mt-4 space-y-4">
          {(thread?.messages ?? [rfq.sourceMessage]).map((item) => (
            <article key={item.id} className="border-b border-line pb-4 last:border-b-0">
              <p className="text-sm font-medium">{item.direction === "OUTBOUND" ? "Urban Focus" : item.fromName || item.fromEmail || "Customer"}</p>
              <p className="text-xs text-muted">{formatDateTime(item.sentAt ?? item.createdAt)}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.body || item.snippet}</p>
            </article>
          ))}
        </div>
      </Panel>
      <Panel className="p-5" id="quote">
        <h2 className="font-semibold">Quote</h2>
        <p className="mt-1 text-sm text-muted">Lines are priced from the catalogue or typed in. The draft follows the current product specification and images. Sending uses the connected Gmail mailbox, stays in this thread, and keeps that copy on the quotation.</p>
        {draft ? <p className="mt-2 text-sm">Confidence score: {draft.confidenceScore}</p> : null}
        <div className="mt-4">
          <QuotePanel
            rfqId={rfq.id}
            quoteId={draft?.id ?? null}
            currency={draft?.currency ?? "ZAR"}
            sent={false}
            lines={(draft?.lines ?? []).map((line) => ({
              id: line.id,
              description: line.description,
              quantity: Number(line.quantity).toString(),
              unitPriceCents: line.unitPriceCents,
              productId: line.productId,
              costCents: line.productId ? costs.get(line.productId) ?? null : null,
              specifications: line.product?.specifications ?? "",
              imageUrls: line.product?.imageUrls ?? [],
            }))}
            products={products.filter((product) => product.active).map((product) => ({
              id: product.id,
              sku: product.sku,
              name: product.name,
              unitPrice: centsToInput(product.unitPriceCents),
              unitPriceCents: product.unitPriceCents,
              costCents: costs.get(product.id) ?? null,
              stockLeft: stockLeft(product.stockOnHand, reserved.get(product.id) ?? 0),
            }))}
            subject={rfq.subject}
            customerName={rfq.prospect ? fullName(rfq.prospect.firstName, rfq.prospect.lastName) : ""}
            companyName={rfq.company?.companyName ?? ""}
            minimumMarginPercent={limits.minimumMarginPercent}
            autoSendMarginPercent={limits.autoSendMarginPercent}
            emailBlocked={sendBlocked}
            quoteNumber={draft?.number ?? null}
            issuedAt={draft?.issuedAt ? draft.issuedAt.toISOString() : null}
          />
        </div>
        {sentQuotes.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-muted">
            {sentQuotes.map((quote) => (
              <li key={quote.id}>
                {quote.number != null && quote.issuedAt ? (
                  <Link className="hover:underline" href={`/quotes/${quote.id}`}>{urbanFocusQuoteNumber(quote.number, quote.issuedAt)}</Link>
                ) : "Quotation"}
                {" "}sent {quote.sentAt ? formatDateTime(quote.sentAt) : ""} · {quote.lines.length} lines · confidence {quote.confidenceScore}
                {" "}· <a className="hover:underline" href={`/api/quotes/${quote.id}/pdf`}>View Sent PDF</a>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <Panel className="p-5">
        <RfqStatusForm id={rfq.id} status={rfq.status as RfqStatus} notes={rfq.notes} />
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 font-semibold">Reply</h2>
        <p className="mb-3 text-sm text-muted">This reply is a quotation response. It is not a promotional campaign send, so an opted-out address can still receive it.</p>
        <ReplyForm messageId={rfq.sourceMessageId} to={target.to} subject={target.subject} />
      </Panel>
    </div>
  );
}
