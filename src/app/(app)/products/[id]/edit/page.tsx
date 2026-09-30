import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { formatQuoteNumber } from "@/lib/quote";
import { stockLeft } from "@/lib/stock";
import { requireSession } from "@/services/auth-service";
import { centsToInput, getProduct } from "@/services/product-service";
import { holdsForProduct, reservedByProduct } from "@/services/stock-sync-service";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const product = await getProduct(session.workspace.id, id);
  if (!product) notFound();
  const status = firstParam((await searchParams).status);
  const [reserved, holds] = await Promise.all([
    reservedByProduct(session.workspace.id),
    holdsForProduct(session.workspace.id, product.id),
  ]);
  const left = stockLeft(product.stockOnHand, reserved.get(product.id) ?? 0);
  return (
    <div>
      <PageHeader title={product.name} actions={<Link href="/products" className="text-sm text-accent">Back</Link>} />
      {status === "created" ? <Notice tone="success">Product created.</Notice> : null}
      <p className="mb-3 text-sm text-muted">Stock level: {product.stockOnHand}. Left after open quotations and open website orders: {left}. A supplier sync replaces the stock level. The sell price changes only when it stays at or above the minimum margin.</p>
      <Panel className="mb-4 p-5">
        <h2 className="font-semibold">Holding this stock</h2>
        {holds.quotes.length === 0 && holds.orders.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No open quotation or website order is holding this product.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {holds.quotes.map((line) => (
              <li key={line.id}>
                <Link className="hover:underline" href={line.quote.number != null && line.quote.issuedAt ? `/quotes/${line.quote.id}` : `/rfqs/${line.quote.rfqId}`}>
                  {line.quote.number != null && line.quote.issuedAt ? formatQuoteNumber(line.quote.number, line.quote.issuedAt) : "Quotation"}
                </Link>
                {" "}· {Number(line.quantity)} held
              </li>
            ))}
            {holds.orders.map((line) => (
              <li key={line.id}>
                <Link className="hover:underline" href={`/orders/${line.order.id}`}>Website order {line.order.number}</Link>
                {" "}· {line.order.status} · {line.quantity} held
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="p-5">
        <ProductForm
          mode="edit"
          id={product.id}
          initial={{
            sku: product.sku,
            name: product.name,
            description: product.description,
            specifications: product.specifications,
            imageUrls: product.imageUrls.join("\n"),
            unitPrice: centsToInput(product.unitPriceCents),
            active: product.active,
          }}
        />
      </Panel>
    </div>
  );
}
