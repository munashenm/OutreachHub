import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { formatCents, formatQuoteDate, formatQuoteNumber, lineTotalCents, quoteTotalCents } from "@/lib/quote";
import { fullName } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { getQuoteDocument } from "@/services/quote-service";

export default async function QuoteDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const quote = await getQuoteDocument(session.workspace.id, id);
  if (!quote || quote.number == null || quote.issuedAt == null || quote.validUntil == null) notFound();
  const customerName = quote.rfq.prospect ? fullName(quote.rfq.prospect.firstName, quote.rfq.prospect.lastName) : "";
  const companyName = quote.rfq.company?.companyName ?? "";
  const lines = quote.lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPriceCents: line.unitPriceCents,
  }));
  const total = quoteTotalCents(lines);
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/rfqs/${quote.rfqId}`} className="text-sm text-accent">Back to RFQ</Link>
        <PrintButton />
      </div>
      <header>
        <p className="text-sm text-muted">Quotation</p>
        <h1 className="text-2xl font-semibold">{formatQuoteNumber(quote.number, quote.issuedAt)}</h1>
        <p className="mt-2 text-sm">Issued {formatQuoteDate(quote.issuedAt)}</p>
        <p className="text-sm">Valid until {formatQuoteDate(quote.validUntil)}</p>
      </header>
      <section className="text-sm">
        {customerName ? <p>Customer: {customerName}</p> : null}
        {companyName ? <p>Company: {companyName}</p> : null}
        <p>Subject: {quote.rfq.subject}</p>
      </section>
      <table className="data-table">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
        <tbody>
          {lines.map((line, index) => {
            const amount = lineTotalCents(line.quantity, line.unitPriceCents);
            return (
              <tr key={`${line.description}-${index}`}>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{formatCents(line.unitPriceCents, quote.currency)}</td>
                <td>{amount === null ? "—" : formatCents(amount, quote.currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm font-medium">Total {total === null ? "—" : formatCents(total, quote.currency)}</p>
      {quote.notes ? <p className="whitespace-pre-wrap text-sm">{quote.notes}</p> : null}
      <p className="text-sm">This is a quotation for the enquiry in this thread. It is not a promotional message.</p>
    </article>
  );
}
