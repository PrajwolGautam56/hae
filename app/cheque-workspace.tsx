"use client";

import { useEffect, useState } from "react";
import { formatBs } from "../lib/nepali-date";

const money = (value: number) =>
  `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ChequeWorkspace({ onNotice }: { onNotice: (message: string) => void }) {
  const [data, setData] = useState<any>({ rows: [], accounts: [], counts: {} });
  const [filter, setFilter] = useState("pending");
  const [busy, setBusy] = useState("");
  const [clearing, setClearing] = useState<any>(null);
  const [destinationAccountId, setDestinationAccountId] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/cheques", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Cheque register could not load");
    }
  }

  useEffect(() => { load(); }, []);

  async function update(id: string, status: string, accountId?: string) {
    setBusy(id);
    try {
      const response = await fetch("/api/cheques", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chequeId: id, status, destinationAccountId: accountId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
      setClearing(null);
      onNotice(status === "cleared" ? "Cheque cleared and amount posted to the selected account" : "Cheque status updated");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy("");
    }
  }

  function openClearance(cheque: any) {
    setClearing(cheque);
    setDestinationAccountId(data.accounts?.[0]?.id || "");
  }

  const rows = data.rows.filter((row: any) =>
    filter === "all" || row.cheque_status === filter || (filter === "due" && (row.due_today || row.overdue)),
  );

  return <section className="cheque-workspace">
    <div className="module-hero cheque-hero">
      <div><span>CHEQUE CONTROL</span><h2>Cheque register</h2><p>Received cheques stay pending here. Bank or office cash is credited only after clearance.</p></div>
      <div className="cheque-hero-count"><strong>{data.counts.pending || 0}</strong><small>Pending clearance</small></div>
    </div>
    <div className="cheque-stats">
      <button className={filter === "due" ? "active" : ""} onClick={() => setFilter("due")}><span>Due / overdue</span><strong>{(data.counts.dueToday || 0) + (data.counts.overdue || 0)}</strong><small>{data.counts.dueToday || 0} to exchange today</small></button>
      <button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}><span>All pending</span><strong>{data.counts.pending || 0}</strong><small>Cheque held, no account credited</small></button>
      <button className={filter === "cleared" ? "active" : ""} onClick={() => setFilter("cleared")}><span>Cleared</span><strong>{data.counts.cleared || 0}</strong><small>Deposited to bank or office cash</small></button>
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><span>All cheques</span><strong>{data.rows.length}</strong><small>Full cheque history</small></button>
    </div>
    <article className="card cheque-list">
      <div className="card-title"><div><h3>{filter === "due" ? "Cheques requiring attention" : filter === "pending" ? "Pending cheques" : filter === "cleared" ? "Cleared cheques" : "All cheque records"}</h3><p>आज: {formatBs(data.today)}</p></div></div>
      {rows.length ? <div className="cheque-rows">{rows.map((row: any) => <div className={`cheque-row ${row.overdue ? "overdue" : ""}`} key={row.id}>
        <div className="cheque-date"><strong>{formatBs(row.cheque_exchange_date)}</strong><small>{row.due_today ? "Exchange today" : row.overdue ? `${row.days_pending} days overdue` : "Exchange date"}</small></div>
        <div className="cheque-party"><strong>{row.party}</strong><small>{row.phone || "No phone"} · Receipt {row.voucher_no}</small></div>
        <div><span className="cheque-number">{row.cheque_no || "No cheque no."}</span><small>{row.cheque_bank || "Bank not specified"}</small></div>
        <div className="cheque-amount"><strong>{money(row.total)}</strong><small>{row.cheque_status === "cleared" ? `Cleared into ${row.money_account?.name || "account"}` : `Received ${formatBs(row.voucher_date)}`}</small></div>
        <span className={`cheque-status ${row.cheque_status}`}>{row.cheque_status}</span>
        <div className="cheque-actions">{row.cheque_status === "pending" ? <><button className="clear-cheque" disabled={busy === row.id} onClick={() => openClearance(row)}>✓ Exchange / clear</button><button disabled={busy === row.id} onClick={() => update(row.id, "cancelled")}>Cancel</button></> : <button disabled={busy === row.id} onClick={() => update(row.id, "pending")}>Move to pending</button>}</div>
      </div>)}</div> : <div className="empty-cheques"><i>✓</i><h3>No cheques in this view</h3><p>Cheque receipts will automatically appear here.</p></div>}
    </article>
    {clearing && <div className="modal-backdrop" onMouseDown={() => setClearing(null)}>
      <section className="modal compact-modal clearance-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><small>CHEQUE CLEARANCE</small><h2>Where was this cheque deposited?</h2></div><button onClick={() => setClearing(null)}>×</button></div>
        <div className="form-grid">
          <div className="clearance-summary full"><span><small>PARTY</small><strong>{clearing.party}</strong></span><span><small>CHEQUE</small><strong>{clearing.cheque_no}</strong></span><span><small>AMOUNT</small><strong>{money(clearing.total)}</strong></span></div>
          <label className="full">Cleared into bank / office cash<select autoFocus value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}><option value="">Select destination account</option>{data.accounts.map((account: any) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
          <p className="clearance-help full">The selected account will be credited only after you confirm. This creates the account transaction and marks the cheque cleared together.</p>
        </div>
        <div className="modal-actions"><button onClick={() => setClearing(null)}>Cancel</button><button className="primary" disabled={!destinationAccountId || busy === clearing.id} onClick={() => update(clearing.id, "cleared", destinationAccountId)}>{busy === clearing.id ? "Posting…" : "Confirm clearance"}</button></div>
      </section>
    </div>}
  </section>;
}
