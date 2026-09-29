"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { moveProspectAction } from "@/actions/prospect-actions";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/labels";

export type PipelineCard = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  companyName: string;
  leadStatus: LeadStatus;
};

export function KanbanBoard({ cards }: { cards: PipelineCard[] }) {
  const [items, setItems] = useState(cards);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(event: DragEndEvent) {
    const prospectId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    const current = items.find((item) => item.id === prospectId);
    if (!current) return;
    const nextStatus = LEAD_STATUSES.find((status) => status === overId)
      ?? items.find((item) => item.id === overId)?.leadStatus;
    if (!nextStatus || nextStatus === current.leadStatus) return;
    const previous = items;
    setItems((rows) => rows.map((row) => (row.id === prospectId ? { ...row, leadStatus: nextStatus } : row)));
    startTransition(async () => {
      const result = await moveProspectAction(prospectId, nextStatus);
      if (result.error) {
        setItems(previous);
        setError(result.error);
      } else {
        setError(undefined);
      }
    });
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LEAD_STATUSES.map((status) => (
            <Column key={status} status={status} cards={items.filter((item) => item.leadStatus === status)} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ status, cards }: { status: LeadStatus; cards: PipelineCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={`w-72 shrink-0 rounded-xl border bg-white ${isOver ? "border-accent" : "border-line"}`}>
      <header className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold">{LEAD_STATUS_LABELS[status]}</h2>
        <span className="text-xs text-muted">{cards.length}</span>
      </header>
      <div className="space-y-2 px-2 pb-3">
        {cards.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted">Drop prospects here</p> : null}
        {cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function Card({ card }: { card: PipelineCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-lg border border-line bg-canvas p-3 ${isDragging ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/prospects/${card.id}`} className="text-sm font-medium hover:underline">{card.name}</Link>
        <button type="button" className="cursor-grab text-xs text-muted" aria-label={`Drag ${card.name}`} {...listeners} {...attributes}>
          Move
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{card.companyName || card.email}</p>
      {card.jobTitle ? <p className="text-xs text-muted">{card.jobTitle}</p> : null}
    </article>
  );
}
