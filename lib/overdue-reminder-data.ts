import { connectedReport } from "./connected-reports";
import { allReportRows } from "./report-query";
import { businessToday, reminderSnapshot } from "./overdue-reminder-model";

export async function companyOverdue(db: any, company: { id: string; name: string }, today = businessToday()) {
  const { data: fy, error } = await db.from("fiscal_years").select("id,start_ad,end_ad,label_bs").eq("company_id", company.id).lte("start_ad", today).order("start_ad", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!fy) return { asOf: today, rows: [], totalOverdue: 0 };
  const report = await connectedReport(db, company, fy, "aging_receivable", fy.start_ad, today, null, today);
  if (!report) throw new Error("Receivable ageing report could not be generated");
  const contacts = await allReportRows(db.from("parties").select("id,name,phone,email,auto_overdue_sms,auto_overdue_email").eq("company_id", company.id).order("id"));
  const byId = new Map(contacts.map((party: any) => [party.id, party]));
  const rows = report.rows.map((row: any) => reminderSnapshot(company, byId.get(row.id) || row, row, today)).filter(Boolean).sort((a: any, b: any) => b.overdue - a.overdue);
  return { asOf: today, rows, totalOverdue: Math.round(rows.reduce((sum: number, row: any) => sum + row.overdue, 0) * 100) / 100 };
}
