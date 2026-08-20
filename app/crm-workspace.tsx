"use client";

import { useEffect, useMemo, useState } from "react";
import BsDateInput from "./bs-date-input";
import { formatBs } from "../lib/nepali-date";
import AdminAccessPanel from "./admin-access-panel";
import { getCachedJson, peekClientCache, setClientCache } from "../lib/client-data-cache";

type CrmProps = { section: string; onNotice: (message: string) => void };
const fmt = (v?: string) => v ? formatBs(v,true) : "Not scheduled";
const label = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());

export default function CrmWorkspace({ section, onNotice }: CrmProps) {
  const cachedSnapshot = peekClientCache<any>("crm:snapshot");
  const [data, setData] = useState<any>(cachedSnapshot || { members: [], leads: [], tasks: [], activities: [], parties: [] });
  const [loading, setLoading] = useState(!cachedSnapshot);
  const [dialog, setDialog] = useState<"lead" | "task" | "activity" | "member" | null>(null);
  const [form, setForm] = useState<any>({ source: "social_media", status: "new", role: "staff", taskType: "general", priority: "medium", activityType: "call", targetType: "lead" });
  const [selectedLead, setSelectedLead] = useState<string>("");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatus, setLeadStatus] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");

  async function load(force = false) {
    if (!peekClientCache("crm:snapshot")) setLoading(true);
    try {
      const payload = await getCachedJson<any>("crm:snapshot", "/api/crm", { maxAgeMs: 30_000, force });
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
      setClientCache("crm:snapshot", next); setData(next); setDialog(null); setForm({ source: "social_media", role: "staff", taskType: "general", priority: "medium", activityType: "call", targetType: "lead" });
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
  const filteredLeads = useMemo(() => data.leads.filter((item: any) => {
    const query = leadSearch.trim().toLowerCase();
    const matchesQuery = !query || `${item.name} ${item.phone || ""} ${item.interest || ""} ${item.source || ""}`.toLowerCase().includes(query);
    const matchesStatus = leadStatus === "all" || item.status === leadStatus;
    const matchesAssignee = assigneeFilter === "all" || (assigneeFilter === "unassigned" ? !item.assigned_to : item.assigned_to === assigneeFilter);
    return matchesQuery && matchesStatus && matchesAssignee;
  }), [data.leads, leadSearch, leadStatus, assigneeFilter]);
  const filteredActivities = useMemo(() => {
    const query = activitySearch.trim().toLowerCase();
    if (!query) return data.activities;
    return data.activities.filter((item: any) => `${item.subject || ""} ${item.remarks || ""} ${item.outcome || ""} ${item.lead?.name || ""} ${item.party?.name || ""} ${item.member?.name || ""}`.toLowerCase().includes(query));
  }, [data.activities, activitySearch]);

  function openLeadActivity(activityType: string) {
    if (!lead) return;
    setForm({ activityType, targetType: "lead", leadId: lead.id, memberId: lead.assigned_to || "", subject: lead.name });
    setDialog("activity");
  }
  function openLeadFollowUp() {
    if (!lead) return;
    setForm({ taskType: "lead_follow_up", priority: "medium", leadId: lead.id, partyId: "", assignedTo: lead.assigned_to || "", title: `Follow up: ${lead.name}` });
    setDialog("task");
  }

  if (loading) return <section className="crm-loading">Loading CRM workspace…</section>;
  return <section className="crm-workspace">
    <div className="crm-summary">
      <article><span>ACTIVE LEADS</span><strong>{data.leads.filter((x:any) => !["won","lost"].includes(x.status)).length}</strong><small>{data.leads.length} total enquiries</small></article>
      <article><span>DUE TODAY</span><strong>{dueToday.length}</strong><small>calls, meetings & collection</small></article>
      <article><span>OVERDUE</span><strong className="danger-text">{overdue.length}</strong><small>needs immediate attention</small></article>
      <article><span>TEAM</span><strong>{data.members.filter((x:any) => x.active).length}</strong><small>active members</small></article>
    </div>

    {section === "Leads" && <>
      <div className="crm-toolbar"><div><h2>Lead pipeline</h2><p>Every enquiry, conversation and next follow-up in one place.</p></div><button className="primary" onClick={() => { setForm({ source: "social_media", status: "new" }); setDialog("lead"); }}>＋ Add lead</button></div>
      <div className="pipeline">{stages.map(s => <button className={leadStatus === s.status ? "active" : ""} onClick={() => setLeadStatus(leadStatus === s.status ? "all" : s.status)} key={s.status}><span>{label(s.status)}</span><strong>{s.count}</strong></button>)}</div>
      <div className="crm-filterbar">
        <label className="crm-search"><span>⌕</span><input value={leadSearch} onChange={event => setLeadSearch(event.target.value)} placeholder="Search name, phone or product interest" /></label>
        <select value={leadStatus} onChange={event => setLeadStatus(event.target.value)}><option value="all">All stages</option>{["new","contacted","qualified","meeting","proposal","won","lost"].map(status => <option value={status} key={status}>{label(status)}</option>)}</select>
        <select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}><option value="all">All assignees</option><option value="unassigned">Unassigned</option>{data.members.filter((member:any) => member.active).map((member:any) => <option value={member.id} key={member.id}>{member.name}</option>)}</select>
      </div>
      <div className="crm-two-col">
        <article className="crm-card"><div className="crm-list-title"><h3>Leads</h3><small>{filteredLeads.length} shown</small></div><div className="crm-list">{filteredLeads.map((item:any) => <button className={selectedLead === item.id ? "selected" : ""} onClick={() => setSelectedLead(item.id)} key={item.id}><span className="lead-avatar">{item.name.slice(0,2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.phone} · {item.interest || "General enquiry"}</small></span><em className={`stage ${item.status}`}>{label(item.status)}</em></button>)}{!filteredLeads.length && <p className="empty">No lead matches this search.</p>}</div></article>
        <article className="crm-card lead-detail">{lead ? <><div className="detail-head"><div><h3>{lead.name}</h3><p>{lead.phone} · {label(lead.source)}</p></div><div className="lead-quick-actions"><button onClick={() => openLeadActivity("call")}>☎ Log call</button><button onClick={() => openLeadActivity("note")}>＋ Add note</button><button className="primary" onClick={openLeadFollowUp}>◷ Schedule follow-up</button></div></div><div className="lead-meta"><span><small>ASSIGNED TO</small>{lead.assignee?.name || "Unassigned"}</span><span><small>NEXT FOLLOW-UP</small>{fmt(lead.next_follow_up_at)}</span><span><small>INTEREST</small>{lead.interest || "Not specified"}</span></div><div className="detail-actions"><label><small>STAGE</small><select value={lead.status} onChange={event => act("update_lead", { leadId: lead.id, status: event.target.value, assignedTo: lead.assigned_to, nextFollowUpAt: lead.next_follow_up_at })}>{["new","contacted","qualified","meeting","proposal","won","lost"].map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label><label><small>FOLLOW-UP OWNER</small><select value={lead.assigned_to || ""} onChange={event => act("update_lead", { leadId: lead.id, status: lead.status, assignedTo: event.target.value || null, nextFollowUpAt: lead.next_follow_up_at })}><option value="">Unassigned</option>{data.members.filter((member:any) => member.active).map((member:any) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{!lead.converted_party_id && <button className="primary" onClick={() => act("convert_lead", { leadId: lead.id })}>Convert to party</button>}</div><h4>Conversation timeline</h4><div className="timeline">{leadActivities.length ? leadActivities.map((activity:any) => <div key={activity.id}><i>{activity.activity_type === "call" ? "☎" : activity.activity_type === "meeting" ? "◎" : "✎"}</i><span><strong>{activity.subject || label(activity.activity_type)}</strong><p>{activity.remarks}</p><small>{activity.member?.name || "Office"} · {fmt(activity.happened_at)}{activity.outcome ? ` · ${activity.outcome}` : ""}</small></span></div>) : <p className="empty">No conversation logged yet. Add a note or log the first call.</p>}</div></> : <p className="empty">Select a lead to review its complete follow-up history.</p>}</article>
      </div>
    </>}

    {section === "Tasks" && <><div className="crm-toolbar"><div><h2>Work & follow-ups</h2><p>Calls, meetings, internal work and payment collections.</p></div><button className="primary" onClick={() => { setForm({ taskType: "general", priority: "medium", assignedTo: "", leadId: "", partyId: "" }); setDialog("task"); }}>＋ Assign task</button></div><div className="task-board">{["todo","in_progress","done"].map(status => <article className="crm-card" key={status}><h3>{label(status)} <b>{data.tasks.filter((x:any) => x.status === status).length}</b></h3>{data.tasks.filter((x:any) => x.status === status).map((t:any) => <div className={`task-card priority-${t.priority}`} key={t.id}><span>{label(t.task_type)}</span><h4>{t.title}</h4><p>{t.lead?.name || t.party?.name || "Internal task"}</p><small>◷ {fmt(t.due_at)} · {t.assignee?.name || "Unassigned"}</small>{status !== "done" && <button onClick={() => act("complete_task", { taskId: t.id })}>✓ Complete</button>}</div>)}</article>)}</div></>}

    {section === "Activity" && <><div className="crm-toolbar"><div><h2>Daily activity log</h2><p>What every team member discussed with leads and customers.</p></div><button className="primary" onClick={() => { setForm({ activityType: "call", targetType: "lead" }); setDialog("activity"); }}>＋ Log activity</button></div><div className="crm-filterbar activity-filterbar"><label className="crm-search"><span>⌕</span><input value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Search notes, outcome, lead, party or staff" /></label></div><article className="crm-card activity-feed">{filteredActivities.map((activity:any) => <div key={activity.id}><span className="activity-icon">{activity.activity_type === "call" ? "☎" : activity.activity_type === "meeting" ? "◎" : activity.activity_type === "payment_collection" ? "Rs" : "✎"}</span><span><strong>{activity.subject || label(activity.activity_type)}</strong><p>{activity.remarks}</p><small>{activity.lead?.name || activity.party?.name} · {activity.member?.name || "Office"} · {fmt(activity.happened_at)}</small></span>{activity.next_action_at && <em>Next: {fmt(activity.next_action_at)}</em>}</div>)}{!filteredActivities.length && <p className="empty">No activity matches this search.</p>}</article></>}

    {section === "Team" && <><div className="crm-toolbar"><div><h2>Team & access</h2><p>Roles define daily responsibilities; all roles can collaborate on lead history.</p></div></div><div className="team-grid">{data.members.map((m:any) => <article className="crm-card" key={m.id}><span className="member-avatar">{m.name.slice(0,2).toUpperCase()}</span><h3>{m.name}</h3><em>{label(m.role)}</em><p>{m.email || m.phone || "No contact added"}</p><small>{m.role === "admin" ? "Full system & team access" : m.role === "manager" ? "Leads, tasks, reports & supervision" : m.role === "accountant" ? "Accounts, parties & collections" : "Assigned work, leads & activity logs"}</small></article>)}</div><AdminAccessPanel onNotice={onNotice}/></>}

    {dialog && <div className="modal-backdrop" onMouseDown={() => setDialog(null)}><div className="modal crm-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><small>CRM WORKSPACE</small><h2>{dialog === "lead" ? "Add a new lead" : dialog === "task" ? "Assign a task" : dialog === "activity" ? "Log conversation / activity" : "Add team member"}</h2></div><button onClick={() => setDialog(null)}>×</button></div><div className="form-grid">
      {dialog === "lead" && <><label>Name<input autoFocus onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Phone<input onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Source<select onChange={e=>setForm({...form,source:e.target.value})}><option value="social_media">Social media</option><option value="referral">Referral</option><option value="walk_in">Walk-in</option><option value="website">Website</option></select></label><label>Product / interest<input placeholder="Paper, lubricant…" onChange={e=>setForm({...form,interest:e.target.value})}/></label><label>Assign to<select onChange={e=>setForm({...form,assignedTo:e.target.value})}><option value="">Unassigned</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>First follow-up (BS)<BsDateInput includeTime value={form.nextFollowUpAt||""} onChange={value=>setForm({...form,nextFollowUpAt:value})}/></label></>}
      {dialog === "task" && <><label className="full">Task title<input autoFocus value={form.title||""} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Type<select value={form.taskType||"general"} onChange={e=>setForm({...form,taskType:e.target.value})}>{["general","lead_follow_up","call","meeting","payment_collection"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Assign to<select value={form.assignedTo||""} onChange={e=>setForm({...form,assignedTo:e.target.value})}><option value="">Unassigned</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>Related lead<select value={form.leadId||""} onChange={e=>setForm({...form,leadId:e.target.value,partyId:""})}><option value="">None</option>{data.leads.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Or existing party<select value={form.partyId||""} onChange={e=>setForm({...form,partyId:e.target.value,leadId:""})}><option value="">None</option>{data.parties.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label className="full">Instructions / notes<textarea rows={3} value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></label><label>Due date & time (BS)<BsDateInput includeTime value={form.dueAt||""} onChange={value=>setForm({...form,dueAt:value})}/></label><label>Priority<select value={form.priority||"medium"} onChange={e=>setForm({...form,priority:e.target.value})}>{["low","medium","high","urgent"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label></>}
      {dialog === "activity" && <><label>Activity<select value={form.activityType||"call"} onChange={e=>setForm({...form,activityType:e.target.value})}>{["call","meeting","note","follow_up","payment_collection"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Handled by<select value={form.memberId||""} onChange={e=>setForm({...form,memberId:e.target.value})}><option value="">Office</option>{data.members.map((m:any)=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>Lead<select value={form.leadId ?? selectedLead} onChange={e=>setForm({...form,leadId:e.target.value,partyId:""})}><option value="">None</option>{data.leads.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Existing party<select value={form.partyId||""} onChange={e=>setForm({...form,partyId:e.target.value,leadId:""})}><option value="">None</option>{data.parties.map((x:any)=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label className="full">Title / subject<input value={form.subject||""} onChange={e=>setForm({...form,subject:e.target.value})} placeholder="Call summary, meeting note…"/></label><label className="full">What happened? / Remarks<textarea autoFocus rows={4} value={form.remarks||""} onChange={e=>setForm({...form,remarks:e.target.value})}/></label><label>Outcome<input value={form.outcome||""} placeholder="Interested, no answer…" onChange={e=>setForm({...form,outcome:e.target.value})}/></label><label>Next action (BS)<BsDateInput includeTime value={form.nextActionAt||""} onChange={value=>setForm({...form,nextActionAt:value})}/></label></>}
      {dialog === "member" && <><label>Name<input autoFocus onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Role<select onChange={e=>setForm({...form,role:e.target.value})}>{["admin","manager","accountant","staff"].map(x=><option value={x} key={x}>{label(x)}</option>)}</select></label><label>Email<input type="email" onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Phone<input onChange={e=>setForm({...form,phone:e.target.value})}/></label></>}
    </div><div className="modal-actions"><button onClick={() => setDialog(null)}>Cancel</button><button className="primary" onClick={() => act(dialog === "lead" ? "create_lead" : dialog === "task" ? "create_task" : dialog === "activity" ? "add_activity" : "create_member", dialog === "activity" ? {...form, leadId: form.leadId === undefined ? selectedLead : form.leadId, subject: form.subject || lead?.name} : form)}>Save</button></div></div></div>}
  </section>;
}
