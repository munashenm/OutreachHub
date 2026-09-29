import { EmptyState, PageHeader } from "@/components/ui";

export default function PlannedPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState title="Not in this release" description="This area is reserved for a later phase. No sample records are shown here." />
    </div>
  );
}
