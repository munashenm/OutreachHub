import Link from "next/link";
import { SupplierForm } from "@/components/supplier-form";
import { PageHeader, Panel } from "@/components/ui";

export default function NewSupplierPage() {
  return (
    <div>
      <PageHeader title="New supplier" description="Use this for a supplier in China, Europe, or any distributor that is not already on the South African list." actions={<Link href="/suppliers" className="text-sm text-accent">Back</Link>} />
      <Panel className="p-5"><SupplierForm /></Panel>
    </div>
  );
}
