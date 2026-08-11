"use client";

import { useEffect, useMemo, useState } from "react";

type CrmProps = { section: string; onNotice: (message: string) => void };
const fmt = (v?: string) => v ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
const label = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());

export default function CrmWorkspace({ section, onNotice }: CrmProps) {
  const [data, setData] = useState<any>({ members: [], leads: [], tasks: [], activities: [], parties: [] });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<"lead" | "task" | "activity" | "member" | null>(null);
  const [form, setForm] = useState<any>({ source: "social_media", status: "new", role: "staff", taskType: "general", priority: "medium", activityType: "call", targetType: "lead" });
  const [selectedLead, setSelectedLead] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/crm", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setData(payload);
      if (!selectedLead && payload.leads[0]) setSelectedLead(payload.leads[0].id);
    } catch (e) { onNotice(e instanceof Error ? e.message : "CRM could not load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(action: string, payload: any = {}) {
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(next); setDialog(null); setForm({ source: "social_media", role: "staff", taskType: "general", priority: "medium", activityType: "call", targetType: "lead" });
      onNotice("Saved successfully");
    } catch (e) { onNotice(e instanceof Error ? e.message : "Could not save"); }
  }

  const lead = data.leads.find((x: any) => x.id === selectedLead);
  const leadActivities = data.activities.filter((x: any) => x.lead_id === selectedLead);
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const openTasks = data.tasks.filter((x: any) => x.status !== "done" && x.status !== "cancelled");
  const overdue = openTasks.filter((x: any) => x.due_at && new Date(x.due_at) < new Date());
  const dueToday = openTasks.filter((x: any) => x.due_at && new Date(x.due_at).toDateString() === new Date().toDateString());
  const stages = useMemo(() => ["new", "contacted", "qualified", "meeting", "proposal", "won"].map(status => ({ status, count: data.leads.filter((x: any) => x.status === status).length })), [data.leads]);

  if (loading) return <section className="crm-loading">Loading CRM workspace…</section>;
  return <section className="crm-workspace">
    <div className="crm-summary">
      <article><span>ACTIVE LEADS</span><strong>{data.leads.filter((x:any) => !["won","lost"].includes(x.status)).length}</strong><small>{data.leads.length} total enquiries</small></article>
      <article><span>DUE TODAY</span><strong>{dueToday.length}</strong><small>calls, meetings & collection</small></article>
      <article><span>OVERDUE</span><strong className="danger-text">{overdue.length}</strong><small>needs immediate attention</small></article>
      <article><span>TEAM</span><strong>{data.members.filter((x:any) => x.active).length}</strong><small>active members</small></article>
    </div>

    {section === "Leads" && <>
      <div className="crm-toolbar"><div><h2>Lead pipeline</h2><p>Every enquiry, conversation and next follow-up in one place.</p></div><button className="primary" onClick={() => setDialog("lead")}>＋ Add lead</button></div>
      <div className="pipeline">{stages.map(s => <div key={s.status}><span>{label(s.status)}</span><strong>{s.count}</strong></div>)}</div>
      <div className="crm-two-col">
        <article className="crm-card"><h3>Leads</h3><div className="crm-list">{data.leads.map((x:any) => <button className={selectedLead === x.id ? "selected" : ""} onClick={() => setSelectedLead(x.id)} key={x.id}><span className="lead-avatar">{x.name.slice(0,2).toUpperCase()}</span><span><strong>{x.name}</strong><small>{x.phone} · {x.interest || "General enquiry"}</small></span><em className={`stage ${x.status}`}>{label(x.status)}</em></button>)}</div></article>
        <article className="crm-card lead-detail">{lead ? <><div className="detail-head"><div><h3>{lead.name}</h3><p>{lead.phone} · {label(lead.source)}</p></div><button onClick={() => setDialog("activity")}>＋ Log activity</button></div><div className="lead-meta"><span><small>ASSIGNED TO</small>{lead.assignee?.name || "Unassigned"}</span><span><small>NEXT FOLLOW-UP</small>{fmt(lead.next_follow_up_at)}</span><span><small>INTEREST</small>{lead.interest || "Not specified"}</span></div><div className="detail-actions"><select value={lead.status} onChange={e => act("update_lead", { leadId: lead.id, status: e.target.value, assignedTo: lead.assigned_to, nextFollowUpAt: lead.next_follow_up_at })}>{["new","contacted","qualified","meeting","proposal","won","lost"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select>{!lead.converted_party_id && <button className="primary" onClick={() => act("convert_lead", { leadId: lead.id })}>Convert to party</button>}</div><h4>Conversation timeline</h4><div className="timeline">{leadActivities.length ? leadActivities.map((a:any) => <div key={a.id}><i>{a.activity_type === "call" ? "☎" : a.activity_type === "meeting" ? "◎" : "✎"}</i><span><strong>{a.subject || label(a.activity_type)}</strong><p>{a.remarks}</p><small>{a.member?.name || "Office"} · {fmt(a.happened_at)}{a.outcome ? ` · ${a.outcome}` : ""}</small></span></div>) : <p className="empty">No conversation logged yet.</p>}</div></> : <p className="empty">Add a lead to start.</p>}</article>
      </div>
    </>}

    {section === "Tasks" && <><div className="crm-toolbar"><div><h2>Work & follow-ups</h2><p>Calls, meetings, internal work and payment collections.</p></div><button className="primary" onClick={() => setDialog("task")}>＋ Assign task</button></div><div className="task-board">{["todo","in_progress","done"].map(status => <article className="crm-card" key={status}><h3>{label(status)} <b>{data.tasks.filter((x:any) => x.status === status).length}</b></h3>{data.tasks.filter((x:any) => x.status === status).map((t:any) => <div className={`task-card priority-${t.priority}`} key={t.id}><span>{label(t.task_type)}</span><h4>{t.title}</h4><p>{t.lead?.name || t.party?.name || "Internal task"}</p><small>◷ {fmt(t.due_at)} · {t.assignee?.name || "Unassigned"}</small>{status !== "done" && <button onClick={() => act("complete_task", { taskId: t.id })}>✓ Complete</button>}</div>)}</article>)}</div></>}

    {section === "Activity" && <><div className="crm-toolbar"><div><h2>Daily activity log</h2><p>What every team member discussed with leads and customers.</p></div><button className="primary" onClick={() => setDialog("activity")}>＋ Log activity</button></div><article className="crm-card activity-feed">{data.activities.map((a:any) => <div key={a.id}><span className="activity-icon">{a.activity_type === "call" ? "☎" : a.activity_type === "meeting" ? "◎" : a.activity_type === "payment_collection" ? "Nu" : "✎"}</span><span><strong>{a.subject || label(a.activity_type)}</strong><p>{a.remarks}</p><small>{a.lead?.name || a.party?.name} · {a.member?.name || "Office"} · {fmt(a.happened_at)}</small></span>{a.next_action_at && <em>Next: {fmt(a.next_action_at)}</em>}</div>)}</article></>}

    {section === "Team" && <><div className="crm-toolbar"><div><h2>Team & access</h2><p>Roles define daily responsibilities; all roles can collaborate on lead history.</p></div><button className="primary" onClick={() => setDialog("member")}>＋ Add member</button></div><div className="team-grid">{data.members.map((m:any) => <article className="crm-card" key={m.id}><span className="member-avatar">{m.name.slice(0,2).toUpperCase()}</span><h3>{m.name}</h3><em>{label(m.role)}</em><p>{m.email || m.phone || "No contact added"}</p><small>{m.role === "admin" ? "Full system & team access" : m.role === "manager" ? "Leads, tasks, reports & supervision" : m.role === "accountant" ? "Accounts, parties & collections" : "Assigned work, leads & activity logs"}</small></article>)}</div></>}

    {dialog && <div className="modal-backdrop" onMouseDown={() => setDialog(null)}><div className="modal crm-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><small>CRM WORKSPACE</small><h2>{dialog === "lead" ? "Add a new lead" : dialog === "task" ? "Assign a task" : dialog === "activity" ? "Log conversation / activity" : "Add team member"}</h2></div><button onClick={() => setDialog(null)}>×</button></div><div className="form-grid">
      {dialog === "lead" && <><label>Name<input autoFocus onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Phone<input onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Source<select onChange={e=>setForm({...form,source:e.target.value})}><option value="social_media">Social media</option><option value="referral">Referral</option><option value="walk_in">Walk-in</option><option value="website">Website</option></select></label><label>Product / interest<input placeholder="Paper, lubricant…" onChange={e=>setForm({...form,interest:e.target.value})}/></label><label>Assign to<select onChange={e=>setForm({...form,assignedTo:e.target.value})}><option value="">Unassigned</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>First follow-up<input type="datetime-local" onChange={e=>setForm({...form,nextFollowUpAt:e.target.value})}/></label></>}
      {dialog === "task" && <><label className="full">Task title<input autoFocus onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Type<select onChange={e=>setForm({...form,taskType:e.target.value})}>{["general","lead_follow_up","call","meeting","payment_collection"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Assign to<select onChange={e=>setForm({...form,assignedTo:e.target.value})}><option value="">Unassigned</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>Related lead<select onChange={e=>setForm({...form,leadId:e.target.value,partyId:""})}><option value="">None</option>{data.leads.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Or existing party<select onChange={e=>setForm({...form,partyId:e.target.value,leadId:""})}><option value="">None</option>{data.parties.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Due date & time<input type="datetime-local" onChange={e=>setForm({...form,dueAt:e.target.value})}/></label><label>Priority<select onChange={e=>setForm({...form,priority:e.target.value})}>{["low","medium","high","urgent"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label></>}
      {dialog === "activity" && <><label>Activity<select onChange={e=>setForm({...form,activityType:e.target.value})}>{["call","meeting","note","follow_up","payment_collection"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Handled by<select onChange={e=>setForm({...form,memberId:e.target.value})}><option value="">Office</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>Lead<select value={form.leadId ?? selectedLead} onChange={e=>setForm({...form,leadId:e.target.value,partyId:""})}><option value="">None</option>{data.leads.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Existing party<select onChange={e=>setForm({...form,partyId:e.target.value,leadId:""})}><option value="">None</option>{data.parties.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label className="full">What happened? / Remarks<textarea autoFocus rows={4} onChange={e=>setForm({...form,remarks:e.target.value})}/></label><label>Outcome<input placeholder="Interested, no answer…" onChange={e=>setForm({...form,outcome:e.target.value})}/></label><label>Next action (creates task)<input type="datetime-local" onChange={e=>setForm({...form,nextActionAt:e.target.value})}/></label></>}
      {dialog === "member" && <><label>Name<input autoFocus onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Role<select onChange={e=>setForm({...form,role:e.target.value})}>{["admin","manager","accountant","staff"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Email<input type="email" onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Phone<input onChange={e=>setForm({...form,phone:e.target.value})}/></label></>}
    </div><div className="modal-actions"><button onClick={() => setDialog(null)}>Cancel</button><button className="primary" onClick={() => act(dialog === "lead" ? "create_lead" : dialog === "task" ? "create_task" : dialog === "activity" ? "add_activity" : "create_member", dialog === "activity" ? {...form, leadId: form.leadId === undefined ? selectedLead : form.leadId, subject: form.subject || lead?.name} : form)}>Save</button></div></div></div>}
  </section>;
}
