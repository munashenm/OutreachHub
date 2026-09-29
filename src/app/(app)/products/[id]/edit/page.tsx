import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { firstParam } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { centsToInput, getProduct } from "@/services/product-service";

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
  return (
    <div>
      <PageHeader title={product.name} actions={<Link href="/products" className="text-sm text-accent">Back</Link>} />
      {status === "created" ? <Notice tone="success">Product created.</Notice> : null}
      <Panel className="p-5">
        <ProductForm
          mode="edit"
          id={product.id}
          initial={{
            sku: product.sku,
            name: product.name,
            description: product.description,
            unitPrice: centsToInput(product.unitPriceCents),
            active: product.active,
          }}
        />
      </Panel>
    </div>
  );
}
