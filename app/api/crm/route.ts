import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { sendTeamEmail } from "../../../lib/resend-email";
import { NEPAL_PROVINCES, provinceForDistrict } from "../../../lib/nepal-address";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";

async function getCompany(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  return (await getBusinessContext(supabase)).company;
}

function cleanOptional(value: unknown) {
  const result = String(value || "").trim();
  return result || null;
}

function leadLocation(body: Record<string, unknown>) {
  let province = cleanOptional(body.province);
  const district = cleanOptional(body.district);
  const city = cleanOptional(body.city);
  const address = cleanOptional(body.address);
  if (province && !NEPAL_PROVINCES.includes(province as (typeof NEPAL_PROVINCES)[number])) throw new Error("Select a valid Nepal province");
  if (district) {
    const matchingProvince = provinceForDistrict(district);
    if (!matchingProvince) throw new Error("Select a valid Nepal district");
    if (province && province !== matchingProvince) throw new Error(`${district} is not inside ${province}`);
    province ||= matchingProvince;
  }
  return { province, district, city, address };
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

async function notifyMember(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  memberId: string | null,
  subject: string,
  heading: string,
  message: string,
) {
  if (!memberId) return;
  const { data } = await supabase.from("team_members").select("name,email").eq("id", memberId).maybeSingle();
  if (!data?.email) return;
  try {
    await sendTeamEmail({ to: data.email, subject, heading, message: `Hi ${data.name}, ${message}`, actionLabel: "Open Hamro Khata" });
  } catch (error) {
    console.error("Team notification email failed", error);
  }
}

export async function GET() {
  try { await requireFeature("crm"); return NextResponse.json(await snapshot()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CRM database error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await requireFeature("crm");
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase server configuration is missing");
    const body = await request.json();
    const company = await getCompany(supabase);
    const action = String(body.action || "");
    let error: { message: string } | null = null;

    if (action === "create_lead") {
      if (!String(body.name || "").trim() || !String(body.phone || "").trim()) return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
      ({ error } = await supabase.from("leads").insert({ company_id: company.id, name: String(body.name).trim(), phone: String(body.phone).trim(), source: body.source || "social_media", interest: cleanOptional(body.interest), assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, ...leadLocation(body) }));
    } else if (action === "create_member") {
      if (!String(body.name || "").trim()) return NextResponse.json({ error: "Team member name is required" }, { status: 400 });
      ({ error } = await supabase.from("team_members").insert({ company_id: company.id, name: String(body.name).trim(), phone: body.phone || null, email: body.email || null, role: body.role || "staff" }));
    } else if (action === "create_task") {
      if (!String(body.title || "").trim()) return NextResponse.json({ error: "Task title is required" }, { status: 400 });
      ({ error } = await supabase.from("work_tasks").insert({ company_id: company.id, title: String(body.title).trim(), description: body.description || null, task_type: body.taskType || "general", priority: body.priority || "medium", assigned_to: body.assignedTo || null, lead_id: body.leadId || null, party_id: body.partyId || null, due_at: body.dueAt || null }));
      if (!error) await notifyMember(supabase, body.assignedTo || null, `New task: ${body.title}`, "A new task was assigned to you", `${body.title}${body.dueAt ? ` · Due ${new Date(body.dueAt).toLocaleString("en-GB")}` : ""}.`);
    } else if (action === "add_activity") {
      if (!body.leadId && !body.partyId) return NextResponse.json({ error: "Select a lead or party" }, { status: 400 });
      const row = { company_id: company.id, activity_type: body.activityType || "note", subject: body.subject || null, remarks: String(body.remarks || "").trim(), outcome: body.outcome || null, member_id: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, happened_at: body.happenedAt || new Date().toISOString(), next_action_at: body.nextActionAt || null };
      if (!row.remarks) return NextResponse.json({ error: "Remarks are required" }, { status: 400 });
      ({ error } = await supabase.from("crm_activities").insert(row));
      if (!error && body.leadId) await supabase.from("leads").update({ last_contact_at: row.happened_at, next_follow_up_at: row.next_action_at }).eq("id", body.leadId);
      if (!error && body.nextActionAt) ({ error } = await supabase.from("work_tasks").insert({ company_id: company.id, title: body.taskTitle || `${body.activityType === "meeting" ? "Meeting" : "Follow up"}: ${body.subject || "client"}`, task_type: body.activityType === "meeting" ? "meeting" : body.activityType === "payment_collection" ? "payment_collection" : "call", assigned_to: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, due_at: body.nextActionAt, priority: body.priority || "medium" }));
      if (!error && body.nextActionAt) await notifyMember(supabase, body.memberId || null, "Follow-up scheduled", body.taskTitle || "A client follow-up was scheduled", `The next action is due ${new Date(body.nextActionAt).toLocaleString("en-GB")}.`);
    } else if (action === "update_lead") {
      ({ error } = await supabase.from("leads").update({ status: body.status, assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, updated_at: new Date().toISOString() }).eq("id", body.leadId).eq("company_id", company.id));
    } else if (action === "update_lead_profile") {
      if (!String(body.name || "").trim() || !String(body.phone || "").trim()) return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
      ({ error } = await supabase.from("leads").update({ name: String(body.name).trim(), phone: String(body.phone).trim(), source: body.source || "social_media", interest: cleanOptional(body.interest), assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, ...leadLocation(body), updated_at: new Date().toISOString() }).eq("id", body.leadId).eq("company_id", company.id));
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
