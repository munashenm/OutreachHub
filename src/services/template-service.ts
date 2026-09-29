import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import type { TemplateInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

export async function listTemplates(workspaceId: string) {
  return getDb().emailTemplate.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTemplate(workspaceId: string, id: string) {
  return getDb().emailTemplate.findFirst({ where: { id, workspaceId } });
}

export async function createTemplate(actor: Actor, input: TemplateInput) {
  return getDb().$transaction(async (tx) => {
    const template = await tx.emailTemplate.create({
      data: { ...input, workspaceId: actor.workspaceId },
    });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "TEMPLATE_CREATED",
      summary: `Created template ${template.name}.`,
    });
    return template;
  });
}

export async function updateTemplate(actor: Actor, id: string, input: TemplateInput) {
  const current = await getTemplate(actor.workspaceId, id);
  if (!current) throw new AppError("Template not found.", 404, "NOT_FOUND");
  return getDb().$transaction(async (tx) => {
    const template = await tx.emailTemplate.update({ where: { id: current.id }, data: input });
    await recordActivity(tx, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "TEMPLATE_UPDATED",
      summary: `Updated template ${template.name}.`,
    });
    return template;
  });
}

export async function deleteTemplate(actor: Actor, id: string) {
  const current = await getTemplate(actor.workspaceId, id);
  if (!current) throw new AppError("Template not found.", 404, "NOT_FOUND");
  await getDb().emailTemplate.deleteMany({ where: { id: current.id, workspaceId: actor.workspaceId } });
}
