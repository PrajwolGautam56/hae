"use client";

import { useEffect, useState } from "react";

const money = (n: number) => `Rs. ${Math.abs(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typeLabel: Record<string,string> = { sale: "Sales Invoice", receipt: "Payment Receipt", purchase: "Purchase", expense: "Office Expense", journal: "Journal" };

export default function ReportsWorkspace({ parties, fiscalYear, initialPartyId, onNotice }: { parties: any[]; fiscalYear: any; initialPartyId: string; onNotice: (x:string)=>void }) {
  const now = new Date().toISOString().slice(0,10);
  const [partyId,setPartyId] = useState(initialPartyId || "");
  const [type,setType] = useState<"daybook"|"sales">("daybook");
  const [preset,setPreset] = useState<"today"|"fy"|"custom">(initialPartyId ? "fy" : "today");
  const [from,setFrom] = useState(initialPartyId ? fiscalYear?.start_ad || now : now);
  const [to,setTo] = useState(initialPartyId ? fiscalYear?.end_ad || now : now);
  const [data,setData] = useState<any>(null);
  const [loading,setLoading] = useState(false);

  useEffect(()=>{ if(initialPartyId){setPartyId(initialPartyId);setPreset("fy");setFrom(fiscalYear?.start_ad||now);setTo(fiscalYear?.end_ad||now)} },[initialPartyId,fiscalYear?.id]);
  useEffect(()=>{ if(!fiscalYear?.id)return; const timer=setTimeout(run,80); return()=>clearTimeout(timer) },[partyId,type,from,to,fiscalYear?.id]);
  function choosePreset(value: "today"|"fy"|"custom") { setPreset(value); if(value==="today"){setFrom(now);setTo(now)} if(value==="fy"){setFrom(fiscalYear.start_ad);setTo(fiscalYear.end_ad)} }
  async function run(){setLoading(true);try{const q=new URLSearchParams({fiscalYearId:fiscalYear.id,type,from,to});if(partyId)q.set("partyId",partyId);const r=await fetch(`/api/reports?${q}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d)}catch(e){onNotice(e instanceof Error?e.message:"Report could not load")}finally{setLoading(false)}}
  const balance = Number(data?.closing || 0);
  return <section className="reports-workspace">
    <div className="module-hero report-hero"><div><span>{partyId ? "PARTY LEDGER" : "REPORT CENTER"}</span><h2>{data?.party?.name || (type==="sales"?"Sales report":"Day book")}</h2><p>{partyId && data?.party ? [data.party.place,data.party.phone,data.party.tax_no ? `PAN: ${data.party.tax_no}` : ""].filter(Boolean).join(" · ") || "Complete debit, credit and running balance statement." : "Filter daily or date-range business transactions."}</p></div><button className="primary" onClick={()=>window.print()}>⇩ Print / PDF</button></div>
    <article className="card report-filters">
      <label>Report<select value={type} onChange={e=>setType(e.target.value as any)}><option value="daybook">Full Day Book</option><option value="sales">Sales Report</option></select></label>
      <label>Party / Client<select value={partyId} onChange={e=>setPartyId(e.target.value)}><option value="">All parties</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Period<select value={preset} onChange={e=>choosePreset(e.target.value as any)}><option value="today">Today</option><option value="fy">Full fiscal year</option><option value="custom">Custom dates</option></select></label>
      <label>From<input type="date" value={from} onChange={e=>{setPreset("custom");setFrom(e.target.value)}}/></label>
      <label>To<input type="date" value={to} onChange={e=>{setPreset("custom");setTo(e.target.value)}}/></label>
      <button onClick={run} disabled={loading}>{loading?"Loading…":"Apply report"}</button>
    </article>
    {partyId && data && <div className="ledger-summary">
      <article><small>OPENING BALANCE</small><strong>{money(data.opening)}</strong><span>{data.opening>=0?"Debit":"Credit"}</span></article>
      <article><small>PERIOD DEBIT</small><strong>{money(data.totals.debit)}</strong><span>Sales / receivable</span></article>
      <article><small>PERIOD CREDIT</small><strong>{money(data.totals.credit)}</strong><span>Receipts / payable</span></article>
      <article className={balance>=0?"receive":"pay"}><small>CLOSING BALANCE</small><strong>{money(balance)}</strong><span>{balance>=0?"To receive from party":"To pay party"}</span></article>
    </div>}
    {!partyId && data && <div className="ledger-summary"><article><small>TOTAL SALES</small><strong>{money(data.totals.sales)}</strong></article><article><small>PURCHASES</small><strong>{money(data.totals.purchases)}</strong></article><article><small>PAYMENTS RECEIVED</small><strong>{money(data.totals.receipts)}</strong></article><article><small>EXPENSES</small><strong>{money(data.totals.expenses)}</strong></article></div>}
    <article className="card report-table"><div className="card-title"><div><h3>{partyId?"Ledger statement":type==="sales"?"Sales register":"Day book register"}</h3><p>{from} to {to} · {data?.rows?.length || 0} entries</p></div></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>REFERENCE</th><th>TYPE</th>{!partyId&&<th>PARTY / ACCOUNT</th>}<th>PARTICULARS</th><th>DEBIT</th><th>CREDIT</th>{partyId&&<th>BALANCE</th>}</tr></thead><tbody>{data?.rows?.length ? data.rows.map((r:any)=><tr key={r.id}><td>{r.date}</td><td><strong>{r.ref}</strong></td><td>{typeLabel[r.type]||r.type}</td>{!partyId&&<td>{r.party}</td>}<td>{r.particulars}{r.paymentMode?` · ${r.paymentMode}`:""}</td><td className="debit">{r.debit?money(r.debit):"—"}</td><td className="credit">{r.credit?money(r.credit):"—"}</td>{partyId&&<td><strong>{money(r.balance)} {r.balance>=0?"Dr":"Cr"}</strong></td>}</tr>):<tr><td className="empty-year" colSpan={partyId?8:7}>{loading?"Loading report…":"No transactions for this filter."}</td></tr>}</tbody>{data&&<tfoot><tr><td colSpan={partyId?5:5}><strong>Period total</strong></td><td className="debit"><strong>{money(data.totals.debit)}</strong></td><td className="credit"><strong>{money(data.totals.credit)}</strong></td>{partyId&&<td><strong>{money(data.closing)}</strong></td>}</tr></tfoot>}</table></div></article>
  </section>
}
