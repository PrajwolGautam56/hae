"use client";

import {formatBs} from "../lib/nepali-date";
import ReportVoucherReference from "./report-voucher-reference";
import "./party-due-summary.css";

const money=(value:number)=>`Rs. ${Math.abs(Number(value)||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function PartyDueSummary({data,onOpenVoucher}:{data:any;onOpenVoucher?:(id:string)=>void}) {
  if(!data)return null;
  return <section className="party-due-summary" aria-label="Party outstanding and overdue amounts">
    <div className="party-due-heading"><h3>Outstanding & overdue</h3><p>As of {formatBs(data.asOf)} · Whole outstanding account, not only entries inside the From-date filter.</p></div>
    <div className="party-due-metrics">
      <article><small>TOTAL TO RECEIVE</small><strong>{money(data.total)}</strong><span>Overdue + not yet overdue + unknown due date</span></article>
      <article className={data.overdue>0?"is-overdue":"is-clear"}><small>OVERDUE · DUE DATE PASSED</small><strong>{money(data.overdue)}</strong><span>{data.overdue>0?`${data.overdueEntries} outstanding entries · oldest ${data.oldestOverdueDays} days overdue`:"No past-due balance"}</span></article>
      <article className="is-clear"><small>NOT YET OVERDUE</small><strong>{money(data.notDue)}</strong><span>Includes {money(data.dueToday)} due today</span></article>
      <article className="is-unknown"><small>DUE DATE UNKNOWN</small><strong>{money(data.unknown)}</strong><span>Imported opening without its original due date; not assumed overdue</span></article>
    </div>
    {data.advance>0&&<p className="party-due-note">Party credit / advance: <strong>{money(data.advance)}</strong>. This is not an unpaid receivable.</p>}
    <p className="party-due-note">Receipts and other party credits settle the oldest unpaid entry first (FIFO). Only the unpaid remainder is aged. Due today is not overdue; a bill without a due date uses its invoice date.</p>
    <details open><summary>Bill-wise outstanding · {data.details.length} entries</summary><div className="table-wrap"><table>
      <thead><tr><th>BILL DATE (BS)</th><th>BILL / REFERENCE</th><th>DUE DATE (BS)</th><th>STATUS</th><th>ORIGINAL</th><th>SETTLED / ADJUSTED</th><th>STILL OUTSTANDING</th></tr></thead>
      <tbody>{data.details.map((bill:any,index:number)=><tr key={`${bill.voucherId||bill.reference}:${index}`}><td>{bill.invoiceDate?formatBs(bill.invoiceDate):"—"}</td><td><ReportVoucherReference voucherId={bill.voucherId} reference={bill.reference} label="outstanding bill" onOpen={onOpenVoucher}/></td><td>{bill.due?formatBs(bill.due):"Unknown"}{bill.dueSource==="invoice_date"&&<small>Invoice date fallback</small>}</td><td><span className={`party-due-status ${bill.status}`}>{bill.status==="overdue"?`${bill.overdueDays} days overdue`:bill.status==="due_today"?"Due today":bill.status==="unknown"?"Due date unknown":"Not due yet"}</span></td><td>{money(bill.originalAmount)}</td><td>{money(bill.settledAmount)}</td><td><strong>{money(bill.remaining)}</strong></td></tr>)}{!data.details.length&&<tr><td colSpan={7} className="empty-year">No unpaid receivable as of this date.</td></tr>}</tbody>
    </table></div></details>
  </section>;
}
