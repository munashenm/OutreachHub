import { KanbanBoard } from "@/components/kanban";
import { PageHeader } from "@/components/ui";
import { fullName } from "@/lib/format";
import { requireSession } from "@/services/auth-service";
import { listPipeline } from "@/services/prospect-service";

export default async function PipelinePage() {
  const session = await requireSession();
  const pipeline = await listPipeline(session.workspace.id);
  return (
    <div>
      <PageHeader
        title="Pipeline"
        description={pipeline.truncated ? `Showing the 500 most recently updated prospects of ${pipeline.total}. Drag a card to record a status change.` : "Drag a card to another column to record a lead status change."}
      />
      <KanbanBoard
        cards={pipeline.prospects.map((prospect) => ({
          id: prospect.id,
          name: fullName(prospect.firstName, prospect.lastName),
          email: prospect.email,
          jobTitle: prospect.jobTitle ?? "",
          companyName: prospect.company?.companyName ?? "",
          leadStatus: prospect.leadStatus,
        }))}
      />
    </div>
  );
}
