"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatBs } from "../lib/nepali-date";
import { invalidateClientCache } from "../lib/client-data-cache";
import "./party-opening.css";

const money = (n: number) => `Rs. ${Math.abs(Number(n) || 0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function PartyOpeningEditor({partyId,fiscalYearId,onClose,onSaved}: {
  partyId:string; fiscalYearId:string; onClose:()=>void; onSaved:()=>void;
}) {
  const [data,setData] = useState<any>(null);
  const [amount,setAmount] = useState("");
  const [side,setSide] = useState("debit");
  const [source,setSource] = useState("manual");
  const [note,setNote] = useState("");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/party-opening?${new URLSearchParams({partyId,fiscalYearId})}`,{cache:"no-store",signal:controller.signal})
      .then(async response => { const body=await response.json(); if(!response.ok)throw new Error(body.error||"Could not load opening balance"); return body; })
      .then(body => {setData(body);setAmount(Math.abs(Number(body.amount)).toFixed(2));setSide(Number(body.amount)<0?"credit":"debit");setSource(body.hasPriorRecords || body.source==="carry_forward"?"automatic":"manual");setNote(body.note||"");})
      .catch(error => {if(error.name!=="AbortError")setError(error.message);});
    return () => controller.abort();
  },[partyId,fiscalYearId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if(saving||!data?.canEdit)return;
    setSaving(true);setError("");
    try {
      const response=await fetch("/api/party-opening",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({partyId,fiscalYearId,amount,side,source,note,revision:data.revision})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Could not save opening balance");
      invalidateClientCache();
      if(mounted.current)onSaved();
    } catch(error:any) {if(mounted.current)setError(error instanceof TypeError ? "Connection interrupted. Save status is not confirmed. Reopen this editor to check the recorded balance before trying again." : error.message||"Could not save opening balance");}
    finally {if(mounted.current)setSaving(false);}
  }
  return <section className="opening-editor" aria-label="Edit fiscal year opening balance">
    <div className="opening-editor-heading"><div><h3>{data?.hasPriorRecords?"Opening balance · previous-year closing":"Add / Edit Opening Balance"}</h3><p>{data?`${data.partyName} · FY ${data.fiscalYearLabel} · ${formatBs(data.startDate)}`:"Loading recorded opening…"}</p></div><button type="button" disabled={saving} onClick={onClose} aria-label="Close opening balance editor">×</button></div>
    {error&&<p className="opening-editor-error" role="alert">{error}</p>}
    {data&&<form onSubmit={save}>
      <p className="opening-editor-help">{data.hasPriorRecords?"This party already has earlier-year records in this software. Only their closing balance is brought forward; an extra opening from outside records cannot be entered here.":"For a newly introduced party, enter only the outstanding amount from before this financial year—from your old software or daybook. Current-year bills are not entered again, and this does not create a sales bill or receipt."}</p>
      <label>Opening source<select value={source} disabled={saving||!data.canEdit||data.hasPriorRecords} onChange={event=>setSource(event.target.value)}><option value="manual" disabled={data.hasPriorRecords}>Manual · previous software / records</option><option value="automatic">{data.priorYear?`Use closing balance from FY ${data.priorYear}`:"Use original recorded opening"}</option></select></label>
      {source==="manual"?<><div className="opening-editor-grid"><label>Opening amount (Rs.)<input autoFocus inputMode="decimal" value={amount} disabled={saving||!data.canEdit} onChange={event=>setAmount(event.target.value)} placeholder="0.00" required/></label><label>Balance side<select value={side} disabled={saving||!data.canEdit} onChange={event=>setSide(event.target.value)}><option value="debit">Debit · party owes us</option><option value="credit">Credit · we owe party / advance</option></select></label></div><label>Source / note (optional)<input value={note} maxLength={1000} disabled={saving||!data.canEdit} onChange={event=>setNote(event.target.value)} placeholder="e.g. Closing balance from old accounting software"/></label></>:<p className="opening-editor-preview">Automatic opening: <strong>{money(data.automaticAmount)} {Number(data.automaticAmount)<0?"Cr":"Dr"}</strong></p>}
      <p className="opening-editor-help">Changes are audited and flow into later years. Once earlier-year records exist here, their closing balance is the opening source; an outside amount is not added on top.</p>
      <div className="opening-editor-actions"><button type="button" disabled={saving} onClick={onClose}>Close</button><button className="primary" type="submit" disabled={saving||!data.canEdit}>{saving?"Saving opening…":data.hasPriorRecords?"Use previous-year closing":"Save opening balance"}</button></div>
    </form>}
  </section>;
}
