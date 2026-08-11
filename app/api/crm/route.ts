import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

async function getCompany(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data, error } = await supabase.from("companies").select("id,name").order("created_at").limit(1).single();
  if (error) throw error;
  return data;
}

async function snapshot() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server configuration is missing");
  const company = await getCompany(supabase);
  const [members, leads, tasks, activities, parties] = await Promise.all([
    supabase.from("team_members").select("*").eq("company_id", company.id).order("created_at"),
    supabase.from("leads").select("*,assignee:team_members(name),converted_party:parties(name)").eq("company_id", company.id).order("created_at", { ascending: false }),
    supabase.from("work_tasks").select("*,assignee:team_members(name),lead:leads(name),party:parties(name)").eq("company_id", company.id).order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("crm_activities").select("*,member:team_members(name),lead:leads(name),party:parties(name)").eq("company_id", company.id).order("happened_at", { ascending: false }).limit(200),
    supabase.from("parties").select("id,name,phone,place").eq("company_id", company.id).order("name"),
  ]);
  for (const result of [members, leads, tasks, activities, parties]) if (result.error) throw result.error;
  return { company, members: members.data || [], leads: leads.data || [], tasks: tasks.data || [], activities: activities.data || [], parties: parties.data || [] };
}

export async function GET() {
  try { return NextResponse.json(await snapshot()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CRM database error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase server configuration is missing");
    const body = await request.json();
    const company = await getCompany(supabase);
    const action = String(body.action || "");
    let error: { message: string } | null = null;

    if (action === "create_lead") {
      if (!String(body.name || "").trim() || !String(body.phone || "").trim()) return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
      ({ error } = await supabase.from("leads").insert({ company_id: company.id, name: String(body.name).trim(), phone: String(body.phone).trim(), source: body.source || "social_media", interest: body.interest || null, assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null }));
    } else if (action === "create_member") {
      if (!String(body.name || "").trim()) return NextResponse.json({ error: "Team member name is required" }, { status: 400 });
      ({ error } = await supabase.from("team_members").insert({ company_id: company.id, name: String(body.name).trim(), phone: body.phone || null, email: body.email || null, role: body.role || "staff" }));
    } else if (action === "create_task") {
      if (!String(body.title || "").trim()) return NextResponse.json({ error: "Task title is required" }, { status: 400 });
      ({ error } = await supabase.from("work_tasks").insert({ company_id: company.id, title: String(body.title).trim(), description: body.description || null, task_type: body.taskType || "general", priority: body.priority || "medium", assigned_to: body.assignedTo || null, lead_id: body.leadId || null, party_id: body.partyId || null, due_at: body.dueAt || null }));
    } else if (action === "add_activity") {
      if (!body.leadId && !body.partyId) return NextResponse.json({ error: "Select a lead or party" }, { status: 400 });
      const row = { company_id: company.id, activity_type: body.activityType || "note", subject: body.subject || null, remarks: String(body.remarks || "").trim(), outcome: body.outcome || null, member_id: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, happened_at: body.happenedAt || new Date().toISOString(), next_action_at: body.nextActionAt || null };
      if (!row.remarks) return NextResponse.json({ error: "Remarks are required" }, { status: 400 });
      ({ error } = await supabase.from("crm_activities").insert(row));
      if (!error && body.leadId) await supabase.from("leads").update({ last_contact_at: row.happened_at, next_follow_up_at: row.next_action_at }).eq("id", body.leadId);
      if (!error && body.nextActionAt) ({ error } = await supabase.from("work_tasks").insert({ company_id: company.id, title: body.taskTitle || `${body.activityType === "meeting" ? "Meeting" : "Follow up"}: ${body.subject || "client"}`, task_type: body.activityType === "meeting" ? "meeting" : body.activityType === "payment_collection" ? "payment_collection" : "call", assigned_to: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, due_at: body.nextActionAt, priority: body.priority || "medium" }));
    } else if (action === "update_lead") {
      ({ error } = await supabase.from("leads").update({ status: body.status, assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, updated_at: new Date().toISOString() }).eq("id", body.leadId).eq("company_id", company.id));
    } else if (action === "complete_task") {
      ({ error } = await supabase.from("work_tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", body.taskId).eq("company_id", company.id));
    } else if (action === "convert_lead") {
      ({ error } = await supabase.rpc("convert_lead_to_party", { p_lead_id: body.leadId }));
    } else return NextResponse.json({ error: "Unsupported CRM action" }, { status: 400 });
    if (error) throw error;
    return NextResponse.json(await snapshot(), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CRM database error" }, { status: 500 });
  }
}
