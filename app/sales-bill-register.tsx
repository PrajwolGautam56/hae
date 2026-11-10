"use client";

import { useEffect, useState } from "react";
import type { SalesSeries } from "../lib/sales-register";
import "./sales-bill-register.css";

type Bill = { id: string; voucher_no: string; sequence_no: number; voucher_date: string; total: number; document_status: string; party: { name: string } | null };
type Register = { rows: Bill[]; total: number; page: number; pageSize: number; pages: number };
const money = (amount: number) => `Rs. ${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SalesBillRegister({ fiscalYearId, refreshVersion, onNewBill, onOpenBill, formatDate }: {
  fiscalYearId?: string; refreshVersion: number; onNewBill: () => void; onOpenBill: (id: string) => void; formatDate: (date: string) => string;
}) {
  const [search, setSearch] = useState("");
  const [series, setSeries] = useState<SalesSeries>("all");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: Register; error?: string } | null>(null);
  const key = JSON.stringify([fiscalYearId, search, series, page, refreshVersion, retry]);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const loading = !current;

  useEffect(() => {
    if (!fiscalYearId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ fy: fiscalYearId, search, series, page: String(page) });
        const response = await fetch(`/api/sales-register?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Sales register could not load");
        if (controller.signal.aborted) return;
        // If the last row on a page was removed concurrently, return to a valid page.
        if (page > body.pages) { setPage(body.pages); return; }
        setResult({ key, data: body });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Sales register could not load" });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fiscalYearId, search, series, page, key]);

  const empty = search.trim() || series !== "all" ? "No matching bill in this fiscal year. Change the number or series, or clear the search." : "No sales invoice in this fiscal year.";
  const status = (bill: Bill) => <span className={bill.document_status === "cancelled" ? "cancelled-chip" : "paid-chip"}>{bill.document_status === "cancelled" ? "Cancelled" : "Posted"}</span>;
  const amount = (bill: Bill) => money(bill.document_status === "cancelled" ? 0 : bill.total);

  return <article className="card sales-list sales-bill-register">
    <div className="card-title"><div><h3>Sales bill register</h3><p>All bills in the selected fiscal year · latest first</p></div><button className="primary soft" onClick={onNewBill}>＋ New bill</button></div>
    <div className="bill-register-filters">
      <label>Find invoice number<input type="search" value={search} maxLength={100} placeholder="e.g. 1, 55 or NB 1" onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <label>Bill series<select value={series} onChange={event => { setSeries(event.target.value as SalesSeries); setPage(1); }}><option value="all">All series</option><option value="standard">VAT / legacy bills</option><option value="non_vat">Non-VAT · NB</option></select></label>
      {(search || series !== "all") && <button className="primary soft" onClick={() => { setSearch(""); setSeries("all"); setPage(1); }}>Clear search</button>}
      <p>A number searches the exact serial, across the whole year—not just the visible page. Use NB 1 for a non-VAT bill.</p>
    </div>
    <div className="bill-register-feedback" role="status" aria-live="polite">
      {loading ? "Loading bills…" : current.error ? <><span role="alert">{current.error} Existing records have not been removed.</span><button className="primary soft" onClick={() => setRetry(value => value + 1)}>Retry</button></> : data ? `${data.total} bill${data.total === 1 ? "" : "s"} found${data.total ? ` · Showing ${(page - 1) * data.pageSize + 1}–${Math.min(page * data.pageSize, data.total)}` : ""}` : null}
    </div>
    {data && <>
      <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>PARTY</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>
        {data.rows.map(bill => <tr key={bill.id}><td><button className="bill-register-reference" onClick={() => onOpenBill(bill.id)} aria-label={`View invoice ${bill.voucher_no || bill.sequence_no}`}>{bill.voucher_no || bill.sequence_no}</button></td><td>{formatDate(bill.voucher_date)}</td><td>{bill.document_status === "cancelled" ? "Cancelled bill" : bill.party?.name || "Cash / General"}</td><td className="debit">{amount(bill)}</td><td>{status(bill)}</td></tr>)}
        {!data.rows.length && <tr><td colSpan={5} className="empty-year">{empty}</td></tr>}
      </tbody></table></div>
      <div className="mobile-register-list">
        {data.rows.map(bill => <button key={bill.id} onClick={() => onOpenBill(bill.id)}><span><strong>Invoice #{bill.voucher_no || bill.sequence_no}</strong><small>{bill.document_status === "cancelled" ? "Cancelled bill" : bill.party?.name || "Cash / General"}</small></span><span className="mobile-register-amount"><strong>{amount(bill)}</strong><small>{formatDate(bill.voucher_date)}</small></span><span className="mobile-register-meta"><span>{bill.voucher_no}</span>{status(bill)}</span></button>)}
        {!data.rows.length && <div className="dashboard-empty">{empty}</div>}
      </div>
      {data.total > 0 && <nav className="bill-register-pagination" aria-label="Sales bill pages"><span>Page {page} of {data.pages}</span><div><button className="primary soft" disabled={page === 1} onClick={() => setPage(1)}>First</button><button className="primary soft" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="primary soft" disabled={page >= data.pages} onClick={() => setPage(value => value + 1)}>Next</button><button className="primary soft" disabled={page >= data.pages} onClick={() => setPage(data.pages)}>Last</button></div></nav>}
    </>}
  </article>;
}
