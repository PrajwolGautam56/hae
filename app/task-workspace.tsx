"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import BsDateInput from "./bs-date-input";
import { formatBs } from "../lib/nepali-date";
import { TASK_STAGES, taskLocalDateTime } from "../lib/task-workflow";
import "./work-documents.css";
import { useWorkDialog } from "./use-work-dialog";

// This component consumes the existing shared CRM snapshot shape.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export default function TaskWorkspace({ data, save, refresh }: { data: Row; save: (action: string, body: Row) => Promise<boolean>; refresh?: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [form, setForm] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState("");
  const [error, setError] = useState("");
  useWorkDialog(Boolean(form), () => { if (!busy) setForm(null); });
  const tasks = data.tasks.filter((task: Row) => `${task.title} ${task.description || ""} ${task.assignee?.name || ""} ${task.party?.name || ""} ${task.lead?.name || ""}`.toLowerCase().includes(search.toLowerCase()) && (owner === "all" || (owner === "unassigned" ? !task.assigned_to : task.assigned_to === owner)));
  function open(task?: Row) {
    setError("");
    setForm(task ? { taskId: task.id, title: task.title, description: task.description || "", status: task.status, taskType: task.task_type, assignedTo: task.assigned_to || "", leadId: task.lead_id || "", partyId: task.party_id || "", priority: task.priority, dueAt: taskLocalDateTime(task.due_at), expectedUpdatedAt: task.updated_at } : { requestId: crypto.randomUUID(), title: "", description: "", status: "todo", taskType: "general", assignedTo: data.currentMember?.id || "", leadId: "", partyId: "", priority: "medium", dueAt: "" });
  }
  async function perform(action: string, body: Row) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try { const result = await save(action, body); if (!result) setError("Task was not saved. Your entries are retained; please retry."); return result; }
    catch (e) { setError(e instanceof Error ? e.message : "Task could not be saved"); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  async function move(task: Row, status: string) {
    if (task.status === status) return;
    await perform("move_task", { taskId: task.id, status, expectedUpdatedAt: task.updated_at });
  }
  return <div className="work-hub">
    <div className="work-heading"><div><small>TEAM WORKSPACE</small><h2>Tasks & follow-ups</h2><p>Drag a card to change its stage, or use its status menu on mobile.</p></div><button className="primary" onClick={() => open()} disabled={busy}>＋ Create task</button></div>
    <div className="work-filters"><label>Search tasks<input placeholder="Title, notes, person or client" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Assigned to<select value={owner} onChange={e => setOwner(e.target.value)}><option value="all">Everyone</option><option value="unassigned">Unassigned</option>{data.members.map((m: Row) => <option key={m.id} value={m.id}>{m.name}{m.active ? "" : " (inactive)"}</option>)}</select></label><label className="work-check"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Show cancelled</label>{refresh && <button disabled={busy} onClick={() => { void refresh(); setError(""); }}>Refresh tasks</button>}</div>
    {error && !form && <p className="work-error" role="alert">{error}</p>}
    <div className="work-board" aria-busy={busy}>{TASK_STAGES.filter(stage => showCancelled || stage.id !== "cancelled").map(stage => <section key={stage.id} aria-label={stage.label} className={`work-column stage-${stage.id} ${over === stage.id ? "drop-target" : ""}`} onDragOver={e => { if (dragging && !busy) { e.preventDefault(); setOver(stage.id); } }} onDragLeave={() => setOver("")} onDrop={e => { e.preventDefault(); const task = data.tasks.find((t: Row) => t.id === dragging); setDragging(""); setOver(""); if (task) void move(task, stage.id); }}>
      <h3><span>{stage.label}</span><b>{tasks.filter((t: Row) => t.status === stage.id).length}</b></h3>
      {tasks.filter((t: Row) => t.status === stage.id).map((task: Row) => <article key={task.id} className={`work-task ${dragging === task.id ? "is-dragging" : ""}`} draggable={!busy} onDragStart={e => { setDragging(task.id); e.dataTransfer.setData("text/plain", task.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragging(""); setOver(""); }}>
        <div className="work-task-top"><span className={`work-priority priority-${task.priority}`}>{task.priority}</span><small>{task.task_type.replaceAll("_", " ")}</small></div><button className="work-task-title" onClick={() => open(task)}>{task.title}</button>
        {task.description && <p>{task.description}</p>}<small>{task.lead?.name || task.party?.name || "Internal task"}</small><div className="work-task-person">{task.assignee?.name || "Unassigned"}</div><small className={task.due_at && !["done", "cancelled"].includes(task.status) && new Date(task.due_at) < new Date() ? "danger-text" : ""}>{task.due_at ? `${formatBs(taskLocalDateTime(task.due_at))} · ${taskLocalDateTime(task.due_at).slice(11)} NPT` : "No due date"}</small>
        <label className="work-status">Status<select aria-label={`Status for ${task.title}`} disabled={busy} value={task.status} onChange={e => void move(task, e.target.value)}>{TASK_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      </article>)}
      {!tasks.some((t: Row) => t.status === stage.id) && <p className="work-empty">No tasks here. Drop a task here or create one.</p>}
    </section>)}</div>
    {form && createPortal(<div className="work-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) setForm(null); }}><form className="work-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onSubmit={async e => { e.preventDefault(); if (await perform(form.taskId ? "update_task" : "create_task", form)) setForm(null); }}><header><div><small>TASK DETAILS</small><h2 id="task-dialog-title">{form.taskId ? "Edit task" : "Create task"}</h2></div><button type="button" aria-label="Close" disabled={busy} onClick={() => setForm(null)}>×</button></header><div className="work-form">
      <label className="wide">Title<input autoFocus required maxLength={250} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>Assign to<select value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })}><option value="">Unassigned</option>{data.members.filter((m: Row) => m.active || m.id === form.assignedTo).map((m: Row) => <option key={m.id} value={m.id}>{m.name}{m.active ? "" : " (inactive)"}</option>)}</select></label>
      <label>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{TASK_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>Priority<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Type<select value={form.taskType} onChange={e => setForm({ ...form, taskType: e.target.value })}>{["general", "lead_follow_up", "call", "meeting", "payment_collection"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
      <div className="wide"><label>Due date & time (BS · Nepal time){form.dueAt ? <BsDateInput includeTime value={form.dueAt} onChange={value => setForm({ ...form, dueAt: value })} /> : <small>No due date scheduled</small>}</label><button type="button" onClick={() => setForm({ ...form, dueAt: form.dueAt ? "" : `${taskLocalDateTime(new Date().toISOString()).slice(0,10)}T09:00` })}>{form.dueAt ? "Remove due date" : "＋ Schedule due date"}</button></div>
      <label>Related lead<select value={form.leadId} onChange={e => setForm({ ...form, leadId: e.target.value, partyId: "" })}><option value="">None</option>{data.leads.map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Or party<select value={form.partyId} onChange={e => setForm({ ...form, partyId: e.target.value, leadId: "" })}><option value="">None</option>{data.parties.map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="wide">Instructions / notes<textarea rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      {error && <p className="work-error wide" role="alert">{error}</p>}
    </div><footer><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save task"}</button></footer></form></div>, document.body)}
  </div>;
}
