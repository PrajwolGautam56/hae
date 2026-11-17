"use client";
import { useRef, useState, type FormEvent } from "react";
import "./platform-sms-credits.css";

export default function PlatformSmsCredits({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<any>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const requestId = useRef<string | null>(null), inFlight = useRef(false);
  const pendingPayload = useRef<string | null>(null);
  async function load() {
    setError("");
    try { const response = await fetch(`/api/platform/sms?tenantId=${tenantId}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }
    catch (error: any) { setError(error.message || "Could not load SMS credits"); }
  }
  async function action(event: FormEvent<HTMLFormElement>, kind: string) {
    event.preventDefault(); if (inFlight.current) return;
    const form = event.currentTarget, fields = Object.fromEntries(new FormData(form).entries());
    const payload = JSON.stringify({ ...fields, action: kind });
    if (pendingPayload.current && pendingPayload.current !== payload) { setError("An earlier request is unconfirmed. Retry its original unchanged form first, or review the credit audit before making another change."); return; }
    pendingPayload.current = payload;
    inFlight.current = true; setBusy(true); setError(""); setNotice(""); requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/platform/sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, tenantId, action: kind, requestId: requestId.current, enabled: fields.enabled === "on", providerChecked: fields.providerChecked === "on" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      requestId.current = null; pendingPayload.current = null; form.reset(); setNotice(body.wallet && (!body.wallet.enabled || !body.wallet.credits_per_segment) ? `Saved: ${body.wallet.balance} credits available. SMS is not active yet. Complete Client credit rules & access below, set the credit charge, check Enable SMS sending and save.` : "Saved. Credit changes are audited. Open client dashboards refresh their credits within 15 seconds, or immediately when the tab is focused."); await load();
    } catch (error: any) { setError(error instanceof TypeError ? "Connection interrupted. Retry this same unchanged form to check the outcome; do not enter a second top-up." : error.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="platform-sms-panel"><button type="button" onClick={() => { const next = !open; setOpen(next); if (next) void load(); }} aria-expanded={open}>SMS credits & reminders {open ? "▴" : "▾"}</button>{open && <div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!data ? <button onClick={load}>Load / retry</button> : <>
      <dl><div><dt>Available</dt><dd>{data.wallet.balance}</dd></div><div><dt>Reserved</dt><dd>{data.wallet.held}</dd></div><div><dt>Spent</dt><dd>{data.wallet.spent}</dd></div></dl>
      <p>Shared client wallet; each send records its individual company. SMS is {data.wallet.enabled ? "enabled" : "disabled"}. Email does not deduct SMS credits.</p>
      {(!data.wallet.enabled || !data.wallet.credits_per_segment) && <p role="status"><strong>Credits are saved, but SMS is not active.</strong> Adding credits does not automatically enable sending. Set the message credit charge and enable SMS in Client credit rules & access below.</p>}
      <button type="button" disabled={busy} onClick={()=>void load()}>Refresh credits & status</button>
      {!data.provider.ready && <p>{data.provider.reason}</p>}
      {data.canManage && <><form onSubmit={event => action(event, "topup")}><h4>Add SMS credits · paid or complimentary</h4><label>Credits to add<input name="credits" type="number" min="1" max="10000000" step="1" required disabled={busy}/></label><label>Client payment received (Rs.) · optional<input name="paidAmount" type="number" min="0" step="0.01" disabled={busy}/></label><label>Payment reference / note<input name="note" maxLength={1000} required disabled={busy}/></label><button disabled={busy}>Add credits</button></form>
      <form onSubmit={event=>action(event,"adjustment")}><h4>Remove available credits</h4><label>Credit adjustment · enter a negative number<input name="credits" type="number" max="-1" min="-10000000" step="1" required disabled={busy}/></label><label>Reason for removal<input name="note" required maxLength={1000} disabled={busy}/></label><p>Only available credits can be removed. Reserved or already-used credits are protected.</p><button disabled={busy}>Remove credits</button></form>
      <form key={`${data.wallet.enabled}:${data.wallet.credits_per_segment}`} onSubmit={event => action(event, "settings")}><h4>Client credit rules & access</h4><label>Your client credits per SMS segment<input name="creditsPerSegment" type="number" min="1" max="10000" step="1" required defaultValue={data.wallet.credits_per_segment ?? 1} disabled={busy}/></label><p>This is your own client allowance rule, not your provider purchase price. The suggested starting rule is 1 credit per segment; edit it before saving. Clients see only the message’s credit charge and their balance.</p><label className="sms-checkbox"><input name="enabled" type="checkbox" defaultChecked={data.wallet.enabled} disabled={busy}/> Enable SMS sending</label><p>Enabling also allows scheduled SMS for parties where automatic overdue reminders have already been switched on.</p><label>Reason / pricing note<input name="note" required maxLength={1000} disabled={busy}/></label><button disabled={busy}>Save credit rules</button></form></>}
      <details><summary>Credit audit · latest {data.ledger.length}</summary>{data.ledger.map((entry: any) => <p key={entry.id}><strong>{entry.kind} · available {entry.available_delta > 0 ? "+" : ""}{entry.available_delta} · reserved {entry.held_delta} · spent {entry.spent_delta}</strong><br/>{entry.note}<br/>{entry.actor} · {entry.created_at}{entry.paid_amount !== null ? ` · Paid Rs. ${entry.paid_amount}` : ""}</p>)}</details>
      <details><summary>Unconfirmed sends · {data.pending.length}</summary><p>Check SMS Pasal / Resend first. Never mark “not accepted” solely because a phone did not receive the message. Acceptance and delivery differ.</p>{data.pending.map((entry: any) => <article key={entry.id}><p>{entry.channel.toUpperCase()} · {entry.status} · {entry.recipient} · company {entry.company_id} · {entry.credits} credits<br/>{entry.detail}<br/>Provider reference: {entry.provider_id || "not recorded"}</p>{data.canManage && <form onSubmit={event => action(event, "resolve")}><input type="hidden" name="deliveryId" value={entry.id}/><label>Confirmed provider outcome<select name="status" required disabled={busy}><option value="">Choose after checking</option><option value="accepted">Accepted by provider · spend reserved credits</option><option value="failed">Not accepted · refund reserved credits</option></select></label><label>Provider reference<input name="providerId" disabled={busy}/></label><label>Evidence / reconciliation note<input name="note" required maxLength={1000} disabled={busy}/></label><label className="sms-checkbox"><input name="providerChecked" type="checkbox" required disabled={busy}/> I checked the provider records</label><button disabled={busy}>Record reviewed outcome</button></form>}</article>)}</details>
    </>}
  </div>}</div>;
}
