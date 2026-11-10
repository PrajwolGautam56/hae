"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {invalidateClientCache} from "../lib/client-data-cache";
import "./party-details.css";

export default function PartyDetailsEditor({partyId,onClose,onSaved}:{partyId:string;onClose:()=>void;onSaved:(party:any)=>void}) {
  const [ready,setReady]=useState(false);const [data,setData]=useState<any>(null);
  const [name,setName]=useState("");const [address,setAddress]=useState("");const [phone,setPhone]=useState("");const [taxNo,setTaxNo]=useState("");
  const [error,setError]=useState("");const [saving,setSaving]=useState(false);
  const mounted=useRef(true);const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{mounted.current=true;setReady(true);const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";
    return()=>{mounted.current=false;document.body.style.overflow=overflow;previous?.focus?.();};},[]);
  useEffect(()=>{if(ready&&!data)dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();},[ready]);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/party-details?partyId=${encodeURIComponent(partyId)}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not load party");return result;})
      .then(result=>{if(!controller.signal.aborted){setData(result);setName(result.party.name||"");setAddress(result.party.address||result.party.place||"");setPhone(result.party.phone||"");setTaxNo(result.party.tax_no||"");}})
      .catch(error=>{if(error.name!=="AbortError")setError(error.message);});
    return()=>controller.abort();
  },[partyId]);
  async function save(event:FormEvent) {
    event.preventDefault();if(saving||!data?.canEdit)return;
    setSaving(true);setError("");
    try {
      const response=await fetch("/api/party-details",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({partyId,name,address,phone,taxNo,revision:data.party.profile_revision})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not save party details");
      invalidateClientCache();if(mounted.current)onSaved(result.party);
    } catch(error:any){if(mounted.current)setError(error instanceof TypeError?"Connection interrupted. Reopen the editor to check the recorded details before saving again.":error.message||"Could not save party details");}
    finally{if(mounted.current)setSaving(false);}
  }
  if(!ready)return null;
  return createPortal(<div className="party-details-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}>
    <section className="party-details-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="party-details-title" onKeyDown={event=>{
      if(event.key==="Escape"&&!saving){event.preventDefault();onClose();}
      if(event.key==="Tab"){const fields=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)');if(fields?.length){const first=fields[0],last=fields[fields.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
    }}>
      <header><div><small>PARTY PROFILE</small><h2 id="party-details-title">Edit party details</h2></div><button type="button" aria-label="Close party details" disabled={saving} onClick={onClose}>×</button></header>
      <form onSubmit={save}>
        <div className="party-details-fields">
          <p>Update contact and PAN details. Bills, receipts, opening balance and ledger amounts are not changed.</p>
          {error&&<p className="party-details-error" role="alert">{error}</p>}
          {!data?<p>Loading party details…</p>:<><label>Party / company name<input autoFocus value={name} required maxLength={250} disabled={saving||!data.canEdit} onChange={event=>setName(event.target.value)}/></label><label>Address<textarea value={address} maxLength={1000} rows={3} disabled={saving||!data.canEdit} onChange={event=>setAddress(event.target.value)} placeholder="Optional"/></label><div className="party-details-grid"><label>Phone<input type="tel" value={phone} maxLength={60} disabled={saving||!data.canEdit} onChange={event=>setPhone(event.target.value)} placeholder="Optional"/></label><label>PAN number<input value={taxNo} maxLength={50} disabled={saving||!data.canEdit} onChange={event=>setTaxNo(event.target.value)} placeholder="Optional"/></label></div></>}
        </div>
        <footer><button type="button" disabled={saving} onClick={onClose}>Close</button><button className="primary" type="submit" disabled={saving||!data?.canEdit}>{saving?"Saving…":"Save party details"}</button></footer>
      </form>
    </section>
  </div>,document.body);
}
