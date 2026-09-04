"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BsDateInput from "./bs-date-input";
import { formatBs } from "../lib/nepali-date";
import { printDocument } from "../lib/export-data";

type Props = {
  mode: "accounting" | "manufacturing";
  parties: any[]; products: any[]; moneyAccounts: any[]; members: any[]; fiscalYear: any;
  onNotice: (message: string) => void; onRefresh: () => void;
};

type ItemLine = { product_id: string; name: string; quantity: number; rate: number; unit: string; item_type: string };
type JournalLine = { account_id: string; party_id: string; description: string; debit: number; credit: number };
type StockLine = { product_id: string; quantity_delta: number; unit_cost: number; reason: string };
type BomLine = { product_id: string; quantity: number; wastage_percent: number; notes: string };
type PayrollLine = { team_member_id: string; basic_salary: number; allowances: number; deductions: number; notes: string };

const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (value: number) => `Rs. ${Math.abs(Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const itemLine = (): ItemLine => ({ product_id: "", name: "", quantity: 1, rate: 0, unit: "pcs", item_type: "finished_good" });
const journalLine = (): JournalLine => ({ account_id: "", party_id: "", description: "", debit: 0, credit: 0 });
const stockLine = (): StockLine => ({ product_id: "", quantity_delta: 0, unit_cost: 0, reason: "" });
const bomLine = (): BomLine => ({ product_id: "", quantity: 1, wastage_percent: 0, notes: "" });
const payrollLine = (): PayrollLine => ({ team_member_id: "", basic_salary: 0, allowances: 0, deductions: 0, notes: "" });

const actionMeta: Record<string, { title: string; description: string; code: string }> = {
  purchase_order: { title: "Purchase Order", description: "Issue a non-posting order to a supplier", code: "PO" },
  sale_return: { title: "Sales Return", description: "Receive sold goods and reduce receivable", code: "SR" },
  purchase_return: { title: "Purchase Return", description: "Return purchased goods and reduce payable", code: "PR" },
  manual_journal: { title: "Journal Voucher", description: "Post a balanced debit and credit entry", code: "JV" },
  contra: { title: "Contra Voucher", description: "Transfer cash between office and bank accounts", code: "CV" },
  stock_adjustment: { title: "Stock Journal", description: "Audited physical stock correction", code: "SJ" },
  payroll: { title: "Payroll Voucher", description: "Post salary, allowances and deductions", code: "PV" },
  save_bom: { title: "BOM Master", description: "Define reusable material formula", code: "BOM" },
  bom_production: { title: "Production Order", description: "Consume BOM materials and produce stock", code: "MO" },
};

export default function AccountingOperationsWorkspace({ mode, parties, products, moneyAccounts, members, fiscalYear, onNotice, onRefresh }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState("");
  const [date, setDate] = useState(businessDate());
  const [partyId, setPartyId] = useState("");
  const [sourceVoucherId, setSourceVoucherId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [narration, setNarration] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [taxPercent, setTaxPercent] = useState(13);
  const [lines, setLines] = useState<ItemLine[]>([itemLine()]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([journalLine(), journalLine()]);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState(0);
  const [stockLines, setStockLines] = useState<StockLine[]>([stockLine()]);
  const [bomId, setBomId] = useState("");
  const [bomName, setBomName] = useState("Standard BOM");
  const [bomVersion, setBomVersion] = useState("1");
  const [outputProductId, setOutputProductId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState(1);
  const [bomLines, setBomLines] = useState<BomLine[]>([bomLine()]);
  const [payrollPeriod, setPayrollPeriod] = useState("");
  const [payrollLines, setPayrollLines] = useState<PayrollLine[]>([payrollLine()]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const rawProducts = useMemo(() => products.filter((product) => ["raw_material", "packaging"].includes(product.item_type)), [products]);
  const finishedProducts = useMemo(() => products.filter((product) => ["finished_good", "resale_good"].includes(product.item_type)), [products]);
  const sourceInvoices = useMemo(() => (data?.sourceInvoices || []).filter((voucher: any) => voucher.voucher_type === (action === "sale_return" ? "sale" : "purchase")), [data?.sourceInvoices, action]);
  const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.rate || 0), 0);
  const discount = subtotal * Number(discountPercent || 0) / 100;
  const tax = (subtotal - discount) * Number(taxPercent || 0) / 100;

  const load = useCallback(async () => {
    if (!fiscalYear?.id) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/accounting-suite?fy=${fiscalYear.id}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Accounting operations could not load"); setData(body);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Accounting operations could not load"); }
    finally { setLoading(false); }
  }, [fiscalYear?.id, onNotice]);
  useEffect(() => { void load(); }, [load]);

  function open(nextAction: string) {
    setAction(nextAction); setDate(businessDate() >= fiscalYear.start_ad && businessDate() <= fiscalYear.end_ad ? businessDate() : fiscalYear.end_ad);
    setPartyId(""); setSourceVoucherId(""); setExpectedDate(""); setNarration(""); setSupplierReference("");
    setDiscountPercent(0); setTaxPercent(13); setLines([itemLine()]); setJournalLines([journalLine(), journalLine()]);
    setFromAccountId(moneyAccounts[0]?.id || ""); setToAccountId(moneyAccounts[1]?.id || ""); setAmount(0); setStockLines([stockLine()]);
    setBomId(""); setBomName("Standard BOM"); setBomVersion("1"); setOutputProductId(finishedProducts[0]?.id || ""); setOutputQuantity(1); setBomLines([bomLine()]);
    setPayrollPeriod(""); setPayrollLines([{ ...payrollLine(), team_member_id: members[0]?.id || "" }]);
  }

  function chooseItem(index: number, productId: string) {
    const product = products.find((row) => row.id === productId);
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? {
      ...line, product_id: productId, name: product?.name || "", rate: Number(product?.purchase_price || 0),
      unit: product?.unit || "pcs", item_type: product?.item_type || "finished_good",
    } : line));
  }

  function chooseSource(value: string) {
    setSourceVoucherId(value);
    const voucher = sourceInvoices.find((row: any) => row.id === value);
    setPartyId(voucher?.party?.id || "");
    setLines((voucher?.voucher_lines || []).map((line: any) => ({ product_id: line.product_id, name: line.description,
      quantity: 0, rate: Number(line.rate), unit: line.products?.unit || "pcs", item_type: "finished_good" })));
  }

  function editBom(bom: any) {
    open("save_bom"); setBomId(bom.id); setBomName(bom.name); setBomVersion(bom.version); setOutputProductId(bom.output?.id || "");
    setOutputQuantity(Number(bom.output_quantity)); setNarration(bom.notes || ""); setBomLines((bom.bom_components || []).map((line: any) => ({
      product_id: line.product_id, quantity: Number(line.quantity), wastage_percent: Number(line.wastage_percent), notes: line.notes || "",
    })));
  }

  async function submit() {
    const body: any = { action, fiscalYearId: fiscalYear.id, date, narration };
    if (action === "purchase_order") Object.assign(body, { supplierId: partyId, expectedDate: expectedDate || null, supplierReference,
      discountPercent, taxPercent, lines: lines.filter((line) => line.name && line.quantity > 0).map((line) => ({ ...line })) });
    if (["sale_return", "purchase_return"].includes(action)) Object.assign(body, { action: "goods_return", returnType: action, sourceVoucherId,
      lines: lines.filter((line) => line.product_id && line.quantity > 0).map((line) => ({ ...line })) });
    if (action === "manual_journal") body.lines = journalLines.filter((line) => line.account_id && (Number(line.debit) > 0 || Number(line.credit) > 0));
    if (action === "contra") Object.assign(body, { fromAccountId, toAccountId, amount: Number(amount) });
    if (action === "stock_adjustment") body.lines = stockLines.filter((line) => line.product_id && Number(line.quantity_delta) !== 0);
    if (action === "save_bom") Object.assign(body, { bomId: bomId || null, name: bomName, version: bomVersion, outputProductId,
      outputQuantity: Number(outputQuantity), components: bomLines.filter((line) => line.product_id && line.quantity > 0), notes: narration });
    if (action === "bom_production") Object.assign(body, { bomId, outputQuantity: Number(outputQuantity), notes: narration });
    if (action === "payroll") Object.assign(body, { periodLabel: payrollPeriod, lines: payrollLines.filter((line) => line.team_member_id && Number(line.basic_salary) + Number(line.allowances) > 0) });
    setSaving(true);
    try {
      const response = await fetch("/api/accounting-suite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Operation could not be saved");
      setData(result.snapshot); setAction(""); onRefresh(); onNotice(`${actionMeta[action]?.title || "Record"} saved and posted successfully`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Operation could not be saved"); }
    finally { setSaving(false); }
  }

  async function updateOrder(order: any, status: string) {
    setSaving(true);
    try {
      const response = status === "billed"
        ? await fetch("/api/accounting-suite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "convert_purchase_order", fiscalYearId: fiscalYear.id, purchaseOrderId: order.id, date }) })
        : await fetch("/api/accounting-suite", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "purchase_order_status", fiscalYearId: fiscalYear.id, purchaseOrderId: order.id, status }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Purchase order could not update");
      setData(body.snapshot); setSelectedOrder(null); onRefresh(); onNotice(status === "billed" ? "Purchase invoice posted and stock received" : `Purchase order marked ${status}`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Purchase order could not update"); }
    finally { setSaving(false); }
  }

  const actions = mode === "manufacturing" ? ["save_bom", "bom_production"] : ["purchase_order", "sale_return", "purchase_return", "manual_journal", "contra", "stock_adjustment", "payroll"];
  return <section className="operations-suite">
    <div className="module-hero operations-hero"><div><span>{mode === "manufacturing" ? "MANUFACTURING CONTROL" : "ACCOUNTING OPERATIONS"}</span><h2>{mode === "manufacturing" ? "BOM & production" : "Vouchers & orders"}</h2><p>{mode === "manufacturing" ? "Reusable material formulas, exact consumption and finished-goods production." : "Purchase orders, returns, journals, contra and stock corrections with audit-ready posting."}</p></div></div>
    <div className="operation-actions">{actions.map((name) => <button key={name} onClick={() => open(name)}><span>{actionMeta[name].code}</span><strong>{actionMeta[name].title}</strong><small>{actionMeta[name].description}</small><b>＋</b></button>)}</div>

    {mode === "accounting" ? <div className="operation-registers">
      <article className="card operation-register"><div className="card-title"><div><h3>Purchase orders</h3><p>Non-posting documents · convert to bill when goods arrive</p></div><button className="primary soft" onClick={() => open("purchase_order")}>＋ New PO</button></div>
        <div className="table-wrap"><table><thead><tr><th>PO NO.</th><th>DATE</th><th>SUPPLIER</th><th>EXPECTED</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{data?.purchaseOrders?.map((order: any) => <tr key={order.id} className="clickable-voucher" onClick={() => { setSelectedOrder(order); setDate(businessDate()); }}><td><strong>{order.sequence_no}</strong></td><td>{formatBs(order.order_date)}</td><td>{order.supplier?.name}</td><td>{order.expected_date ? formatBs(order.expected_date) : "—"}</td><td>{money(order.total)}</td><td><span className={`document-status ${order.status}`}>{order.status.replace("_", " ")}</span></td></tr>)}{!data?.purchaseOrders?.length && <tr><td colSpan={6} className="empty-year">{loading ? "Loading purchase orders…" : "No purchase orders yet."}</td></tr>}</tbody></table></div>
      </article>
      <article className="card operation-register"><div className="card-title"><div><h3>Accounting voucher register</h3><p>Returns, journals, contra and stock journals</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>TYPE</th><th>NO.</th><th>DATE</th><th>PARTY / NOTE</th><th>AMOUNT</th></tr></thead><tbody>{data?.vouchers?.map((voucher: any) => <tr key={voucher.id}><td><span className="voucher-kind">{actionMeta[voucher.voucher_type]?.code || voucher.voucher_type.slice(0, 2).toUpperCase()}</span>{actionMeta[voucher.voucher_type]?.title || voucher.voucher_type.replaceAll("_", " ")}</td><td><strong>{voucher.sequence_no || voucher.voucher_no}</strong></td><td>{formatBs(voucher.voucher_date)}</td><td>{voucher.party?.name || voucher.narration || "General"}</td><td>{money(voucher.total)}</td></tr>)}{!data?.vouchers?.length && <tr><td colSpan={5} className="empty-year">{loading ? "Loading vouchers…" : "No advanced vouchers in this fiscal year."}</td></tr>}</tbody></table></div>
      </article>
      <article className="card operation-register"><div className="card-title"><div><h3>Payroll register</h3><p>Salary expense and payable posting</p></div><button className="primary soft" onClick={() => open("payroll")}>＋ New payroll</button></div><div className="table-wrap"><table><thead><tr><th>RUN</th><th>PERIOD</th><th>DATE</th><th>EMPLOYEES</th><th>GROSS</th><th>DEDUCTIONS</th><th>NET PAYABLE</th></tr></thead><tbody>{data?.payrollRuns?.map((run: any) => <tr key={run.id}><td><strong>{run.sequence_no}</strong></td><td>{run.period_label}</td><td>{formatBs(run.pay_date)}</td><td>{run.payroll_lines?.length || 0}</td><td>{money(run.gross_amount)}</td><td>{money(run.deduction_amount)}</td><td><strong>{money(run.net_amount)}</strong></td></tr>)}{!data?.payrollRuns?.length && <tr><td colSpan={7} className="empty-year">No payroll runs in this fiscal year.</td></tr>}</tbody></table></div></article>
      <article className="card operation-register"><div className="card-title"><div><h3>Chart of accounts</h3><p>Ledger masters used by journals and financial statements</p></div></div><div className="account-master-grid">{["asset", "liability", "equity", "income", "expense"].map((group) => <div key={group}><strong>{group}</strong>{data?.accounts?.filter((account: any) => account.account_type === group).map((account: any) => <span key={account.id}><b>{account.code}</b>{account.name}<small>{account.normal_side}</small></span>)}</div>)}</div></article>
    </div> : <div className="operation-registers">
      <article className="card operation-register"><div className="card-title"><div><h3>Bill of Materials master</h3><p>Approved component recipe per finished product</p></div><button className="primary soft" onClick={() => open("save_bom")}>＋ New BOM</button></div>
        <div className="bom-grid">{data?.boms?.map((bom: any) => <button key={bom.id} className="bom-card" onClick={() => editBom(bom)}><span><b>{bom.output?.name}</b><small>{bom.name} · v{bom.version}</small></span><strong>{bom.output_quantity} {bom.output?.unit}</strong><em>{bom.bom_components?.length || 0} components</em></button>)}{!data?.boms?.length && <div className="dashboard-empty">{loading ? "Loading BOM masters…" : "No BOM defined. Create the production formula first."}</div>}</div>
      </article>
      <article className="card operation-register"><div className="card-title"><div><h3>Production register</h3><p>BOM-based completed batches</p></div><button className="primary" onClick={() => open("bom_production")}>⚙ Produce</button></div>
        <div className="table-wrap"><table><thead><tr><th>BATCH</th><th>DATE</th><th>PRODUCT</th><th>BOM</th><th>OUTPUT</th><th>STATUS</th></tr></thead><tbody>{data?.productionBatches?.map((batch: any) => <tr key={batch.id}><td><strong>{batch.batch_no}</strong></td><td>{formatBs(batch.production_date)}</td><td>{batch.output?.name}</td><td>{batch.bills_of_materials ? `${batch.bills_of_materials.name} v${batch.bills_of_materials.version}` : "Manual"}</td><td>{batch.output_quantity} {batch.output?.unit}</td><td><span className="document-status billed">{batch.production_status}</span></td></tr>)}{!data?.productionBatches?.length && <tr><td colSpan={6} className="empty-year">No production batches in this fiscal year.</td></tr>}</tbody></table></div>
      </article>
    </div>}

    {selectedOrder && <div className="modal-backdrop" onMouseDown={() => setSelectedOrder(null)}><section className="modal operation-modal po-document" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><small>PURCHASE ORDER · FY {fiscalYear.label_bs}</small><h2>PO #{selectedOrder.sequence_no}</h2></div><button onClick={() => setSelectedOrder(null)}>×</button></div><div className="po-party"><div><small>SUPPLIER</small><strong>{selectedOrder.supplier?.name}</strong><span>{selectedOrder.supplier?.place || ""}</span></div><div><small>ORDER / EXPECTED</small><strong>{formatBs(selectedOrder.order_date)}</strong><span>{selectedOrder.expected_date ? formatBs(selectedOrder.expected_date) : "No expected date"}</span></div></div><div className="table-wrap"><table><thead><tr><th>ITEM</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>{selectedOrder.purchase_order_lines.map((line: any) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity} {line.unit}</td><td>{money(line.rate)}</td><td>{money(line.amount)}</td></tr>)}</tbody></table></div><div className="po-total"><span>Total</span><strong>{money(selectedOrder.total)}</strong></div><div className="modal-actions"><button onClick={() => printDocument("report")}>Print / PDF</button>{selectedOrder.status === "draft" && <button onClick={() => updateOrder(selectedOrder, "sent")} disabled={saving}>Mark sent</button>}{!["billed", "cancelled"].includes(selectedOrder.status) && <button className="primary" onClick={() => updateOrder(selectedOrder, "billed")} disabled={saving}>Receive & create purchase invoice</button>}</div></section></div>}

    {action && <div className="modal-backdrop" onMouseDown={() => setAction("")}><section className="modal operation-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><small>{actionMeta[action]?.code} · FY {fiscalYear.label_bs}</small><h2>{actionMeta[action]?.title}</h2><p>{actionMeta[action]?.description}</p></div><button onClick={() => setAction("")}>×</button></div><div className="operation-form">
      <label>Date (BS)<BsDateInput min={fiscalYear.start_ad} max={fiscalYear.end_ad} value={date} onChange={setDate} /></label>
      {action === "purchase_order" && <><label>Supplier<select value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">Select supplier</option>{parties.filter((party) => ["supplier", "both"].includes(party.party_type)).map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label><label>Expected delivery (BS)<BsDateInput value={expectedDate} onChange={setExpectedDate} /></label><label>Supplier reference<input value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} placeholder="Optional quotation / PI reference" /></label></>}
      {["sale_return", "purchase_return"].includes(action) && <><label className="full">Original {action === "sale_return" ? "sales" : "purchase"} invoice<select value={sourceVoucherId} onChange={(event) => chooseSource(event.target.value)}><option value="">Select original invoice</option>{sourceInvoices.map((voucher: any) => <option key={voucher.id} value={voucher.id}>#{voucher.sequence_no || voucher.voucher_no} · {formatBs(voucher.voucher_date)} · {voucher.party?.name} · {money(voucher.total)}</option>)}</select></label></>}
      {["purchase_order", "sale_return", "purchase_return"].includes(action) && <div className="operation-lines full"><div className="operation-line-head"><span>ITEM / DESCRIPTION</span><span>QUANTITY</span><span>RATE</span><span>AMOUNT</span><span></span></div>{lines.map((line, index) => <div className="operation-line" key={index}><div><select value={line.product_id} disabled={action !== "purchase_order"} onChange={(event) => chooseItem(index, event.target.value)}><option value="">{action === "purchase_order" ? "Custom item" : "Select source invoice"}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock_qty} {product.unit}</option>)}</select>{action === "purchase_order" && !line.product_id && <input value={line.name} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} placeholder="Item description" />}</div><input type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))} /><input type="number" min="0" step="0.01" readOnly={action !== "purchase_order"} value={line.rate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, rate: Number(event.target.value) } : row))} /><strong>{money(line.quantity * line.rate)}</strong><button disabled={lines.length === 1 || action !== "purchase_order"} onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}{action === "purchase_order" && <button className="add-line" onClick={() => setLines((current) => [...current, itemLine()])}>＋ Add another item</button>}</div>}
      {action === "purchase_order" && <><label>Discount %<input type="number" min="0" max="100" value={discountPercent} onChange={(event) => setDiscountPercent(Number(event.target.value))} /></label><label>VAT / Tax %<input type="number" min="0" value={taxPercent} onChange={(event) => setTaxPercent(Number(event.target.value))} /></label><div className="operation-total full"><span>Subtotal <strong>{money(subtotal)}</strong></span><span>Discount <strong>− {money(discount)}</strong></span><span>Tax <strong>＋ {money(tax)}</strong></span><span>Total <strong>{money(subtotal - discount + tax)}</strong></span></div></>}
      {action === "manual_journal" && <div className="operation-lines full"><div className="journal-control"><span>Debit <strong>{money(journalLines.reduce((sum, line) => sum + Number(line.debit || 0), 0))}</strong></span><span>Credit <strong>{money(journalLines.reduce((sum, line) => sum + Number(line.credit || 0), 0))}</strong></span></div>{journalLines.map((line, index) => <div className="journal-line" key={index}><select value={line.account_id} onChange={(event) => setJournalLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, account_id: event.target.value } : row))}><option value="">Select ledger account</option>{data?.accounts?.map((account: any) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><select value={line.party_id} onChange={(event) => setJournalLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, party_id: event.target.value } : row))}><option value="">No party</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select><input placeholder="Line description" value={line.description} onChange={(event) => setJournalLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} /><input aria-label={`Debit ${index + 1}`} type="number" min="0" placeholder="Debit" value={line.debit || ""} onChange={(event) => setJournalLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, debit: Number(event.target.value), credit: Number(event.target.value) ? 0 : row.credit } : row))} /><input aria-label={`Credit ${index + 1}`} type="number" min="0" placeholder="Credit" value={line.credit || ""} onChange={(event) => setJournalLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, credit: Number(event.target.value), debit: Number(event.target.value) ? 0 : row.debit } : row))} /><button disabled={journalLines.length === 2} onClick={() => setJournalLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}<button className="add-line" onClick={() => setJournalLines((current) => [...current, journalLine()])}>＋ Add journal line</button></div>}
      {action === "contra" && <><label>Transfer from<select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}><option value="">Select source</option>{moneyAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><label>Transfer to<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">Select destination</option>{moneyAccounts.filter((account) => account.id !== fromAccountId).map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><label>Amount (Rs.)<input type="number" min="0.01" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} /></label></>}
      {action === "stock_adjustment" && <div className="operation-lines full">{stockLines.map((line, index) => <div className="stock-journal-line" key={index}><select value={line.product_id} onChange={(event) => { const product = products.find((row) => row.id === event.target.value); setStockLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, product_id: event.target.value, unit_cost: Number(product?.purchase_price || 0) } : row)); }}><option value="">Select item</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · Current {product.stock_qty} {product.unit}</option>)}</select><input type="number" step="0.001" placeholder="+ increase / − decrease" value={line.quantity_delta || ""} onChange={(event) => setStockLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity_delta: Number(event.target.value) } : row))} /><input type="number" min="0" step="0.01" placeholder="Unit cost" value={line.unit_cost || ""} onChange={(event) => setStockLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unit_cost: Number(event.target.value) } : row))} /><input placeholder="Reason" value={line.reason} onChange={(event) => setStockLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, reason: event.target.value } : row))} /><button disabled={stockLines.length === 1} onClick={() => setStockLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}<small>Positive quantity increases stock; negative quantity decreases it. Every change creates a stock and general-ledger audit trail.</small><button className="add-line" onClick={() => setStockLines((current) => [...current, stockLine()])}>＋ Add stock line</button></div>}
      {action === "save_bom" && <><label>BOM name<input value={bomName} onChange={(event) => setBomName(event.target.value)} /></label><label>Version<input value={bomVersion} onChange={(event) => setBomVersion(event.target.value)} /></label><label>Finished product<select value={outputProductId} onChange={(event) => setOutputProductId(event.target.value)}><option value="">Select output item</option>{finishedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Base output quantity<input type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(Number(event.target.value))} /></label><div className="operation-lines full"><h4>Components required for this base output</h4>{bomLines.map((line, index) => <div className="bom-line" key={index}><select value={line.product_id} onChange={(event) => setBomLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, product_id: event.target.value } : row))}><option value="">Select raw material / packaging</option>{rawProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock_qty} {product.unit}</option>)}</select><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setBomLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))} /><input type="number" min="0" step="0.01" value={line.wastage_percent} onChange={(event) => setBomLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, wastage_percent: Number(event.target.value) } : row))} placeholder="Wastage %" /><button disabled={bomLines.length === 1} onClick={() => setBomLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}<button className="add-line" onClick={() => setBomLines((current) => [...current, bomLine()])}>＋ Add component</button></div></>}
      {action === "bom_production" && <><label className="full">Bill of Materials<select value={bomId} onChange={(event) => setBomId(event.target.value)}><option value="">Select approved BOM</option>{data?.boms?.filter((bom: any) => bom.active).map((bom: any) => <option key={bom.id} value={bom.id}>{bom.output?.name} · {bom.name} v{bom.version} · base {bom.output_quantity} {bom.output?.unit}</option>)}</select></label><label>Production quantity<input type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(Number(event.target.value))} /></label>{bomId && <div className="bom-preview full">{data?.boms?.find((bom: any) => bom.id === bomId)?.bom_components?.map((component: any) => { const selected = data.boms.find((bom: any) => bom.id === bomId); const required = Number(component.quantity) * (1 + Number(component.wastage_percent) / 100) * outputQuantity / Number(selected.output_quantity); return <span key={component.id}><strong>{component.products?.name}</strong><small>Required {required.toFixed(3)} {component.products?.unit} · Available {component.products?.stock_qty}</small></span>; })}</div>}</>}
      {action === "payroll" && <><label>Payroll period<input value={payrollPeriod} onChange={(event) => setPayrollPeriod(event.target.value)} placeholder="e.g. Bhadra 2083" /></label><div className="operation-lines full"><div className="operation-total payroll-total"><span>Gross <strong>{money(payrollLines.reduce((sum, line) => sum + Number(line.basic_salary) + Number(line.allowances), 0))}</strong></span><span>Deductions <strong>{money(payrollLines.reduce((sum, line) => sum + Number(line.deductions), 0))}</strong></span><span>Net payable <strong>{money(payrollLines.reduce((sum, line) => sum + Number(line.basic_salary) + Number(line.allowances) - Number(line.deductions), 0))}</strong></span></div>{payrollLines.map((line, index) => <div className="payroll-line" key={index}><select value={line.team_member_id} onChange={(event) => setPayrollLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, team_member_id: event.target.value } : row))}><option value="">Select employee</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select><input type="number" min="0" placeholder="Basic salary" value={line.basic_salary || ""} onChange={(event) => setPayrollLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, basic_salary: Number(event.target.value) } : row))} /><input type="number" min="0" placeholder="Allowances" value={line.allowances || ""} onChange={(event) => setPayrollLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, allowances: Number(event.target.value) } : row))} /><input type="number" min="0" placeholder="Deductions" value={line.deductions || ""} onChange={(event) => setPayrollLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, deductions: Number(event.target.value) } : row))} /><button disabled={payrollLines.length === 1} onClick={() => setPayrollLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}<button className="add-line" onClick={() => setPayrollLines((current) => [...current, payrollLine()])}>＋ Add employee</button></div></>}
      <label className="full">Narration / notes<input value={narration} onChange={(event) => setNarration(event.target.value)} placeholder="Purpose, reference or internal note" /></label>
    </div><div className="modal-actions"><button onClick={() => setAction("")}>Cancel</button><button className="primary" onClick={submit} disabled={saving}>{saving ? "Posting…" : action === "purchase_order" ? "Save purchase order" : action === "save_bom" ? bomId ? "Update BOM" : "Save BOM" : "Post voucher"}</button></div></section></div>}
  </section>;
}
