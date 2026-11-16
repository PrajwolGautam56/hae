"use client";
import { useEffect, useRef, useState } from "react";
import { formatBs } from "../lib/nepali-date";
import "./overdue-reminders.css";
const money = (value: number) => `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const outcome = (status: string) => ({ accepted: "Provider accepted", failed: "Not sent", unknown: "Needs review", reserved: "Awaiting confirmation" }[status] || status);

export default function OverdueReminders({ refreshVersion, onOpenParty, onEditParty }: { refreshVersion: number; onOpenParty: (id: string) => void; onEditParty?: (id: string) => void }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  const [version, setVersion] = useState(0), [selected, setSelected] = useState("");
  const [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const requestId = useRef<string | null>(null), lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setData(null);
    fetch("/api/overdue-reminders", { cache: "no-store", signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.setupRequired ? "Overdue reminders need the approved database migration before use." : body.error || "Could not load reminders"); return body; }).then(body => { if (!controller.signal.aborted) setData(body); }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [refreshVersion, version]);
  const row = data?.rows.find((item: any) => item.partyId === selected);
  useEffect(() => { requestId.current = null; setNotice(""); }, [selected, channel]);
  async function send() {
    if (lock.current || !row) return;
    lock.current = true; setBusy(true); setNotice("");
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/overdue-reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partyId: row.partyId, channel, requestId: requestId.current, previewHash: row.previewHash, expectedCredits: row.estimate.credits }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Reminder was not sent");
      setNotice(`${outcome(result.delivery.status)}. ${result.delivery.detail || ""}`);
      // Keep the request ID for ambiguous retries; a new preview is needed for a new send.
      setVersion(value => value + 1);
    } catch (error: any) { setNotice(error instanceof TypeError ? "Connection interrupted. Retry this same request to check its saved outcome; do not start a second reminder." : error.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const creditCost = row?.estimate.credits;
  const blocked = busy || !data?.canSend || !data?.providers[channel]?.ready || !row || (channel === "sms" && (!data?.wallet.enabled || creditCost === null || Number(data?.wallet.balance) < creditCost || !row.phone || row.message.length > 720)) || (channel === "email" && !row.email);
  return <section className="card overdue-widget" aria-label="Overdue balances and reminders">
    <div className="overdue-heading"><div><small>COLLECTION FOLLOW-UP · TODAY</small><h3>Overdue parties</h3><p>FIFO-settled unpaid bills whose due date has passed. Current balance is recalculated before sending.</p></div><button className="primary soft" disabled={busy} onClick={() => setVersion(value => value + 1)}>Refresh</button></div>
    {error ? <p className="overdue-error" role="alert">{error}</p> : !data ? <p className="overdue-loading">Loading overdue balances…</p> : <>
      <div className="overdue-metrics"><div><small>Overdue amount · {data.rows.length} parties</small><strong>{money(data.totalOverdue)}</strong><span>As of {formatBs(data.asOf)}</span></div><div><small>SMS credits available</small><strong>{Number(data.wallet.balance).toLocaleString()}</strong><span>Shared across this client’s companies</span></div><div><small>Reserved / spent credits</small><strong>{data.wallet.held} / {data.wallet.spent}</strong><span>{data.smsAccepted} SMS accepted from this company</span></div></div>
      <p className="overdue-credit-note">{data.wallet.credits_per_segment ? `${data.wallet.credits_per_segment} credit(s) per SMS segment · up to ${Math.floor(data.wallet.balance / data.wallet.credits_per_segment)} single-segment messages. Actual messages can use several segments.` : "SMS pricing has not been configured. Contact your platform administrator to add paid credits."} Email does not use SMS credits.</p>
      <label className="overdue-search">Search overdue party<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Party name or phone" type="search" /></label>
      <div className="overdue-party-list">{data.rows.filter((item: any) => `${item.party} ${item.phone}`.toLowerCase().includes(search.toLowerCase())).map((item: any) => <div key={item.partyId} className={selected === item.partyId ? "selected" : ""}><button disabled={busy} onClick={() => { setSelected(item.partyId); requestId.current = null; }} aria-expanded={selected === item.partyId}><span><strong>{item.party}</strong><small>{item.oldestOverdueDays} days overdue · {item.termText}</small></span><span><strong>{money(item.overdue)}</strong><small>Total outstanding {money(item.total)}</small></span></button><button className="overdue-ledger-link" disabled={busy} onClick={() => onOpenParty(item.partyId)}>View ledger →</button></div>)}</div>
      {!data.rows.length && <p className="overdue-loading">No overdue party balance today. Undated opening balances are not assumed overdue.</p>}
      {row && <div className="overdue-preview"><div><h4>Reminder preview · {row.party}</h4><p>From {data.company.name} · oldest due {formatBs(row.oldestDue)} · SMS auto: {row.autoSms ? "on" : "off"} · Email auto: {row.autoEmail ? "on" : "off"}</p></div><div className="overdue-preview-actions"><label>Send by<select value={channel} disabled={busy} onChange={event => setChannel(event.target.value as "sms" | "email")}><option value="sms">SMS</option><option value="email">Email</option></select></label><span>{channel === "sms" ? row.phone || "No mobile number" : row.email || "No email address"}</span>{onEditParty && <button className="primary soft" disabled={busy} onClick={() => onEditParty(row.partyId)}>Contact / auto reminders</button>}</div><blockquote>{row.message}</blockquote>{channel === "sms" && <p>{row.estimate.encoding} · {row.estimate.units} units · {row.estimate.segments} segment(s) · {creditCost === null ? "Rate not set" : `${creditCost} credits`}. Provider limit: 720 characters.</p>}{!data.providers[channel].ready && <p className="overdue-error">{data.providers[channel].reason}</p>}{channel === "sms" && creditCost !== null && data.wallet.balance < creditCost && <p className="overdue-error">Insufficient SMS credits. Ask your platform administrator for a top-up.</p>}<button className="primary" disabled={blocked} onClick={send}>{busy ? "Sending / checking…" : `Send ${channel === "sms" ? "SMS" : "email"} reminder`}</button></div>}
      {notice && <p className="overdue-notice" role="status">{notice}</p>}
      <details className="overdue-history"><summary>Recent reminder activity ({data.history.length})</summary><p>Provider acceptance is not proof of delivery. Uncertain sends require platform review and are never automatically resent.</p>{data.history.map((item: any) => <article key={item.id}><strong>{item.channel.toUpperCase()} · {outcome(item.status)}</strong><span>{item.recipient} · {formatBs(item.created_at.slice(0, 10))} · {item.automatic ? "Automatic" : "Manual"} · {item.credits} credits</span><small>{item.detail}</small></article>)}</details>
    </>}
  </section>;
}
