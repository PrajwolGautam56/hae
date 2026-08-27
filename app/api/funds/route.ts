import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { getSelectedBusinessCompany } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";
const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function context(requestedFy?: string) {
  await requireFeature("cash_bank");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase server configuration is missing");
  const company = await getSelectedBusinessCompany(db);
  const member = await getCurrentMember(db, company.id);
  if (!member) throw new Error("Active team access is required");
  const { data: years, error: yearError } = await db.from("fiscal_years").select("id,label_bs,start_ad,end_ad,status").eq("company_id", company.id).order("start_ad", { ascending: false });
  if (yearError) throw yearError;
  const today = businessDate();
  const fiscalYear = years?.find((year) => year.id === requestedFy) || years?.find((year) => year.start_ad <= today && year.end_ad >= today) || years?.[0];
  if (!fiscalYear) throw new Error("Fiscal year not found");
  return { db, company, member, fiscalYear };
}

async function snapshot(requestedFy?: string) {
  const { db, company, member, fiscalYear } = await context(requestedFy);
  const [accountsResult, movementsResult, membersResult, partiesResult] = await Promise.all([
    db.from("money_account_balances").select("id,account_type,name,bank_name,account_number,team_member_id,opening_balance,balance,active,created_at").eq("company_id", company.id).eq("active", true).order("account_type").order("name"),
    db.from("money_movements").select("id,movement_date,movement_type,from_account_id,to_account_id,amount,payment_mode,party_id,handled_by,generated_by,approved_by,title,reference,notes,status,created_at,from_account:money_accounts!money_movements_from_account_id_fkey(name,account_type),to_account:money_accounts!money_movements_to_account_id_fkey(name,account_type),party:parties(name),handler:team_members!money_movements_handled_by_fkey(name),generator:team_members!money_movements_generated_by_fkey(name),approver:team_members!money_movements_approved_by_fkey(name)").eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id).order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(250),
    db.from("team_members").select("id,name,email,role,active").eq("company_id", company.id).eq("active", true).order("name"),
    db.from("parties").select("id,name,party_type").eq("company_id", company.id).order("name"),
  ]);
  for (const result of [accountsResult, movementsResult, membersResult, partiesResult]) if (result.error) throw result.error;
  const movements = movementsResult.data || [];
  const accounts = (accountsResult.data || []).map((account) => ({ ...account, opening_balance: Number(account.opening_balance), balance: Number(account.balance) }));
  const visibleAccounts = ["admin", "manager", "accountant"].includes(member.role)
    ? accounts
    : accounts.filter((account) => account.account_type !== "employee_wallet" || account.team_member_id === member.id);
  const transferDestinations = accounts.map(({ id, account_type, name, team_member_id }) => ({ id, account_type, name, team_member_id }));
  return { company, fiscalYear, currentMember: member, accounts: visibleAccounts, transferDestinations, movements, members: membersResult.data || [], parties: partiesResult.data || [] };
}

export async function GET(request: Request) {
  try { return NextResponse.json(await snapshot(new URL(request.url).searchParams.get("fy") || undefined)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Funds database error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const state = await context(String(body.fiscalYearId || ""));
    const { db, company, member, fiscalYear } = state;
    const action = String(body.action || "");
    const privileged = ["admin", "manager", "accountant"].includes(member.role);
    if (action === "add_account") {
      if (!privileged) return NextResponse.json({ error: "Manager or accounts access is required" }, { status: 403 });
      const accountType = String(body.accountType || "bank");
      if (!["bank", "office_cash"].includes(accountType)) return NextResponse.json({ error: "Invalid account type" }, { status: 400 });
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
      const { error } = await db.from("money_accounts").insert({ company_id: company.id, account_type: accountType, name, bank_name: accountType === "bank" ? String(body.bankName || name).trim() : null, account_number: accountType === "bank" ? String(body.accountNumber || "").trim() || null : null, opening_balance: Number(body.openingBalance || 0) });
      if (error) throw error;
    } else if (action === "transfer") {
      const sourceId = String(body.fromAccountId || "");
      const destinationId = String(body.toAccountId || "");
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter a valid transfer amount" }, { status: 400 });
      if (!sourceId || !destinationId || sourceId === destinationId) return NextResponse.json({ error: "Select different source and destination accounts" }, { status: 400 });
      const { data: source, error: sourceError } = await db.from("money_accounts").select("id,team_member_id").eq("id", sourceId).eq("company_id", company.id).single();
      if (sourceError) throw sourceError;
      if (!privileged && source.team_member_id !== member.id) return NextResponse.json({ error: "You can transfer only from your own wallet" }, { status: 403 });
      const { error } = await db.rpc("record_money_transfer", { p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_from_account_id: sourceId, p_to_account_id: destinationId, p_amount: amount, p_date: String(body.date || businessDate()), p_title: String(body.title || "Cash handover / transfer"), p_notes: String(body.notes || ""), p_generated_by: member.id, p_approved_by: privileged ? member.id : null });
      if (error) throw error;
    } else if (action === "outgoing_payment") {
      const sourceId = String(body.fromAccountId || "");
      const { data: source, error: sourceError } = await db.from("money_accounts").select("id,team_member_id").eq("id", sourceId).eq("company_id", company.id).single();
      if (sourceError) throw sourceError;
      if (!privileged && source.team_member_id !== member.id) return NextResponse.json({ error: "You can pay only from your own wallet" }, { status: 403 });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter a valid amount" }, { status: 400 });
      const { error } = await db.rpc("record_accounting_voucher", { p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_party_id: body.partyId || null, p_type: body.asExpense ? "expense" : "payment", p_amount: amount, p_date: String(body.date || businessDate()), p_narration: String(body.title || "Payment given"), p_payment_mode: String(body.paymentMode || "Cash"), p_generated_by: member.id, p_handled_by: member.id, p_money_account_id: sourceId, p_movement_status: "posted" });
      if (error) throw error;
    } else return NextResponse.json({ error: "Unsupported funds action" }, { status: 400 });
    return NextResponse.json(await snapshot(fiscalYear.id), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save funds transaction" }, { status: 500 });
  }
}
