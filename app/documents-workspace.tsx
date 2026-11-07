"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BsDateInput from "./bs-date-input";
import CommercialDocumentPreview from "./commercial-document-preview";
import { formatBs } from "../lib/nepali-date";
import { commercialInput, documentTotals } from "../lib/commercial-documents";
import "./work-documents.css";
import { useWorkDialog } from "./use-work-dialog";

// Existing accounting snapshot boundary; individual writes are validated by commercialInput.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const money = (n: number) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyLine = () => ({ description: "", quantity: 1, rate: 0, unit: "pcs" });
export default function DocumentsWorkspace({ fiscalYear, parties, products }: { fiscalYear: Row; parties: Row[]; products: Row[] }) {
  const [kind, setKind] = useState("quotation");
  const [data, setData] = useState<Row | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Row | null>(null);
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useWorkDialog(Boolean(form), () => { if (!busy) setForm(null); });
  const fiscalYearId = fiscalYear?.id;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!fiscalYearId) return;
    try {
      const response = await fetch(`/api/documents?fy=${fiscalYearId}&type=${kind}&page=${page}`, { signal, cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); setError("");
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Documents could not load"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [fiscalYearId, kind, page]);
  // State updates in load follow the network response; abort prevents stale FY/tab responses.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function open() {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    setFormError("");
    setForm({ documentType: kind, requestId: crypto.randomUUID(), recipientName: "", recipientPan: "", recipientAddress: "", issuerPan: data?.company.settings?.pan || "", date: today >= fiscalYear.start_ad && today <= fiscalYear.end_ad ? today : fiscalYear.end_ad, subject: "", itemHeading: "Item / Description", lines: [emptyLine()], taxMode: "exclusive", taxPercent: 13, discountPercent: 0, deliveryTerms: "", terms: "", bankHolder: data?.company.name || "", bankName: "", bankAccount: "" });
  }
  function changeLine(index: number, values: Row) { setForm(current => current && ({ ...current, lines: current.lines.map((line: Row, i: number) => i === index ? { ...line, ...values } : line) })); }
  async function save() {
    if (!form || lock.current) return;
    setFormError("");
    try { commercialInput(form); } catch (e) { setFormError((e as Error).message); return; }
    lock.current = true; setBusy(true);
    try {
      const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, fiscalYearId: fiscalYear.id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSaved(body.document); setForm(null); await load();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Could not save. Your entries are retained."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function view(id: string) {
    setBusy(true); setError("");
    try { const r = await fetch(`/api/documents?fy=${fiscalYear.id}&id=${id}`); const b = await r.json(); if (!r.ok) throw new Error(b.error); setSaved(b.document); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const totals = form ? documentTotals(form.lines, Number(form.discountPercent), Number(form.taxPercent), form.taxMode) : null;
  const field = (key: string, label: string, wide = false) => <label className={wide ? "wide" : ""}>{label}<input value={form?.[key] || ""} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  return <section className="work-hub"><div className="work-heading"><div><small>COMMERCIAL DOCUMENTS · FY {fiscalYear?.label_bs}</small><h2>Quotations & pro forma</h2><p>Save first, then print or share a PDF. These documents do not change your ledger or stock.</p></div><button className="primary" disabled={loading || busy || !data || Boolean(error)} onClick={open}>＋ Create {kind === "quotation" ? "quotation" : "pro forma"}</button></div>
    <div className="work-tabs">{[["quotation", "Quotations"], ["proforma", "Pro forma invoices"]].map(([id, label]) => <button key={id} aria-pressed={kind === id} onClick={() => { if (id !== kind) { setLoading(true); setKind(id); setPage(0); } }}>{label}</button>)}</div>
    {error && <div role="alert" className="work-error">{error} <button onClick={() => void load()}>Retry</button></div>}
    <div className="document-stats"><article><small>Saved this FY</small><strong>{data?.total ?? "—"}</strong></article><article><small>Last number</small><strong>{data?.lastNumber || "—"}</strong></article><article><small>Next number (preview)</small><strong>{data ? data.lastNumber + 1 : "—"}</strong></article></div>
    <p className="work-hint">Each document type has its own numbering, starting at 1 each FY. The final number is reserved only when saved.</p>
    <div className="document-register" aria-busy={loading}>{loading ? <p>Loading saved documents…</p> : data?.documents.map((r: Row) => <button key={r.id} onClick={() => void view(r.id)} disabled={busy}><span><strong>#{r.sequence_no} · {r.recipient_name}</strong><small>{formatBs(r.document_date)} · {r.status}</small></span><b>{money(r.total)}</b><span>View →</span></button>)}{!loading && !data?.documents.length && !error && <p>No documents yet. Create your first {kind === "quotation" ? "quotation" : "pro forma invoice"}.</p>}</div>
    <div className="work-pagination"><button disabled={!page || loading} onClick={() => { setLoading(true); setPage(p => p - 1); }}>Previous</button><span>Page {page + 1}</span><button disabled={loading || (page + 1) * 25 >= (data?.total || 0)} onClick={() => { setLoading(true); setPage(p => p + 1); }}>Next</button></div>
    {saved && <CommercialDocumentPreview record={saved} close={() => setSaved(null)} />}
    {form && createPortal(<div className="work-overlay"><form className="work-dialog document-editor" role="dialog" aria-modal="true" aria-labelledby="document-title" onSubmit={e => { e.preventDefault(); void save(); }}><header><div><small>NON-POSTING · NUMBER ASSIGNED ON SAVE</small><h2 id="document-title">Create {kind === "quotation" ? "quotation" : "pro forma invoice"}</h2></div><button type="button" aria-label="Close" disabled={busy} onClick={() => setForm(null)}>×</button></header><div className="work-form">
      <div className="document-brand wide">{data?.company.logo_url && <img src={data.company.logo_url} alt="Company logo" />}<div><strong>{data?.company.name}</strong><small>{data?.company.address}</small><small>Uses this company’s branding; no other company’s logo is substituted.</small></div></div>
      <label className="wide">Use an existing party (optional)<select defaultValue="" onChange={e => { const party = parties.find(p => p.id === e.target.value); if (party) setForm({ ...form, recipientName: party.name, recipientPan: party.tax_no || "", recipientAddress: party.place || "" }); }}><option value="">Enter recipient manually</option>{parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>To: full name / company<input required autoFocus maxLength={250} value={form.recipientName} onChange={e => setForm({ ...form, recipientName: e.target.value })} /></label>{field("recipientPan", "Recipient PAN / VAT (optional)")}{field("recipientAddress", "Recipient address", true)}
      <label>Document date (BS)<BsDateInput value={form.date} onChange={date => setForm({ ...form, date })} /></label>
      {data?.company.settings?.pan ? <label>Sender PAN / VAT<input readOnly value={data.company.settings.pan} /></label> : field("issuerPan", "Your company PAN / VAT (optional)")}
      {field("subject", "Subject / reference", true)}{field("itemHeading", "Editable item column heading", true)}
      <div className="document-lines wide">{form.lines.map((line: Row, index: number) => <section key={index}><div className="document-line-title"><strong>Item {index + 1}</strong><button type="button" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_: Row, i: number) => i !== index) })}>Remove</button></div><label>Choose product (optional)<select value="" onChange={e => { const product = products.find(p => p.id === e.target.value); if (product) changeLine(index, { description: product.name, unit: product.unit, rate: Number(product.sale_price || 0) }); }}><option value="">Custom description or pick a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Description<textarea required rows={2} maxLength={2000} value={line.description} onChange={e => changeLine(index, { description: e.target.value })} /></label><div className="document-line-numbers"><label>Quantity<input required type="number" min="0.001" max="100000000" step="0.001" value={line.quantity} onChange={e => changeLine(index, { quantity: e.target.value })} /></label><label>Unit<input value={line.unit} onChange={e => changeLine(index, { unit: e.target.value })} /></label><label>Rate (Rs.)<input required type="number" min="0" max="100000000" step="0.01" value={line.rate} onChange={e => changeLine(index, { rate: e.target.value })} /></label><label>Amount<strong>{money(Number(line.quantity) * Number(line.rate))}</strong></label></div></section>)}<button type="button" disabled={form.lines.length >= 100} onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>＋ Add item</button></div>
      <label>VAT treatment<select value={form.taxMode} onChange={e => setForm({ ...form, taxMode: e.target.value })}><option value="exclusive">VAT extra (added to price)</option><option value="inclusive">VAT included in price</option><option value="none">No VAT</option></select></label><label>VAT %<input type="number" min="0" max="100" step="0.01" disabled={form.taxMode === "none"} value={form.taxPercent} onChange={e => setForm({ ...form, taxPercent: e.target.value })} /></label><label>Discount %<input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={e => setForm({ ...form, discountPercent: e.target.value })} /></label>
      <div className="document-total wide"><span>Subtotal: {money(totals!.subtotal)}</span><span>Discount: {money(totals!.discount)}</span><span>Before VAT: {money(totals!.taxable)}</span><span>VAT: {money(totals!.tax)}</span><strong>Total: {money(totals!.total)}</strong></div>
      {field("deliveryTerms", "Delivery charge / terms (included, extra or your own text)", true)}<label className="wide">Terms / company information (fully editable)<textarea rows={5} maxLength={10000} value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} placeholder="Validity, delivery time, payment terms, product details…" /></label>{field("bankHolder", "Bank account holder", true)}{field("bankName", "Bank name (optional)")}{field("bankAccount", "Bank account number (optional)")}
      {formError && <p className="work-error wide" role="alert">{formError}</p>}
    </div><footer><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save & preview"}</button></footer></form></div>, document.body)}
  </section>;
}
