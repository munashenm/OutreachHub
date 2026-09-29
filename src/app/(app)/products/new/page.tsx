import Link from "next/link";
import { ProductForm } from "@/components/product-form";
import { PageHeader, Panel } from "@/components/ui";

export default function NewProductPage() {
  return (
    <div>
      <PageHeader title="New product" actions={<Link href="/products" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5"><ProductForm mode="create" /></Panel>
    </div>
  );
}
