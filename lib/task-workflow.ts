export const TASK_STAGES = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "Ongoing" },
  { id: "done", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
] as const;
export function taskLocalDateTime(value: string) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + 345 * 60_000).toISOString().slice(0, 16);
}
export function taskInput(body: Record<string, unknown>) {
  const title = String(body.title || "").trim();
  if (!title || title.length > 250) throw new Error("Enter a task title (up to 250 characters)");
  const status = String(body.status || "todo");
  const priority = String(body.priority || "medium");
  const taskType = String(body.taskType || "general");
  if (!TASK_STAGES.some(stage => stage.id === status)) throw new Error("Invalid task status");
  if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error("Invalid priority");
  if (!["general", "lead_follow_up", "call", "meeting", "payment_collection"].includes(taskType)) throw new Error("Invalid task type");
  if (body.leadId && body.partyId) throw new Error("Choose either a lead or a party");
  const localDue = String(body.dueAt || "");
  const dueAt = localDue ? new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDue) ? `${localDue}:00+05:45` : localDue) : null;
  if (dueAt && !Number.isFinite(dueAt.getTime())) throw new Error("Invalid due date");
  return { title, status, priority, taskType, description: String(body.description || "").trim(), assignedTo: body.assignedTo || null, leadId: body.leadId || null, partyId: body.partyId || null, dueAt: dueAt?.toISOString() || null };
}
