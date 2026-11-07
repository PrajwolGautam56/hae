import { after, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { sendTeamEmail } from "../../../lib/resend-email";
import { NEPAL_PROVINCES, provinceForDistrict } from "../../../lib/nepal-address";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { assertCompanyRecord, assertOptionalCompanyRecord } from "../../../lib/company-ownership";
import { taskInput, TASK_STAGES } from "../../../lib/task-workflow";
import { allReportRows } from "../../../lib/report-query";

export const dynamic = "force-dynamic";

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
  const { company, member } = await getBusinessContext(supabase);
  const [members, leads, tasks, activities, parties] = await Promise.all([
    supabase.from("team_members").select("*").eq("company_id", company.id).order("created_at"),
    supabase.from("leads").select("*,assignee:team_members!leads_company_assignee_fkey(name),converted_party:parties!leads_company_converted_party_fkey(name)").eq("company_id", company.id).order("created_at", { ascending: false }),
    allReportRows(supabase.from("work_tasks").select("*,assignee:team_members!tasks_company_assignee_fkey(name),lead:leads!tasks_company_lead_fkey(name),party:parties!tasks_company_party_fkey(name)").eq("company_id", company.id).order("due_at", { ascending: true, nullsFirst: false }).order("id")),
    supabase.from("crm_activities").select("*,member:team_members!activity_company_member_fkey(name),lead:leads!activity_company_lead_fkey(name),party:parties!activity_company_party_fkey(name)").eq("company_id", company.id).order("happened_at", { ascending: false }).limit(200),
    supabase.from("parties").select("id,name,phone,place").eq("company_id", company.id).order("name"),
  ]);
  for (const result of [members, leads, activities, parties]) if (result.error) throw result.error;
  return { company, currentMember: member, members: members.data || [], leads: leads.data || [], tasks, activities: activities.data || [], parties: parties.data || [] };
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

export async function GET(request: Request) {
  try { await requireFeature(new URL(request.url).searchParams.get("section") === "tasks" ? "tasks" : "crm"); return NextResponse.json(await snapshot()); }
  catch (error) { return NextResponse.json({ error: (error as {message?:string})?.message || "CRM database error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await requireFeature(["create_task", "update_task", "move_task", "complete_task"].includes(body.action) ? "tasks" : "crm");
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase server configuration is missing");
    const { company, member: currentMember } = await getBusinessContext(supabase);
    const action = String(body.action || "");
    let error: { message: string } | null = null;

    if (action === "create_lead") {
      if (!String(body.name || "").trim() || !String(body.phone || "").trim()) return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
      await assertOptionalCompanyRecord(supabase, "team_members", body.assignedTo, company.id, "Lead assignee");
      ({ error } = await supabase.from("leads").insert({ company_id: company.id, name: String(body.name).trim(), phone: String(body.phone).trim(), source: body.source || "social_media", interest: cleanOptional(body.interest), assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, ...leadLocation(body) }));
    } else if (action === "create_member") {
      if (currentMember.role !== "admin") return NextResponse.json({ error: "Only a company administrator can add team members" }, { status: 403 });
      if (!String(body.name || "").trim()) return NextResponse.json({ error: "Team member name is required" }, { status: 400 });
      ({ error } = await supabase.from("team_members").insert({ company_id: company.id, name: String(body.name).trim(), phone: body.phone || null, email: body.email || null, role: body.role || "staff" }));
    } else if (["create_task", "update_task", "move_task", "complete_task"].includes(action)) {
      const moving = action === "move_task" || action === "complete_task";
      const input = moving ? { status: action === "complete_task" ? "done" : body.status } : taskInput(body);
      if (!TASK_STAGES.some(stage => stage.id === input.status)) return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
      if (action !== "create_task") await assertCompanyRecord(supabase, "work_tasks", body.taskId, company.id, "Task");
      await Promise.all([
        assertOptionalCompanyRecord(supabase, "team_members", body.assignedTo, company.id, "Task assignee"),
        assertOptionalCompanyRecord(supabase, "leads", body.leadId, company.id, "Task lead"),
        assertOptionalCompanyRecord(supabase, "parties", body.partyId, company.id, "Task party"),
      ]);
      ({ error } = await supabase.rpc("save_work_task", { p_company_id: company.id, p_actor_id: currentMember.id, p_task_id: action === "create_task" ? null : body.taskId, p_input: input, p_move_only: moving, p_expected_updated_at: body.expectedUpdatedAt || null, p_request_id: body.requestId || null }));
      // Task persistence must not depend on an email provider responding.
      if (!error && !moving && body.assignedTo) after(() => notifyMember(supabase, body.assignedTo, `Task: ${body.title}`, action === "create_task" ? "A new task was assigned to you" : "Your task was updated", String(body.title)));
    } else if (action === "add_activity") {
      if (!body.leadId && !body.partyId) return NextResponse.json({ error: "Select a lead or party" }, { status: 400 });
      await Promise.all([
        assertOptionalCompanyRecord(supabase, "team_members", body.memberId, company.id, "Activity owner"),
        assertOptionalCompanyRecord(supabase, "leads", body.leadId, company.id, "Activity lead"),
        assertOptionalCompanyRecord(supabase, "parties", body.partyId, company.id, "Activity party"),
      ]);
      const row = { company_id: company.id, activity_type: body.activityType || "note", subject: body.subject || null, remarks: String(body.remarks || "").trim(), outcome: body.outcome || null, member_id: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, happened_at: body.happenedAt || new Date().toISOString(), next_action_at: body.nextActionAt || null };
      if (!row.remarks) return NextResponse.json({ error: "Remarks are required" }, { status: 400 });
      ({ error } = await supabase.from("crm_activities").insert(row));
      if (!error && body.leadId) await supabase.from("leads").update({ last_contact_at: row.happened_at, next_follow_up_at: row.next_action_at }).eq("id", body.leadId).eq("company_id", company.id);
      if (!error && body.nextActionAt) ({ error } = await supabase.from("work_tasks").insert({ company_id: company.id, title: body.taskTitle || `${body.activityType === "meeting" ? "Meeting" : "Follow up"}: ${body.subject || "client"}`, task_type: body.activityType === "meeting" ? "meeting" : body.activityType === "payment_collection" ? "payment_collection" : "call", assigned_to: body.memberId || null, lead_id: body.leadId || null, party_id: body.partyId || null, due_at: body.nextActionAt, priority: body.priority || "medium" }));
      if (!error && body.nextActionAt) await notifyMember(supabase, body.memberId || null, "Follow-up scheduled", body.taskTitle || "A client follow-up was scheduled", `The next action is due ${new Date(body.nextActionAt).toLocaleString("en-GB")}.`);
    } else if (action === "update_lead") {
      await Promise.all([assertCompanyRecord(supabase, "leads", body.leadId, company.id, "Lead"), assertOptionalCompanyRecord(supabase, "team_members", body.assignedTo, company.id, "Lead assignee")]);
      ({ error } = await supabase.from("leads").update({ status: body.status, assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, updated_at: new Date().toISOString() }).eq("id", body.leadId).eq("company_id", company.id));
    } else if (action === "update_lead_profile") {
      if (!String(body.name || "").trim() || !String(body.phone || "").trim()) return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
      await Promise.all([assertCompanyRecord(supabase, "leads", body.leadId, company.id, "Lead"), assertOptionalCompanyRecord(supabase, "team_members", body.assignedTo, company.id, "Lead assignee")]);
      ({ error } = await supabase.from("leads").update({ name: String(body.name).trim(), phone: String(body.phone).trim(), source: body.source || "social_media", interest: cleanOptional(body.interest), assigned_to: body.assignedTo || null, next_follow_up_at: body.nextFollowUpAt || null, ...leadLocation(body), updated_at: new Date().toISOString() }).eq("id", body.leadId).eq("company_id", company.id));
    } else if (action === "convert_lead") {
      await assertCompanyRecord(supabase, "leads", body.leadId, company.id, "Lead");
      ({ error } = await supabase.rpc("convert_lead_to_party", { p_lead_id: body.leadId }));
    } else return NextResponse.json({ error: "Unsupported CRM action" }, { status: 400 });
    if (error) throw error;
    return NextResponse.json(await snapshot(), { status: 201 });
  } catch (error) {
    const message = (error as {message?:string})?.message || "CRM database error";
    return NextResponse.json({ error: /save_work_task.*(schema cache|does not exist)/i.test(message) ? "Task workflow is not enabled yet. Apply migration 202609260001, then retry." : message }, { status: 500 });
  }
}
