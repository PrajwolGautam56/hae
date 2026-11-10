"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BsDateInput from "./bs-date-input";
import { adToBsParts, formatBs } from "../lib/nepali-date";
import OverviewAnalytics from "./overview-analytics";
import type { OverviewMonth } from "../lib/overview-model";
import { downloadCsv, printDocument } from "../lib/export-data";
import CrmWorkspace from "./crm-workspace";
import ReportsWorkspace from "./reports-workspace";
import ChequeWorkspace from "./cheque-workspace";
import FundsWorkspace from "./funds-workspace";
import OrdersWorkspace from "./orders-workspace";
import ClientAccessPanel from "./client-access-panel";
import AccountingOperationsWorkspace from "./accounting-operations-workspace";
import DocumentsWorkspace from "./documents-workspace";
import { getCachedJson, invalidateClientCache } from "../lib/client-data-cache";
import "./performance-status.css";
import { continueSalesEntry, nextInvoicePreview, saleNumberKey, salesNumberPreview } from "../lib/invoice-entry-flow";
import { invoiceDraftNumber, invalidInvoiceLine, type InvoiceDraftNumber } from "../lib/invoice-line-entry";
import "./invoice-entry.css";
import { amountInWords } from "../lib/amount-in-words";
import { voucherPrintHtml } from "../lib/voucher-print";
import VoucherPrintPreview from "./voucher-print-preview";
import PartyDetailsEditor from "./party-details-editor";
import { matchingParties } from "../lib/party-search";
import { clearInvoiceDraft, invoiceDraftKey, loadInvoiceDraft, saveInvoiceDraft, type InvoiceDraft } from "../lib/invoice-draft";

const nav = [
  "Overview",
  "Sales",
  "Quotations",
  "Purchases",
  "Accounting",
  "Payments",
  "Orders",
  "Cheques",
  "Parties",
  "Inventory",
  "Stock",
  "Manufacturing",
  "Cash & Bank",
  "Expenses",
  "Reports",
  "Leads",
  "Tasks",
  "Activity",
  "Team",
];
const navFeature: Record<string, string> = {
  Sales: "sales", Quotations: "sales", Purchases: "purchases", Payments: "accounting", Orders: "orders",
  Cheques: "cheques", Parties: "accounting", Inventory: "inventory", Stock: "inventory",
  "Cash & Bank": "cash_bank", Expenses: "accounting", Reports: "reports",
  Leads: "crm", Tasks: "tasks", Activity: "crm", Team: "accounting",
  Accounting: "accounting", Manufacturing: "manufacturing",
};

const iconPaths:Record<string,string>={Overview:"M3 11.5 12 4l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",Sales:"M5 19 19 5m-9 0h9v9",Purchases:"M19 5 5 19m9 0H5v-9",Accounting:"M4 6h16M6 10h12M8 14h8M10 18h4",Manufacturing:"M4 20h16M6 20V9l4 3V9l4 3V5h4v15M8 16h2m4 0h2",Payments:"M4 7h16M4 12h16M4 17h10",Orders:"M6 6h15l-2 8H8L6 3H3m6 15a1 1 0 1 0 0 2 1 1 0 0 0 0-2m8 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2",Cheques:"M3 6h18v12H3zM7 14h4",Parties:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75 1",Inventory:"M4 7h16v13H4zM8 3h8v4M8 11h8",Stock:"M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10","Cash & Bank":"M3 7h18v13H3zM7 7V5h10v2M7 12h4m6 0h.01M7 16h10",Expenses:"M6 2h9l3 3v17H6zM9 13h6M9 17h4",Reports:"M4 19V9m5 10V5m5 14v-7m5 7V3",Leads:"M12 22s7-4.35 7-11A7 7 0 1 0 5 11c0 6.65 7 11 7 11m0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6",Tasks:"M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",Activity:"M3 12h4l2-7 4 14 2-7h6",Team:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m14 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75 1"};
function NavIcon({name}:{name:string}){return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]||iconPaths.Overview}/></svg>}
const transactionIcon = (type: string) => type === "Sales Invoice" ? "Sales" : type === "Payment Received" ? "Payments" : type === "Purchase" ? "Purchases" : "Expenses";

const money = (n: number) => `Rs. ${Math.abs(n).toLocaleString("en-IN")}`;
const compactMoney = (n: number) => {
  const value = Math.abs(Number(n) || 0);
  if (value >= 10_000_000) return `Rs. ${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Cr`;
  if (value >= 100_000) return `Rs. ${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)} L`;
  if (value >= 1_000) return `Rs. ${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `Rs. ${value.toLocaleString("en-IN")}`;
};
const localBusinessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const today = localBusinessDate();
const standardUnits = ["pcs", "litre", "ml", "kg", "gram", "bag", "box", "bucket", "drum", "sheet", "meter", "feet", "set", "dozen"];
const parseDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
const bsDate = formatBs;
const adMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const adDate = (value: string) => {
  const d = parseDate(value);
  return `${String(d.getDate()).padStart(2, "0")} ${adMonths[d.getMonth()]} ${d.getFullYear()}`;
};
type SaleLine = {
  productId: string;
  name: string;
  quantity: InvoiceDraftNumber;
  rate: InvoiceDraftNumber;
  unit?: string;
  itemType?: string;
};
const emptySaleLine = (): SaleLine => ({
  productId: "",
  name: "",
  quantity: 1,
  rate: "",
  unit: "pcs",
  itemType: "finished_good",
});

export default function Home() {
  const [voucherPrint, setVoucherPrint] = useState<string | null>(null);
  const voucherDocument = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [entitlements, setEntitlements] = useState<Record<string, boolean>>({});
  const [clientToday, setClientToday] = useState("");
  const [active, setActive] = useState("Overview");
  const [modal, setModal] = useState<
    "sale" | "payment" | "purchase" | "expense" | "party" | "product" | "production" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [noticeVersion, setNoticeVersion] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [draftStored, setDraftStored] = useState(true);
  const [resumeRequested, setResumeRequested] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [query, setQuery] = useState("");
  const [formParty, setFormParty] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [partyActiveIndex, setPartyActiveIndex] = useState(-1);
  const [parties, setParties] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [monthlyPerformance, setMonthlyPerformance] = useState<OverviewMonth[]>([]);
  const [overviewThrough, setOverviewThrough] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [moneyAccounts, setMoneyAccounts] = useState<any[]>([]);
  const [currentMember, setCurrentMember] = useState<any>(null);
  const [company, setCompany] = useState<any>({ name: "Company workspace" });
  const [totals, setTotals] = useState({
    sales: 0,
    received: 0,
    receivable: 0,
  });
  const [nextNumbers, setNextNumbers] = useState({ sale: 1, sale_non_vat: 1, receipt: 1, purchase: 1, expense: 1 });
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [handledBy, setHandledBy] = useState("");
  const [moneyAccountId, setMoneyAccountId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeExchangeDate, setChequeExchangeDate] = useState("");
  const [chequeCounts, setChequeCounts] = useState({ pending: 0, dueToday: 0, overdue: 0 });
  const [chequeBanks, setChequeBanks] = useState<any[]>([]);
  const [particulars, setParticulars] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const salesPartyInput = useRef<HTMLInputElement>(null);
  const inlineNewPartyInput = useRef<HTMLInputElement>(null);
  const invoiceScroll = useRef<HTMLDivElement>(null);
  const [lastSavedSale, setLastSavedSale] = useState<string | null>(null);
  const [snapshotSync, setSnapshotSync] = useState<"idle" | "loading" | "failed">("idle");
  const pendingRefresh = useRef<{ fiscalYearId: string; label: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(current => current === notice ? "" : current), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeVersion]);
  useEffect(() => {
    if (lastSavedSale === null || snapshotSync !== "idle") return;
    const timer = window.setTimeout(() => setLastSavedSale(null), 5000);
    return () => window.clearTimeout(timer);
  }, [lastSavedSale, snapshotSync]);
  const [calendar, setCalendar] = useState<"BS" | "AD">("BS");
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  const [fiscalYear, setFiscalYear] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([emptySaleLine()]);
  const [cancelledSale, setCancelledSale] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const lineNameInputs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingLineFocus = useRef<number | null>(null);
  useEffect(() => {
    const index = pendingLineFocus.current;
    if (index === null) return;
    pendingLineFocus.current = null;
    lineNameInputs.current[index]?.focus();
  }, [saleLines]);
  const [taxPercent, setTaxPercent] = useState(13);
  const [billCategory, setBillCategory] = useState("vat");
  const [supplierBillNo, setSupplierBillNo] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [newPartyName, setNewPartyName] = useState("");
  const [entityName, setEntityName] = useState("");
  const [place, setPlace] = useState("");
  const [phone, setPhone] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [salePrice, setSalePrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingSide, setOpeningSide] = useState<"debit" | "credit">("debit");
  const [transactionDate, setTransactionDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [voucherDetail, setVoucherDetail] = useState<any>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [editingVoucherNumber, setEditingVoucherNumber] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [productType, setProductType] = useState("finished_good");
  const [outputProductId, setOutputProductId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("");
  const [productionInputs, setProductionInputs] = useState([{ productId: "", quantity: 0 }]);
  const [reportPartyId, setReportPartyId] = useState("");
  const [editingPartyId, setEditingPartyId] = useState("");
  const [reportVersion, setReportVersion] = useState(0);
  const fiscalRequest = useRef(0);
  const visibleParties = useMemo(
    () =>
      parties.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [parties, query],
  );
  const visibleNav = useMemo(() => nav.filter((item) => !navFeature[item] || entitlements[navFeature[item]] !== false), [entitlements]);
  const partyMatches = useMemo(() => matchingParties(parties, partySearch), [parties, partySearch]);
  function currentInvoiceDraft(): InvoiceDraft {
    return { cancelledSale, cancellationReason, formParty, partySearch, newPartyName, place, phone, taxNo, transactionDate, dueDate, particulars, billCategory, taxPercent, discountPercent, supplierBillNo, saleLines };
  }
  useEffect(() => {
    if (modal !== "sale" || editingVoucherId) return;
    const key = invoiceDraftKey(company?.id, currentMember?.id, fiscalYear?.id);
    if (!key) return;
    const timer = window.setTimeout(() => saveInvoiceDraft(key, currentInvoiceDraft()), 300);
    return () => window.clearTimeout(timer);
  }, [modal, editingVoucherId, company?.id, currentMember?.id, fiscalYear?.id, cancelledSale, cancellationReason, formParty, partySearch, newPartyName, place, phone, taxNo, transactionDate, dueDate, particulars, billCategory, taxPercent, discountPercent, supplierBillNo, saleLines]);

  function chooseExistingParty(name: string) {
    setFormParty(name);
    setPartySearch(name);
    setNewPartyName("");
    setPartyPickerOpen(false);
    setPartyActiveIndex(-1);
  }
  function chooseNewParty() {
    const typedName = partySearch.trim();
    setNewPartyName(parties.some(party => party.name.toLocaleLowerCase() === typedName.toLocaleLowerCase()) ? "" : typedName);
    setFormParty("__new__");
    setPartySearch("");
    setPartyPickerOpen(false);
    setPartyActiveIndex(-1);
    requestAnimationFrame(() => inlineNewPartyInput.current?.focus());
  }

  useEffect(() => {
    setClientToday(localBusinessDate());
    void fetch("/api/platform/companies", { cache: "no-store" }).then((response) => response.json()).then((body) => setEntitlements(body.entitlements || {})).catch(() => {});
  }, []);
  async function refreshChequeCounts() {
    try {
      const data = await getCachedJson<any>("cheques:snapshot", "/api/cheques", { maxAgeMs: 30_000 });
      setChequeCounts(data.counts); setChequeBanks(data.banks || []);
    } catch {}
  }
  useEffect(() => { refreshChequeCounts(); }, []);

  function applySnapshot(data: any) {
    if (!data?.parties || !data?.transactions) return;
    setParties(
      data.parties.map((p: any, i: number) => ({
        ...p,
        initials: p.name
          .split(" ")
          .map((x: string) => x[0])
          .slice(0, 2)
          .join(""),
        tone: ["amber", "blue", "green", "violet"][i % 4],
      })),
    );
    setTransactions(
      data.transactions.map((t: any) => ({
        ...t,
        type:
          (
            {
              sale: "Sales Invoice",
              receipt: "Payment Received",
              payment: "Payment Given",
              purchase: "Purchase",
              sale_return: "Sales Return",
              purchase_return: "Purchase Return",
              journal: "Journal Voucher",
              contra: "Contra Voucher",
              stock_adjustment: "Stock Journal",
              payroll: "Payroll Voucher",
              expense: "Office Expense",
            } as any
          )[t.type] || t.type,
      })),
    );
    setTotals(data.totals);
    setMonthlyPerformance(data.monthlyPerformance || []);
    setOverviewThrough(data.overviewThrough || "");
    setMembers(data.members || []);
    setMoneyAccounts(data.moneyAccounts || []);
    setCurrentMember(data.currentMember || null);
    setNextNumbers({ sale: 1, sale_non_vat: 1, receipt: 1, purchase: 1, expense: 1, ...data.nextNumbers });
    setFiscalYears(data.fiscalYears || []);
    setFiscalYear(data.fiscalYear || null);
    setProducts(data.products || []);
    setCompany(data.company || { name: "Company workspace" });
    try { sessionStorage.setItem(`hae-snapshot-${data.fiscalYear?.id || "current"}`, JSON.stringify(data)); sessionStorage.setItem("hae-snapshot-current", JSON.stringify(data)); } catch {}
  }
  function clearReportCache(){invalidateClientCache("reports:");try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith("hae-report-"))sessionStorage.removeItem(key)}}catch{}}
  function warmModule(item:string){
    if(["Leads","Tasks","Activity","Team"].includes(item))void getCachedJson("crm:snapshot","/api/crm",{maxAgeMs:30_000}).catch(()=>{});
    if(item==="Orders")void getCachedJson("orders:snapshot","/api/orders",{maxAgeMs:20_000}).catch(()=>{});
    if(item==="Cheques")void getCachedJson("cheques:snapshot","/api/cheques",{maxAgeMs:30_000}).catch(()=>{});
    if(item==="Cash & Bank"&&fiscalYear?.id)void getCachedJson(`funds:${fiscalYear.id}`,`/api/funds?fy=${fiscalYear.id}`,{maxAgeMs:30_000}).catch(()=>{});
    if(item==="Reports"&&fiscalYear?.id){const reportDate=localBusinessDate();const q=new URLSearchParams({fiscalYearId:fiscalYear.id,type:"daybook",from:reportDate,to:reportDate});void getCachedJson(`reports:${q}`,`/api/reports?${q}`,{maxAgeMs:45_000}).catch(()=>{})}
  }
  useEffect(() => {
    try { const cached=sessionStorage.getItem("hae-snapshot-current");if(cached)applySnapshot(JSON.parse(cached)); } catch {}
    const controller=new AbortController();
    const request = ++fiscalRequest.current;
    fetch("/api/accounting",{signal:controller.signal,cache:"no-store"})
      .then(async(r) => {const data=await r.json();if(!r.ok)throw new Error(data.error||"Database could not be loaded");return data})
      .then(data => { if (request === fiscalRequest.current) { applySnapshot(data); if (new URLSearchParams(window.location.search).get("resumeInvoice") === "1") setResumeRequested(true); } })
      .catch((error) => {if(error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Database could not be loaded")});
    return()=>controller.abort();
  }, []);
  async function changeFiscalYear(id: string) {
    const request = ++fiscalRequest.current;
    try{const cached=sessionStorage.getItem(`hae-snapshot-${id}`);if(cached)applySnapshot(JSON.parse(cached))}catch{}
    const data = await fetch(`/api/accounting?fy=${id}`,{cache:"no-store"}).then(async(r) => {const body=await r.json();if(!r.ok)throw new Error(body.error||"Database could not be loaded");return body});
    if (request === fiscalRequest.current) {
      applySnapshot(data);
      const inYear = today >= data.fiscalYear.start_ad && today <= data.fiscalYear.end_ad;
      setTransactionDate(inYear ? today : data.fiscalYear.end_ad);
    }
  }

  async function save(kind: string) {
    if (saveLock.current) return;
    if (snapshotSync !== "idle") { setNotice("Your last entry is saved. Refresh the latest totals before saving another entry."); return; }
    if (modal === "sale" && cancelledSale && editingVoucherId && !window.confirm("Cancel this posted sales bill? Its original details remain in the audit log, while sales, party balance and stock effects are reversed. Separate payment receipts are not cancelled; check the party ledger afterwards. This cannot be undone.")) return;
    saveLock.current = true; setSaving(true);
    try { await saveEntry(kind); }
    catch { setNotice("Connection interrupted. Save status is not confirmed—check the register before submitting again to avoid a duplicate."); }
    finally { saveLock.current = false; setSaving(false); }
  }

  async function refreshSavedAccounting(fiscalYearId: string, label: string) {
    pendingRefresh.current = { fiscalYearId, label };
    setSnapshotSync("loading");
    const request = ++fiscalRequest.current;
    try {
      const response = await fetch(`/api/accounting?fy=${encodeURIComponent(fiscalYearId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh totals");
      if (request === fiscalRequest.current) applySnapshot(data);
      setSnapshotSync("idle"); pendingRefresh.current = null;
    } catch {
      setSnapshotSync("failed");
      setNotice(`${label} is already saved. Totals could not refresh; retry the refresh, not the entry.`);
    }
  }

  async function saveEntry(kind: string) {
    if (modal === "production") {
      const consumptions = productionInputs.filter((row) => row.productId && Number(row.quantity) > 0);
      if (!outputProductId || Number(outputQuantity) <= 0 || !consumptions.length) {
        setNotice("Select an output product, quantity and at least one material");
        return;
      }
      setSaving(true);
      const response = await fetch("/api/manufacturing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalYearId: fiscalYear.id, date: transactionDate, outputProductId, outputQuantity: Number(outputQuantity), consumptions: consumptions.map((row) => ({ product_id: row.productId, quantity: Number(row.quantity) })), notes: particulars }) });
      const data = await response.json();
      setSaving(false);
      if (!response.ok) { setNotice(data.error || "Could not record production"); return; }
      const refreshed = await fetch(`/api/accounting?fy=${fiscalYear.id}`).then((r) => r.json());
      applySnapshot(refreshed); setModal(null); setOutputProductId(""); setOutputQuantity(""); setProductionInputs([{ productId: "", quantity: 0 }]); setParticulars(""); setNotice(`Production batch ${data.batch_no} saved`); return;
    }
    const party = parties.find((p) => p.name === formParty);
    const isCancelledSale = modal === "sale" && cancelledSale;
    if ((modal === "sale" || modal === "purchase") && !isCancelledSale) {
      const invalidIndex = invalidInvoiceLine(saleLines);
      if (invalidIndex !== -1) {
        setNotice(`Item ${invalidIndex + 1}: enter a name, quantity greater than zero, and a rate (0 is allowed).`);
        return;
      }
    }
    const validLines = saleLines.filter(
      (l) => l.name.trim() && l.quantity !== "" && l.quantity > 0 && l.rate !== "" && l.rate >= 0,
    );
    if (
      (modal === "sale" || modal === "purchase") && !isCancelledSale &&
      (!validLines.length || (!party && !newPartyName.trim()))
    ) {
      setNotice(partySearch.trim() && !party && !newPartyName.trim() ? "Choose a party from the search results or add it as a new party." : "Please add a party and at least one valid product");
      return;
    }
    if (
      (modal === "payment" || modal === "expense") &&
      (!amount || Number(amount) <= 0)
    ) {
      setNotice("Please enter a valid amount");
      return;
    }
    if ((modal === "expense" || (modal === "payment" && paymentMode !== "Cheque")) && !moneyAccountId) {
      setNotice(modal === "payment" ? "Select where the payment was received" : "Select the cash or bank account used");
      return;
    }
    if (modal === "payment" && !party && !newPartyName.trim()) {
      setNotice("Please select a party or add a new party");
      return;
    }
    if (modal === "payment" && paymentMode === "Cheque") {
      if (!chequeNo.trim()) { setNotice("Please enter the cheque number"); return; }
      if (!chequeBank.trim()) { setNotice("Please enter or select the bank name"); return; }
      if (!chequeExchangeDate) { setNotice("Please select the cheque exchange date"); return; }
    }
    const draftKey = modal === "sale" && !editingVoucherId ? invoiceDraftKey(company?.id, currentMember?.id, fiscalYear?.id) : null;
    const draftWasStored = draftKey ? saveInvoiceDraft(draftKey, currentInvoiceDraft()) : false;
    setSaving(true);
    const response = await fetch("/api/accounting", {
      method: editingVoucherId || editingProductId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        voucherId: editingVoucherId || undefined,
        productId: editingProductId || undefined,
        type: modal || "payment",
        cancelledSale: isCancelledSale,
        partyId: modal === "expense" ? undefined : party?.id,
        partyName:
          modal === "party"
            ? entityName
            : modal === "expense"
              ? ""
              : party?.name || newPartyName.trim(),
        amount: Number(amount),
        particulars: isCancelledSale ? cancellationReason : particulars,
        paymentMode,
        handledBy: handledBy || currentMember?.id,
        moneyAccountId,
        chequeNo,
        chequeBank,
        chequeExchangeDate,
        date: transactionDate,
        dueDate: dueDate || null,
        fiscalYearId: fiscalYear?.id,
        lines: validLines.map((l) => ({
          product_id: l.productId || null,
          name: l.name,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
          unit: l.unit || "pcs",
          item_type: l.itemType || "finished_good",
        })),
        taxPercent,
        billCategory,
        supplierBillNo,
        discountPercent,
        productName: entityName,
        sku,
        unit,
        salePrice: Number(salePrice || 0),
        purchasePrice: Number(purchasePrice || 0),
        mrp: Number(mrp || 0),
        openingStock: Number(openingStock || 0),
        openingBalance:
          Number(openingBalance || 0) * (openingSide === "credit" ? -1 : 1),
        productType,
        place,
        phone,
        taxNo,
        partyType: "both",
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      if (response.status === 401 && modal === "sale") {
        setSessionExpired(true);
        setDraftStored(draftWasStored);
        setNotice(draftWasStored ? "Your sign-in expired. The invoice draft is safe in this browser. Sign in again to continue." : "Your sign-in expired. Keep this tab open: browser draft storage is unavailable. Copy the invoice details before signing in again.");
      } else setNotice(data.error || "Could not save");
      return;
    }
    if (draftKey) clearInvoiceDraft(draftKey);
    setSessionExpired(false);
    setDraftStored(true);
    setDraftRestored(false);
    clearReportCache();
    invalidateClientCache("cheques:");
    invalidateClientCache("funds:");
    invalidateClientCache("crm:");
    invalidateClientCache("orders:");
    if (data.saved && data.refreshRequired) void refreshSavedAccounting(data.fiscalYearId, kind);
    else applySnapshot(data);
    const startNextSale = continueSalesEntry(modal, editingVoucherId);
    if (startNextSale) {
      const savedNumber = data.savedRecord?.number || data.savedRecord?.sequence;
      setLastSavedSale(isCancelledSale ? null : savedNumber ? String(savedNumber) : "");
      const previewNumber = nextInvoicePreview(data.savedRecord?.sequence);
      if (previewNumber) setNextNumbers(current => ({ ...current, [saleNumberKey(data.savedRecord?.series)]: previewNumber }));
      setFormParty("");
      setPartySearch("");
      setPartyPickerOpen(false);
      setDiscountPercent(0);
      setSupplierBillNo("");
      // Keep the selected date and VAT treatment for batch entry, but no customer/items/discount.
      requestAnimationFrame(() => {
        invoiceScroll.current?.scrollTo({ top: 0 });
        salesPartyInput.current?.focus({ preventScroll: true });
      });
    } else setModal(null);
    setEditingVoucherId("");
    setEditingVoucherNumber("");
    setCancelledSale(false);
    setCancellationReason("");
    setEditingProductId("");
    setAmount("");
    setPaymentMode("Cash");
    setChequeNo(""); setChequeBank(""); setChequeExchangeDate("");
    setParticulars("");
    setSaleLines([emptySaleLine()]);
    setNewPartyName("");
    setEntityName("");
    setPlace("");
    setPhone("");
    setTaxNo("");
    setSku("");
    setSalePrice("");
    setPurchasePrice("");
    setMrp("");
    setOpeningStock("");
    setOpeningBalance("");
    setOpeningSide("debit");
    setDueDate("");
    setNotice(isCancelledSale ? `Bill #${data.savedRecord?.number || ""} cancelled. The number is retained with zero balance and no stock movement.` : startNextSale ? "Invoice saved. Ready for the next bill." : `${kind} saved successfully`);
    setNoticeVersion(version => version + 1);
    void refreshChequeCounts();
  }
  function openSale() {
    const key = invoiceDraftKey(company?.id, currentMember?.id, fiscalYear?.id);
    const draft = key ? loadInvoiceDraft(key) : null;
    setLastSavedSale(null);
    setEditingVoucherId("");
    setEditingVoucherNumber("");
    setCancelledSale(Boolean(draft?.cancelledSale));
    setCancellationReason(draft?.cancellationReason || "");
    setModal("sale");
    setSessionExpired(false);
    setDraftStored(true);
    setDraftRestored(Boolean(draft));
    setFormParty(draft?.formParty || "");
    setPartySearch(draft?.partySearch || "");
    setPartyPickerOpen(false);
    setSaleLines(draft?.saleLines?.length ? draft.saleLines : [emptySaleLine()]);
    setDiscountPercent(draft?.discountPercent ?? 0); setTaxPercent(draft?.taxPercent ?? 13); setBillCategory(draft?.billCategory || "vat"); setSupplierBillNo(draft?.supplierBillNo || ""); setParticulars(draft?.particulars || "");
    setNewPartyName(draft?.newPartyName || "");
    setPlace(draft?.place || ""); setPhone(draft?.phone || ""); setTaxNo(draft?.taxNo || "");
    setTransactionDate(draft?.transactionDate || (today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today));
    setDueDate(draft?.dueDate || "");
    if (draft) setNotice("Your unfinished invoice draft was restored from this browser. It has not been posted to the ledger.");
  }
  useEffect(() => {
    if (!resumeRequested || !company?.id || !currentMember?.id || !fiscalYear?.id) return;
    setResumeRequested(false);
    setActive("Sales");
    openSale();
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [resumeRequested, company?.id, currentMember?.id, fiscalYear?.id]);
  function discardSaleDraft() {
    const key = invoiceDraftKey(company?.id, currentMember?.id, fiscalYear?.id);
    if (key) clearInvoiceDraft(key);
    openSale();
  }
  function openPayment(preselectedParty = "") {
    setEditingVoucherId("");
    setModal("payment");
    setFormParty(preselectedParty);
    setPartySearch(preselectedParty);
    setPartyPickerOpen(false);
    setNewPartyName(""); setAmount(""); setParticulars("");
    setPaymentMode("Cash"); setChequeNo(""); setChequeBank(""); setChequeExchangeDate("");
    const collectorId=currentMember?.id||members[0]?.id||"";setHandledBy(collectorId);
    setMoneyAccountId(moneyAccounts.find((account)=>account.account_type==="employee_wallet"&&account.team_member_id===collectorId)?.id||moneyAccounts.find((account)=>account.account_type==="office_cash")?.id||"");
    setPlace(""); setPhone(""); setTaxNo("");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
    setDueDate("");
  }
  function openModuleModal(kind: "purchase" | "expense" | "party" | "product") {
    setEditingProductId("");
    setModal(kind);
    setAmount("");
    setParticulars("");
    setEntityName("");
    if (kind === "product") { setSku(""); setUnit("pcs"); setSalePrice(""); setPurchasePrice(""); setMrp(""); setOpeningStock(""); }
    setOpeningBalance(""); setOpeningSide("debit");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
    if(kind==="expense"){setPaymentMode("Cash");setHandledBy(currentMember?.id||"");setMoneyAccountId(moneyAccounts.find((account)=>account.account_type==="office_cash")?.id||moneyAccounts[0]?.id||"")}
    if (kind === "purchase") {
      setSaleLines([emptySaleLine()]);
      setDiscountPercent(0); setTaxPercent(13); setBillCategory("vat"); setSupplierBillNo("");
      setFormParty("");
      setPartySearch("");
      setPartyPickerOpen(false);
      setNewPartyName("");
      setPlace(""); setPhone(""); setTaxNo("");
    }
  }
  function editProduct(product: any) {
    setEditingProductId(product.id);
    setEntityName(product.name || "");
    setSku(product.sku || "");
    setUnit(product.unit || "pcs");
    setProductType(product.item_type || "finished_good");
    setPurchasePrice(String(product.purchase_price ?? 0));
    setMrp(String(product.mrp ?? 0));
    setSalePrice(String(product.sale_price ?? 0));
    setOpeningStock(String(product.stock_qty ?? 0));
    setModal("product");
  }
  function openProduction() {
    setModal("production"); setOutputProductId(products.find((p) => p.item_type === "finished_good")?.id || ""); setOutputQuantity(""); setProductionInputs([{ productId: "", quantity: 0 }]); setParticulars(""); setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
  }
  function updateSaleLine(index: number, patch: Partial<SaleLine>) {
    setSaleLines((lines) =>
      lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }
  function addSaleLine() {
    pendingLineFocus.current = saleLines.length;
    setSaleLines((lines) => [...lines, emptySaleLine()]);
  }
  function chooseProduct(index: number, id: string) {
    const product = products.find((p) => p.id === id);
    updateSaleLine(
      index,
      product
        ? {
            productId: id,
            name: product.name,
            rate: Number(
              modal === "purchase"
                ? product.purchase_price
                : product.sale_price,
            ),
          }
        : { productId: "", name: "", rate: "" },
    );
  }
  function wheelNumberInput(event: any) {
    event.preventDefault();
    event.currentTarget.blur();
    event.currentTarget
      .closest(".invoice-modal, .form-grid")
      ?.scrollBy({ top: event.deltaY, behavior: "auto" });
  }
  function reviewInvoiceTotal() {
    const body = document.querySelector<HTMLElement>(
      ".invoice-modal",
    );
    body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  async function openVoucherDetail(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true);
    setVoucherDetail({ id });
    try {
      const response = await fetch(`/api/accounting?voucherId=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load voucher details");
      if (detailRequest.current === controller && !controller.signal.aborted) setVoucherDetail(data);
    } catch (error) {
      if (detailRequest.current === controller && !controller.signal.aborted) {
        setVoucherDetail(null);
        setNotice(error instanceof Error ? error.message : "Could not load voucher details");
      }
    } finally {
      if (detailRequest.current === controller) setDetailLoading(false);
    }
  }
  function closeVoucherDetail() {
    detailRequest.current?.abort();detailRequest.current=null;
    setVoucherDetail(null);setDetailLoading(false);
  }
  useEffect(() => () => detailRequest.current?.abort(), []);
  async function editVoucher() {
    const detail=voucherDetail;if(!detail||!["sale","receipt"].includes(detail.voucher_type)||detail.document_status==="cancelled")return;
    if (detail.fiscal_year_id && detail.fiscal_year_id !== fiscalYear?.id) {
      const request=detailRequest.current;
      setDetailLoading(true);
      try { await changeFiscalYear(detail.fiscal_year_id); }
      catch(error) { if(detailRequest.current===request){setDetailLoading(false);setNotice(error instanceof Error?error.message:"Could not load the invoice financial year");} return; }
      if (detailRequest.current !== request) return;
    }
    setActive(detail.voucher_type === "sale" ? "Sales" : "Payments");
    setEditingVoucherId(detail.id);setEditingVoucherNumber(String(detail.voucher_no||detail.sequence_no||""));setFormParty(detail.parties?.name||"");setPartySearch(detail.parties?.name||"");setTransactionDate(detail.voucher_date);setDueDate(detail.due_date||"");setParticulars(detail.narration||"");
    if(detail.voucher_type==="sale"){setCancelledSale(false);setCancellationReason("");setSaleLines((detail.lines||[]).map((line:any)=>({productId:line.product_id||"",name:line.description||line.products?.name||"",quantity:Number(line.quantity),rate:Number(line.rate),unit:line.products?.unit||"pcs",itemType:"finished_good"})));setDiscountPercent(Number(detail.discount_percent||0));setTaxPercent(Number(detail.tax_percent||0));setBillCategory(detail.bill_category==="pan"?"non_vat":detail.bill_category==="unclassified"?(Number(detail.tax_amount)>0?"vat":"non_vat"):(detail.bill_category||"vat"));setSupplierBillNo(detail.supplier_bill_no||"");setModal("sale");}
    else{setAmount(String(detail.total||""));setPaymentMode(detail.payment_mode||"Cash");setHandledBy(detail.handled_by||currentMember?.id||"");setMoneyAccountId(detail.money_account_id||"");setChequeNo(detail.cheque_no||"");setChequeBank(detail.cheque_bank||"");setChequeExchangeDate(detail.cheque_exchange_date||"");setModal("payment");}
    closeVoucherDetail();
  }
  const saleSubtotal = saleLines.reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
    0,
  );
  const saleDiscount = (saleSubtotal * Math.max(0, discountPercent)) / 100;
  const saleTax =
    ((saleSubtotal - saleDiscount) * Math.max(0, taxPercent)) / 100;
  const saleGrand = saleSubtotal - saleDiscount + saleTax;
  const salesTransactions = transactions.filter(
    (t) => t.type === "Sales Invoice",
  );
  const stockValue = products.reduce(
    (sum, product) =>
      sum + Number(product.stock_qty || 0) * Number(product.purchase_price || 0),
    0,
  );
  const lowStockCount = products.filter(
    (product) => Number(product.stock_qty) <= Number(product.low_stock_at),
  ).length;
  const overviewBs = overviewThrough ? adToBsParts(overviewThrough) : null;
  const recentTransactions = transactions.slice(0, 8);
  const topOutstanding = visibleParties.filter((party) => Number(party.balance) > 0).slice(0, 6);
  const registerTransactions = transactions.filter((transaction) =>
    active === "Purchases"
      ? transaction.type === "Purchase"
      : active === "Payments"
        ? transaction.type === "Payment Received"
        : active === "Expenses"
          ? transaction.type === "Office Expense"
          : true,
  );
  const registerProducts = products.filter((product) =>
    active === "Inventory"
      ? ["raw_material", "packaging"].includes(product.item_type)
      : ["finished_good", "resale_good"].includes(product.item_type),
  );
  const nextInvoice = nextNumbers.sale;
  function openPrimaryAction(){if(active==="Sales")openSale();else if(active==="Purchases")openModuleModal("purchase");else if(active==="Payments")openPayment();else if(active==="Parties")openModuleModal("party");else if(active==="Inventory"||active==="Stock")openModuleModal("product");else if(active==="Expenses")openModuleModal("expense")}
  async function exportModule(module:string){
    if(module==="Inventory"||module==="Stock"){const rows=products.filter(p=>module==="Inventory"?["raw_material","packaging"].includes(p.item_type):["finished_good","resale_good"].includes(p.item_type));downloadCsv(`${module}-FY-${fiscalYear?.label_bs}`,rows,[{label:"SKU",value:(r:any)=>r.sku},{label:"Product",value:(r:any)=>r.name},{label:"Type",value:(r:any)=>r.item_type},{label:"Unit",value:(r:any)=>r.unit},{label:"Purchase price",value:(r:any)=>r.purchase_price},{label:"Sale price",value:(r:any)=>r.sale_price},{label:"MRP",value:(r:any)=>r.mrp},{label:"Stock quantity",value:(r:any)=>r.stock_qty}]);return}
    if(module==="Parties"){downloadCsv(`Parties-FY-${fiscalYear?.label_bs}`,parties,[{label:"Party",value:(r:any)=>r.name},{label:"Address",value:(r:any)=>r.place},{label:"Phone",value:(r:any)=>r.phone},{label:"PAN",value:(r:any)=>r.tax_no},{label:"Opening balance",value:(r:any)=>r.opening_balance},{label:"Current balance",value:(r:any)=>r.balance}]);return}
    const reportType=module==="Sales"?"sales":module==="Purchases"?"purchases":module==="Payments"?"payments":"expenses";try{const q=new URLSearchParams({fiscalYearId:fiscalYear.id,type:reportType,from:fiscalYear.start_ad,to:fiscalYear.end_ad});const response=await fetch(`/api/reports?${q}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error);downloadCsv(`${module}-FY-${fiscalYear?.label_bs}`,data.rows,[{label:"Reference",value:(r:any)=>r.ref},{label:"Date (BS)",value:(r:any)=>formatBs(r.date)},{label:"Party / Account",value:(r:any)=>r.party},{label:"Particulars",value:(r:any)=>r.particulars},{label:"Payment mode",value:(r:any)=>r.paymentMode},{label:"Subtotal",value:(r:any)=>r.subtotal},{label:"Discount",value:(r:any)=>r.discount},{label:"Tax",value:(r:any)=>r.tax},{label:"Amount",value:(r:any)=>r.amount},{label:"Debit",value:(r:any)=>r.debit},{label:"Credit",value:(r:any)=>r.credit}])}catch(error){setNotice(error instanceof Error?error.message:"Download failed")}
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          {company.logo_url && <img className="brand-logo" src={company.logo_url} alt={`${company.name} logo`} />}
          <div>
            <strong>{company.name}</strong>
            <span>COMPANY WORKSPACE</span>
          </div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={()=>setSidebarOpen(false)}>×</button>
        </div>
        <nav>
          <p>WORKSPACE</p>
          {visibleNav.map((item, i) => (
              <button
                key={item}
                className={active === item ? "active" : ""}
                onPointerEnter={() => warmModule(item)}
                onPointerDown={() => warmModule(item)}
                onClick={() => {
                setActive(item);
                setSidebarOpen(false);
              }}
            >
              <i><NavIcon name={item}/></i>
              {item}
              {["Inventory","Stock"].includes(item) && lowStockCount > 0 && <b>{lowStockCount}</b>}
              {item === "Cheques" && chequeCounts.pending > 0 && <b>{chequeCounts.pending}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button onClick={signOut}>
            <i>⚙</i>Settings
          </button>
          <button>
            <i>?</i>Help & Support
          </button>
          <div className="profile">
            <div>{(currentMember?.name || "Prajwol Gautam").split(" ").map((part:string)=>part[0]).slice(0,2).join("")}</div>
            <span>
              <strong>{currentMember?.name || "Prajwol Gautam"}</strong>
              <small>{currentMember?.role || "Administrator"}</small>
            </span>
            <button aria-label="Sign out" title="Sign out" onClick={signOut}>↪</button>
          </div>
        </div>
      </aside>

      <section className="content">
        <header>
          <div>
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            {company.logo_url && <img className="company-logo" src={company.logo_url} alt="" />}
            <div>
              <strong>{company.name}</strong>
              <small>FY {fiscalYear?.label_bs || "2083/84"} · NPR</small>
            </div>
            <strong className="mobile-page-title">{active}</strong>
          </div>
          <div className="fy-tools">
            <select
              aria-label="Financial year"
              disabled={saving || snapshotSync !== "idle"}
              value={fiscalYear?.id || ""}
              onChange={(e) => changeFiscalYear(e.target.value)}
            >
              {fiscalYears.map((f) => (
                <option key={f.id} value={f.id}>
                  FY {f.label_bs}
                  {f.status === "open" ? " · Current" : ""}
                </option>
              ))}
            </select>
            <div className="calendar-toggle">
              <button
                className={calendar === "BS" ? "on" : ""}
                onClick={() => setCalendar("BS")}
              >
                BS
              </button>
              <button
                className={calendar === "AD" ? "on" : ""}
                onClick={() => setCalendar("AD")}
              >
                AD
              </button>
            </div>
            {active === "Overview" && (
              <button
                className="primary"
                onClick={openSale}
              >
                ＋ New Transaction
              </button>
            )}
            {["Sales","Purchases","Payments","Parties","Inventory","Stock","Expenses"].includes(active)&&<button className="mobile-quick-add" aria-label={`Add ${active}`} onClick={openPrimaryAction}>＋</button>}
          </div>
        </header>

        <div className="page">
          {snapshotSync !== "idle" && <div role="status" className="snapshot-sync"><span>{snapshotSync === "loading" ? "Saved successfully · updating balances and stock…" : "Your entry is saved. Latest totals could not be loaded."}</span>{snapshotSync === "failed" && <button onClick={() => { const pending = pendingRefresh.current; if (pending) void refreshSavedAccounting(pending.fiscalYearId, pending.label); }}>Retry refresh</button>}</div>}
          <div className="title-row">
            <div>
              <p>
                {clientToday
                  ? calendar === "BS"
                    ? bsDate(clientToday)
                    : adDate(clientToday)
                  : "—"} · FY{" "}
                {fiscalYear?.label_bs}
              </p>
              <h1>{active}</h1>
            </div>
            <div className="title-actions">
              <span className={`year-status ${fiscalYear?.status}`}>
                {fiscalYear?.status === "closed" ? "Historical year" : "Current year"}
              </span>
              <span className="date-pill">FY {fiscalYear?.label_bs || "—"}</span>
            </div>
          </div>

          {["Leads", "Tasks", "Activity", "Team"].includes(active) ? (
            <CrmWorkspace section={active} onNotice={setNotice} />
          ) : active === "Overview" ? (
            <>
              {(chequeCounts.dueToday > 0 || chequeCounts.overdue > 0) && (
                <button className="cheque-alert" onClick={() => setActive("Cheques")}>
                  <span>▣</span><div><strong>{chequeCounts.dueToday} cheques to exchange today</strong><small>{chequeCounts.overdue} overdue cheque{chequeCounts.overdue === 1 ? "" : "s"} need attention</small></div><b>View cheque register →</b>
                </button>
              )}
              <section className="overview-stats" aria-label="Fiscal year summary">
                <button className="overview-stat" onClick={() => setActive("Sales")}>
                  <span className="overview-stat-icon sales"><NavIcon name="Sales" /></span>
                  <span><small>Total sales</small><strong>{compactMoney(totals.sales)}</strong><em>FY {fiscalYear?.label_bs}</em></span>
                </button>
                <button className="overview-stat" onClick={() => setActive("Parties")}>
                  <span className="overview-stat-icon due"><NavIcon name="Parties" /></span>
                  <span><small>To collect</small><strong>{compactMoney(totals.receivable)}</strong><em>From {parties.filter((party) => Number(party.balance) > 0).length} parties</em></span>
                </button>
                <button className="overview-stat" onClick={() => setActive("Payments")}>
                  <span className="overview-stat-icon collected"><NavIcon name="Payments" /></span>
                  <span><small>Collections</small><strong>{compactMoney(totals.received)}</strong><em>Payment receipts</em></span>
                </button>
                <button className="overview-stat" onClick={() => setActive("Stock")}>
                  <span className="overview-stat-icon stock"><NavIcon name="Stock" /></span>
                  <span><small>Stock value</small><strong>{compactMoney(stockValue)}</strong><em>{lowStockCount} low-stock item{lowStockCount === 1 ? "" : "s"}</em></span>
                </button>
              </section>

              <div className="dashboard-grid">
                <OverviewAnalytics key={fiscalYear?.id} months={monthlyPerformance} fiscalLabel={fiscalYear?.label_bs || "—"} currentKey={overviewBs ? `${overviewBs.year}-${overviewBs.month}` : ""} onOpen={target => { if (visibleNav.includes(target)) setActive(target); else setNotice("This module is not enabled for your company."); }} />

                <article className="quick card">
                  <div className="card-title">
                    <div>
                      <h3>Quick Actions</h3>
                      <p>Record a transaction</p>
                    </div>
                  </div>
                  <div className="quick-grid">
                    <button
                      onClick={openSale}
                    >
                      <i className="qa-blue"><NavIcon name="Sales" /></i>
                      <span>
                        <strong>Sales Invoice</strong>
                        <small>Create a new bill</small>
                      </span>
                    </button>
                    <button
                      onClick={() => openPayment()}
                    >
                      <i className="qa-green"><NavIcon name="Payments" /></i>
                      <span>
                        <strong>Receive Payment</strong>
                        <small>Cash, bank or cheque</small>
                      </span>
                    </button>
                    <button onClick={() => openModuleModal("purchase")}>
                      <i className="qa-orange"><NavIcon name="Purchases" /></i>
                      <span>
                        <strong>Add Purchase</strong>
                        <small>Stock or expense</small>
                      </span>
                    </button>
                    <button onClick={() => openModuleModal("expense")}>
                      <i className="qa-violet"><NavIcon name="Expenses" /></i>
                      <span>
                        <strong>Add Expense</strong>
                        <small>Record office expense</small>
                      </span>
                    </button>
                  </div>
                </article>

                <article className="recent card">
                  <div className="card-title">
                    <div>
                      <h3>Recent Transactions</h3>
                      <p>
                        FY {fiscalYear?.label_bs} entries · {calendar} dates
                      </p>
                    </div>
                    <button
                      className="link"
                      onClick={() => setActive("Reports")}
                    >
                      View day book →
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>TYPE</th>
                          <th>PARTY / ACCOUNT</th>
                          <th>DATE</th>
                          <th>DEBIT</th>
                          <th>CREDIT</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentTransactions.map((t, i) => (
                          <tr key={t.id} className="clickable-voucher" tabIndex={0} onClick={() => openVoucherDetail(t.id)} onKeyDown={(event) => event.key === "Enter" && openVoucherDetail(t.id)}>
                            <td>
                              <span className={`tx-icon t${i % 5}`}>
                                <NavIcon name={transactionIcon(t.type)} />
                              </span>
                              <div>
                                <strong>{t.type}</strong>
                                <small>{t.ref}</small>
                              </div>
                            </td>
                            <td>{t.party}</td>
                            <td>
                              {calendar === "BS"
                                ? bsDate(t.date)
                                : adDate(t.date)}
                            </td>
                            <td className="debit">
                              {t.debit ? money(t.debit) : "—"}
                            </td>
                            <td className="credit">
                              {t.credit ? money(t.credit) : "—"}
                            </td>
                            <td><span className="row-arrow">›</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mobile-transaction-list">
                    {recentTransactions.map((t, i) => (
                      <button key={t.id} onClick={() => openVoucherDetail(t.id)}>
                        <span className={`tx-icon t${i % 5}`}><NavIcon name={transactionIcon(t.type)} /></span>
                        <span className="mobile-transaction-main"><strong>{t.type}</strong><small>{t.party} · {calendar === "BS" ? bsDate(t.date) : adDate(t.date)}</small></span>
                        <span className={t.credit ? "credit" : "debit"}><strong>{money(t.credit || t.debit)}</strong><small>{t.ref}</small></span>
                        <span className="row-arrow">›</span>
                      </button>
                    ))}
                    {!recentTransactions.length && <div className="dashboard-empty">No transactions in this fiscal year.</div>}
                  </div>
                </article>

                <article className="balances card">
                  <div className="card-title">
                    <div>
                      <h3>Top Outstanding</h3>
                      <p>Parties with pending balance</p>
                    </div>
                    <button
                      className="link"
                      onClick={() => setActive("Parties")}
                    >
                      View all →
                    </button>
                  </div>
                  <div className="search">
                    <span>⌕</span>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search party"
                    />
                  </div>
                  <div className="party-list">
                    {topOutstanding.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => {
                          openPayment(p.name);
                        }}
                      >
                        <span className={`avatar ${p.tone}`}>{p.initials}</span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.place}</small>
                        </span>
                        <span className={p.balance < 0 ? "advance" : "due"}>
                          <strong>{money(p.balance)}</strong>
                          <small>
                            {p.balance < 0 ? "Advance" : "To receive"}
                          </small>
                        </span>
                      </button>
                    ))}
                    {!topOutstanding.length && <div className="dashboard-empty">No outstanding party balance.</div>}
                  </div>
                </article>
              </div>
            </>
          ) : active === "Sales" ? (
            <section className="module-page sales-module">
              <div className="module-hero">
                <div>
                  <span>SALES CONTROL</span>
                  <h2>Sales invoices</h2>
                  <p>
                    Review the last bill first, then create the next invoice.
                  </p>
                </div>
                <div className="hero-actions"><button className="primary soft" onClick={()=>exportModule("Sales")}>⇩ Excel / CSV</button><button className="primary soft" onClick={()=>printDocument("report")}>Print / PDF</button><button className="primary" onClick={openSale}>＋ Add sales invoice</button></div>
              </div>
              <div className="sales-stats">
                <article>
                  <small>TOTAL SALES · FY {fiscalYear?.label_bs}</small>
                  <strong>{money(totals.sales)}</strong>
                </article>
                <article>
                  <small>BILL NUMBERS USED</small>
                  <strong>{Math.max(0, Number(nextNumbers.sale) - 1) + Math.max(0, Number(nextNumbers.sale_non_vat) - 1)}</strong>
                </article>
                <article>
                  <small>LAST VAT / LEGACY BILL</small>
                  <strong>{Number(nextNumbers.sale) > 1 ? Number(nextNumbers.sale) - 1 : "No bill yet"}</strong>
                </article>
                <article>
                  <small>NEXT VAT · NEXT NON-VAT</small>
                  <strong>{nextInvoice} · NB {nextNumbers.sale_non_vat}</strong>
                </article>
              </div>
              <article className="card sales-list">
                <div className="card-title">
                  <div>
                    <h3>Sales bill register</h3>
                    <p>Latest invoice is shown first</p>
                  </div>
                  <button className="primary soft" onClick={openSale}>
                    ＋ New bill
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>INVOICE</th>
                        <th>DATE</th>
                        <th>PARTY</th>
                        <th>AMOUNT</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesTransactions.length ? (
                        salesTransactions.map((t) => (
                          <tr key={t.id} className="clickable-voucher" tabIndex={0} onClick={() => openVoucherDetail(t.id)} onKeyDown={(e) => e.key === "Enter" && openVoucherDetail(t.id)}>
                            <td>
                              <strong>{t.ref || t.sequence_no}</strong>
                            </td>
                            <td>
                              {calendar === "BS"
                                ? bsDate(t.date)
                                : adDate(t.date)}
                            </td>
                            <td>{t.document_status === "cancelled" ? "Cancelled bill" : t.party}</td>
                            <td className="debit">{money(t.document_status === "cancelled" ? 0 : t.debit)}</td>
                            <td>
                              <span className={t.document_status === "cancelled" ? "cancelled-chip" : "paid-chip"}>{t.document_status === "cancelled" ? "Cancelled" : "Posted"}</span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="empty-year">
                            No sales invoice in this fiscal year. The next
                            invoice will start at 1.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-register-list">
                  {salesTransactions.map((transaction) => (
                    <button key={transaction.id} onClick={() => openVoucherDetail(transaction.id)}>
                      <span><strong>Invoice #{transaction.ref || transaction.sequence_no}</strong><small>{transaction.document_status === "cancelled" ? "Cancelled bill" : transaction.party}</small></span>
                      <span className="mobile-register-amount"><strong>{money(transaction.document_status === "cancelled" ? 0 : transaction.debit)}</strong><small>{calendar === "BS" ? bsDate(transaction.date) : adDate(transaction.date)}</small></span>
                      <span className="mobile-register-meta"><span>{transaction.ref}</span><span className={transaction.document_status === "cancelled" ? "cancelled-chip" : "paid-chip"}>{transaction.document_status === "cancelled" ? "Cancelled" : "Posted"}</span></span>
                    </button>
                  ))}
                  {!salesTransactions.length && <div className="dashboard-empty">No sales invoice in this fiscal year. Next invoice starts at 1.</div>}
                </div>
              </article>
            </section>
          ) : active === "Quotations" ? (
            <DocumentsWorkspace key={fiscalYear?.id} fiscalYear={fiscalYear} parties={parties} products={products} />
          ) : active === "Accounting" ? (
            <AccountingOperationsWorkspace mode="accounting" parties={parties} products={products} moneyAccounts={moneyAccounts} members={members} fiscalYear={fiscalYear} onNotice={setNotice} onRefresh={() => { invalidateClientCache(); if (fiscalYear?.id) void changeFiscalYear(fiscalYear.id); }} />
          ) : active === "Manufacturing" ? (
            <AccountingOperationsWorkspace mode="manufacturing" parties={parties} products={products} moneyAccounts={moneyAccounts} members={members} fiscalYear={fiscalYear} onNotice={setNotice} onRefresh={() => { invalidateClientCache(); if (fiscalYear?.id) void changeFiscalYear(fiscalYear.id); }} />
          ) : active === "Cash & Bank" ? (
            <FundsWorkspace fiscalYear={fiscalYear} onNotice={setNotice} />
          ) : active === "Orders" ? (
            <OrdersWorkspace onNotice={setNotice} />
          ) : active === "Cheques" ? (
            <ChequeWorkspace onNotice={setNotice} />
          ) : active === "Reports" ? (
            <ReportsWorkspace
              parties={parties}
              fiscalYear={fiscalYear}
              initialPartyId={reportPartyId}
              onNotice={setNotice}
              onOpenVoucher={openVoucherDetail}
              onEditParty={["admin","manager","accountant"].includes(currentMember?.role || "") ? setEditingPartyId : undefined}
              refreshVersion={reportVersion}
              canManageOpenings={["admin","manager","accountant"].includes(currentMember?.role || "")}
              onBalancesChanged={() => {
                clearReportCache();
                try { for (let i=sessionStorage.length-1;i>=0;i--) { const key=sessionStorage.key(i); if(key?.startsWith("hae-snapshot-"))sessionStorage.removeItem(key); } } catch {}
                void changeFiscalYear(fiscalYear.id).catch(()=>setNotice("Opening balance saved, but dashboard balances could not refresh. Reload the page; do not enter the opening again."));
              }}
            />
          ) : (
            <section className="module-page">
              <div className="module-hero">
                <div>
                  <span>{active.toUpperCase()} MODULE</span>
                  <h2>{active}</h2>
                  <p>
                    {active === "Purchases"
                      ? "Purchase bills automatically increase inventory."
                      : active === "Inventory"
                        ? "Raw materials and packaging available for production."
                        : active === "Stock"
                          ? "Ready-to-sell finished and resale goods."
                        : active === "Parties"
                          ? "Customers, suppliers and their balances."
                          : active === "Payments"
                            ? "Record and review party receipts."
                            : "Record office and operating expenses."}
                  </p>
                </div>
                <div className="hero-actions module-export"><button className="primary soft" onClick={()=>exportModule(active)}>⇩ Excel / CSV</button><button className="primary soft" onClick={()=>printDocument("report")}>Print / PDF</button></div>
                {active === "Purchases" && (
                  <button
                    className="primary"
                    onClick={() => openModuleModal("purchase")}
                  >
                    ＋ Add purchase bill
                  </button>
                )}
                {active === "Inventory" && (
                  <div className="hero-actions"><button className="primary soft" onClick={() => {setProductType("raw_material");openModuleModal("product")}}>＋ Add material / packaging</button>{entitlements.manufacturing !== false && <button className="primary" onClick={openProduction}>⚙ Convert / produce stock</button>}</div>
                )}
                {active === "Stock" && (
                  <div className="hero-actions"><button className="primary soft" onClick={() => {setProductType("finished_good");openModuleModal("product")}}>＋ Add sellable item</button>{entitlements.manufacturing !== false && <button className="primary" onClick={openProduction}>⚙ Produce finished goods</button>}</div>
                )}
                {active === "Parties" && (
                  <div className="hero-actions">
                    {entitlements.customer_portal !== false && <button className="primary soft" onClick={() => document.getElementById("client-access")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Client portal access</button>}
                    <button className="primary" onClick={() => openModuleModal("party")}>＋ Add party</button>
                  </div>
                )}
                {active === "Payments" && (
                  <button
                    className="primary"
                    onClick={() => openPayment()}
                  >
                    ＋ Receive payment
                  </button>
                )}
                {active === "Expenses" && (
                  <button
                    className="primary"
                    onClick={() => openModuleModal("expense")}
                  >
                    ＋ Add expense
                  </button>
                )}
              </div>
              <article className="card sales-list">
                <div className="card-title">
                  <div>
                    <h3>{active} register</h3>
                    <p>Live Supabase records</p>
                  </div>
                </div>
                <div className="table-wrap">
                  {active === "Inventory" || active === "Stock" ? (
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>PRODUCT</th>
                          <th>TYPE</th>
                          <th>UNIT</th>
                          <th>PURCHASE</th>
                          <th>SALE</th>
                          <th>MRP</th>
                          <th>STOCK</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {registerProducts.map((p) => (
                          <tr key={p.id}>
                            <td>{p.sku || "—"}</td>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td><span className={`item-type ${p.item_type}`}>{({raw_material:"Raw material",packaging:"Packaging",finished_good:"Finished product",resale_good:"Resale product"} as any)[p.item_type] || "Finished product"}</span></td>
                            <td>{p.unit}</td>
                            <td>{money(Number(p.purchase_price))}</td>
                            <td>{money(Number(p.sale_price))}</td>
                            <td>{money(Number(p.mrp))}</td>
                            <td>
                              <strong>{p.stock_qty}</strong>
                            </td>
                            <td><button className="table-action" onClick={() => editProduct(p)}>Edit</button></td>
                          </tr>
                        ))}
                        {!registerProducts.length && <tr><td colSpan={9} className="empty-year">{active === "Inventory" ? "No raw material or packaging yet. Add directly or receive through a purchase bill." : "No sellable stock yet. Purchase a resale item or produce finished goods."}</td></tr>}
                      </tbody>
                    </table>
                  ) : active === "Parties" ? (
                    <table>
                      <thead>
                        <tr>
                          <th>PARTY</th>
                          <th>PLACE</th>
                          <th>PHONE</th>
                          <th>PAN</th>
                          <th>OPENING</th>
                          <th>BALANCE</th>
                          {["admin","manager","accountant"].includes(currentMember?.role || "") && <th>DETAILS</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {parties.map((p) => (
                          <tr
                            key={p.id}
                            className="clickable-party"
                            tabIndex={0}
                            onClick={() => {
                              setReportPartyId(p.id);
                              setActive("Reports");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && e.target === e.currentTarget) {
                                setReportPartyId(p.id);
                                setActive("Reports");
                              }
                            }}
                          >
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.place || "—"}</td>
                            <td>{p.phone || "—"}</td>
                            <td>{p.tax_no || "—"}</td>
                            <td>{money(Number(p.opening_balance))}</td>
                            <td>{money(Number(p.balance))}</td>
                            {["admin","manager","accountant"].includes(currentMember?.role || "") && <td><button className="table-action" onClick={event=>{event.stopPropagation();setEditingPartyId(p.id);}}>Edit details</button></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>REFERENCE</th>
                          <th>DATE</th>
                          <th>PARTY / ACCOUNT</th>
                          <th>AMOUNT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registerTransactions.map((t) => (
                            <tr key={t.id} className="clickable-voucher" tabIndex={0} onClick={() => openVoucherDetail(t.id)} onKeyDown={(e) => e.key === "Enter" && openVoucherDetail(t.id)}>
                              <td>
                                <strong>{t.ref}</strong>
                              </td>
                              <td>
                                {calendar === "BS"
                                  ? bsDate(t.date)
                                  : adDate(t.date)}
                              </td>
                              <td>{t.party}</td>
                              <td>{money(t.debit || t.credit)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="mobile-register-list">
                  {active === "Inventory" || active === "Stock" ? (
                    <>
                      {registerProducts.map((product) => (
                        <div className="mobile-register-card" key={product.id}>
                          <span><strong>{product.name}</strong><small>{product.sku || "No SKU"} · {({raw_material:"Raw material",packaging:"Packaging",finished_good:"Finished product",resale_good:"Resale product"} as any)[product.item_type] || "Finished product"}</small></span>
                          <span className="mobile-register-amount"><strong>{product.stock_qty} {product.unit}</strong><small>In stock</small></span>
                          <span className="mobile-register-meta"><span>Sale {money(Number(product.sale_price))}</span><button className="mobile-register-edit" onClick={() => editProduct(product)}>Edit</button></span>
                        </div>
                      ))}
                      {!registerProducts.length && <div className="dashboard-empty">{active === "Inventory" ? "No raw material or packaging yet." : "No sellable stock yet."}</div>}
                    </>
                  ) : active === "Parties" ? (
                    <>
                      {parties.map((party) => (
                        <div className="mobile-register-card" key={party.id}>
                          <span><button className="party-ledger-action" onClick={() => { setReportPartyId(party.id); setActive("Reports"); }}><strong>{party.name}</strong></button><small>{[party.place, party.phone].filter(Boolean).join(" · ") || "No contact details"}</small></span>
                          <span className="mobile-register-amount"><strong>{money(Number(party.balance))}</strong><small>{Number(party.balance) < 0 ? "Advance" : "To receive"}</small></span>
                          <span className="mobile-register-meta"><span>{party.tax_no ? `PAN ${party.tax_no}` : "PAN not added"}</span><button className="mobile-register-edit" onClick={() => {setReportPartyId(party.id);setActive("Reports");}}>View ledger ›</button>{["admin","manager","accountant"].includes(currentMember?.role || "")&&<button className="mobile-register-edit" onClick={()=>setEditingPartyId(party.id)}>Edit details</button>}</span>
                        </div>
                      ))}
                      {!parties.length && <div className="dashboard-empty">No parties added yet.</div>}
                    </>
                  ) : (
                    <>
                      {registerTransactions.map((transaction) => (
                        <button key={transaction.id} onClick={() => openVoucherDetail(transaction.id)}>
                          <span><strong>{transaction.ref}</strong><small>{transaction.party}</small></span>
                          <span className="mobile-register-amount"><strong>{money(transaction.debit || transaction.credit)}</strong><small>{calendar === "BS" ? bsDate(transaction.date) : adDate(transaction.date)}</small></span>
                          <span className="mobile-register-meta"><span>{transaction.type}</span><span>View details ›</span></span>
                        </button>
                      ))}
                      {!registerTransactions.length && <div className="dashboard-empty">No {active.toLowerCase()} record in this fiscal year.</div>}
                    </>
                  )}
                </div>
              </article>
              {active === "Parties" && <ClientAccessPanel onNotice={setNotice} />}
            </section>
          )}
        </div>
      </section>

      {editingPartyId && <PartyDetailsEditor key={editingPartyId} partyId={editingPartyId} onClose={()=>setEditingPartyId("")} onSaved={edited=>{
        setEditingPartyId("");
        setParties(current=>current.map(p=>p.id===edited.id?{...p,...edited,initials:edited.name.split(" ").map((s:string)=>s[0]).slice(0,2).join("")}:p));
        clearReportCache();
        try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith("hae-snapshot-"))sessionStorage.removeItem(key);}}catch{}
        setReportVersion(v=>v+1);
        setNotice("Party details updated. Bills and ledger amounts are unchanged.");
        void changeFiscalYear(fiscalYear.id).catch(()=>setNotice("Party details are saved, but the dashboard could not refresh. Reload to see the latest details."));
      }}/>}
      {voucherDetail && (
        <div className="modal-backdrop" onMouseDown={closeVoucherDetail}>
          <section className="modal voucher-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <small>{voucherDetail.voucher_type === "sale" ? "SALES INVOICE" : voucherDetail.voucher_type === "receipt" ? "PAYMENT RECEIPT" : "VOUCHER"} · FY {voucherDetail.fiscal_years?.label_bs || fiscalYear?.label_bs}</small>
                <h2>{detailLoading ? "Loading details…" : `${voucherDetail.voucher_type === "sale" ? "Invoice" : voucherDetail.voucher_type === "receipt" ? "Receipt" : "Voucher"} #${voucherDetail.voucher_no || voucherDetail.sequence_no}`}</h2>
              </div>
              <button aria-label="Close voucher details" onClick={closeVoucherDetail}>×</button>
            </div>
            {!detailLoading && (
              <div className="voucher-document" ref={voucherDocument}>
                <div className="voucher-company">
                  {company.logo_url && <img src={company.logo_url} alt="" />}
                  <div><strong>{company.name}</strong><span>Official accounting record</span></div>
                  <div className="voucher-status"><span>{voucherDetail.document_status === "cancelled" ? "CANCELLED · NO ACCOUNTING EFFECT" : "POSTED"}</span><small>{voucherDetail.voucher_date ? bsDate(voucherDetail.voucher_date) : ""}</small></div>
                </div>
                <div className="voucher-meta">
                  <div><small>PARTY / CUSTOMER</small><strong>{voucherDetail.parties?.name || "Cash / General"}</strong><span>{[voucherDetail.parties?.place, voucherDetail.parties?.phone, voucherDetail.parties?.tax_no ? `PAN ${voucherDetail.parties.tax_no}` : ""].filter(Boolean).join(" · ") || "No additional details"}</span></div>
                  <div><small>DATE</small><strong>{calendar === "BS" ? bsDate(voucherDetail.voucher_date) : adDate(voucherDetail.voucher_date)}</strong><span>AD {adDate(voucherDetail.voucher_date)}</span></div>
                  {voucherDetail.due_date&&<div><small>DUE DATE</small><strong>{calendar === "BS" ? bsDate(voucherDetail.due_date) : adDate(voucherDetail.due_date)}</strong><span>AD {adDate(voucherDetail.due_date)}</span></div>}
                  <div><small>{voucherDetail.voucher_type === "receipt" ? "RECEIPT NO." : "INVOICE NO."}</small><strong>{voucherDetail.voucher_no || voucherDetail.sequence_no}</strong><span>FY {voucherDetail.fiscal_years?.label_bs}</span></div>
                </div>
                <div className="voucher-audit"><span><small>GENERATED BY</small><strong>{voucherDetail.generator?.name || "Office"}</strong></span>{voucherDetail.handler?.name&&<span><small>COLLECTED / HANDLED BY</small><strong>{voucherDetail.handler.name}</strong></span>}{voucherDetail.money_account?.name&&<span><small>CASH / BANK ACCOUNT</small><strong>{voucherDetail.money_account.name}</strong></span>}</div>
                {voucherDetail.lines?.length > 0 && <div className="voucher-lines"><table><thead><tr><th>#</th><th>PRODUCT / DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>{voucherDetail.lines.map((line:any,index:number)=><tr key={line.id}><td>{index+1}</td><td><strong>{line.description || line.products?.name}</strong><small>{[line.products?.sku,line.products?.unit].filter(Boolean).join(" · ")}</small></td><td>{Number(line.quantity).toLocaleString()}</td><td>{money(Number(line.rate))}</td><td><strong>{money(Number(line.amount))}</strong></td></tr>)}</tbody></table></div>}
                {voucherDetail.voucher_type === "receipt" && <div className="receipt-panel"><div><small>AMOUNT RECEIVED</small><strong>{money(Number(voucherDetail.total))}</strong></div><div><small>PAYMENT MODE</small><strong>{voucherDetail.payment_mode || "Cash"}</strong></div>{voucherDetail.payment_mode === "Cheque" && <><div><small>CHEQUE / BANK</small><strong>{voucherDetail.cheque_no || "—"} · {voucherDetail.cheque_bank || "—"}</strong></div><div><small>CLEARANCE DATE</small><strong>{voucherDetail.cheque_exchange_date ? adDate(voucherDetail.cheque_exchange_date) : "—"}</strong><span className={`cheque-status ${voucherDetail.cheque_status}`}>{voucherDetail.cheque_status}</span></div></>}</div>}
                <div className="voucher-settlement">
                {voucherDetail.voucher_type === "sale" && <div className="voucher-totals"><div><span>Subtotal</span><strong>{money(Number(voucherDetail.subtotal))}</strong></div><div><span>Discount ({Number(voucherDetail.discount_percent)}%)</span><strong>− {money(Number(voucherDetail.discount_amount))}</strong></div><div><span>VAT / Tax ({Number(voucherDetail.tax_percent)}%)</span><strong>＋ {money(Number(voucherDetail.tax_amount))}</strong></div><div className="grand"><span>Grand total</span><strong>{money(Number(voucherDetail.total))}</strong></div></div>}
                <div className="amount-in-words"><small>AMOUNT IN WORDS</small><strong>{amountInWords(Number(voucherDetail.total))}</strong></div>
                </div>
                {voucherDetail.narration && <div className="voucher-note"><small>NARRATION</small><p>{voucherDetail.narration}</p></div>}
              </div>
            )}
            <div className="modal-actions"><button onClick={closeVoucherDetail}>Close</button>{["sale","receipt"].includes(voucherDetail.voucher_type)&&voucherDetail.document_status!=="cancelled"&&<button className="edit-voucher" disabled={detailLoading} onClick={editVoucher}>✎ Edit record</button>}<button className="primary" disabled={detailLoading} onClick={() => { if (voucherDocument.current) setVoucherPrint(voucherPrintHtml(voucherDocument.current.innerHTML, `${voucherDetail.voucher_type === "sale" ? "Sales Invoice" : voucherDetail.voucher_type === "receipt" ? "Payment Receipt" : "Voucher"} #${voucherDetail.voucher_no || voucherDetail.sequence_no}`)); }}>Print / PDF</button></div>
          </section>
        </div>
      )}

      {voucherPrint && <VoucherPrintPreview html={voucherPrint} close={() => setVoucherPrint(null)} />}
      {modal === "production" && (
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
          <section className="modal production-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><small>MANUFACTURING · FY {fiscalYear?.label_bs}</small><h2>Produce finished goods</h2></div><button onClick={() => setModal(null)}>×</button></div>
            <div className="form-grid production-form">
              <div className="production-flow full"><span>RAW MATERIALS</span><b>− consume →</b><span>FINISHED STOCK</span></div>
              <label>Production date (BS)<BsDateInput min={fiscalYear?.start_ad} max={fiscalYear?.end_ad} value={transactionDate} onChange={setTransactionDate}/></label>
              <label>Finished product<select value={outputProductId} onChange={(e) => setOutputProductId(e.target.value)}><option value="">Select output product</option>{products.filter((p) => ["finished_good","resale_good"].includes(p.item_type)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock_qty} {p.unit}</option>)}</select></label>
              <label>Quantity produced<input type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(e) => setOutputQuantity(e.target.value)} placeholder="e.g. 200" /></label>
              <div className="production-materials full"><div className="production-material-head"><strong>Materials consumed</strong><small>Stock is checked before saving</small></div>{productionInputs.map((row,index)=><div className="production-material-row" key={index}><select aria-label={`Material ${index+1}`} value={row.productId} onChange={(e)=>setProductionInputs((rows)=>rows.map((x,i)=>i===index?{...x,productId:e.target.value}:x))}><option value="">Select raw material / packaging</option>{products.filter((p)=>["raw_material","packaging"].includes(p.item_type)).map((p)=><option key={p.id} value={p.id}>{p.name} · Available {p.stock_qty} {p.unit}</option>)}</select><input aria-label={`Consumed quantity ${index+1}`} type="number" min="0.001" step="0.001" value={row.quantity || ""} onChange={(e)=>setProductionInputs((rows)=>rows.map((x,i)=>i===index?{...x,quantity:Number(e.target.value)}:x))} placeholder="Quantity used"/><button disabled={productionInputs.length===1} onClick={()=>setProductionInputs((rows)=>rows.filter((_,i)=>i!==index))}>×</button></div>)}<button className="add-line" onClick={()=>setProductionInputs((rows)=>[...rows,{productId:"",quantity:0}])}>＋ Add another material</button></div>
              <label className="full">Batch notes<input value={particulars} onChange={(e)=>setParticulars(e.target.value)} placeholder="Formula, operator or production notes" /></label>
            </div>
            <div className="modal-actions"><button onClick={()=>setModal(null)}>Cancel</button><button className="primary" disabled={saving} onClick={()=>save("Production")}>{saving?"Producing…":"Save production batch"}</button></div>
          </section>
        </div>
      )}

      {modal && !["party", "product", "production"].includes(modal) && (
        <div className="modal-backdrop" onMouseDown={() => { if (!saveLock.current) setModal(null); }}>
          <section
            className={`modal ${modal === "sale" || modal === "purchase" ? "invoice-modal" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <small>
                  {modal === "sale"
                    ? "SALES"
                    : modal === "purchase"
                      ? "PURCHASE"
                      : modal === "expense"
                        ? "EXPENSE"
                        : "RECEIPT"}{" "}
                  · FY {fiscalYear?.label_bs}
                </small>
                <h2>
                  {modal === "sale"
                    ? editingVoucherId ? "Edit sales invoice" : "Create sales invoice"
                    : modal === "purchase"
                      ? "Create purchase bill"
                      : modal === "expense"
                        ? "Add expense"
                        : editingVoucherId ? "Edit payment receipt" : "Receive payment"}
                </h2>
              </div>
              <button aria-label="Close invoice or receipt" disabled={saving} onClick={() => setModal(null)}>×</button>
            </div>
            <div className="form-grid" ref={invoiceScroll}>
              {modal === "sale" && !editingVoucherId && sessionExpired && <div className="invoice-draft-alert full" role="alert"><strong>Sign-in expired; this invoice has not been saved.</strong><span>{draftStored ? "Your entries are preserved as a draft in this browser." : "Browser draft storage is unavailable. Keep this tab open and copy the invoice details before signing in."}</span>{draftStored ? <a href={`/login?company=${encodeURIComponent(company?.slug || "")}&next=${encodeURIComponent("/?resumeInvoice=1")}`}>Sign in again and resume</a> : <a target="_blank" rel="noopener noreferrer" href={`/login?company=${encodeURIComponent(company?.slug || "")}`}>Sign in in a new tab</a>}</div>}
              {modal === "sale" && !editingVoucherId && draftRestored && !sessionExpired && <div className="invoice-draft-alert full" role="status"><span>Unfinished invoice restored from this browser. Check it before saving.</span><button type="button" onClick={discardSaleDraft}>Discard draft</button></div>}
              {modal === "sale" && !editingVoucherId && lastSavedSale !== null && <div className="snapshot-sync full" role="status"><span>Invoice{lastSavedSale ? ` #${lastSavedSale}` : ""} saved. {snapshotSync === "loading" ? "Enter the next bill while stock and numbering update…" : snapshotSync === "failed" ? "Refresh failed. Your saved bill is safe; retry the refresh before saving the next one." : "Ready for the next invoice."}</span>{snapshotSync === "failed" && <button onClick={() => { const pending = pendingRefresh.current; if (pending) void refreshSavedAccounting(pending.fiscalYearId, pending.label); }}>Retry refresh</button>}</div>}
              {modal === "sale" && ["admin", "manager", "accountant"].includes(currentMember?.role || "") && <label className="cancelled-sale-toggle full"><input type="checkbox" checked={cancelledSale} onChange={event => setCancelledSale(event.target.checked)} /><span><strong>Cancelled bill / reserve this invoice number</strong><small>{editingVoucherId ? "Mark this posted bill as cancelled. Its original details will be kept in the audit log; party balance, sales and stock will be reversed." : "Use this when a bill number was cancelled. It remains in the register as Rs. 0 and the next invoice gets the next number."}</small></span></label>}
              {modal !== "expense" && !(modal === "sale" && cancelledSale) && (
                <>
                  {(modal === "sale" || modal === "purchase") && (
                    <div className="invoice-section-title full"><span>01</span><div><strong>{modal === "sale" ? "Customer details" : "Supplier details"}</strong><small>Select an existing party or create one instantly.</small></div></div>
                  )}
                  <div className="party-field full">
                    <label htmlFor="invoice-party-search">{modal === "purchase" ? "Supplier / Party" : "Party / Customer"}</label>
                    <div className="party-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPartyPickerOpen(false); }}>
                      <input
                        id="invoice-party-search"
                        ref={modal === "sale" ? salesPartyInput : undefined}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={partyPickerOpen}
                        aria-controls="invoice-party-options"
                        aria-activedescendant={partyPickerOpen && partyActiveIndex >= 0 ? `invoice-party-option-${partyActiveIndex}` : undefined}
                        autoComplete="off"
                        value={partySearch}
                        placeholder={formParty === "__new__" ? "Creating a new party below" : "Type party name to search"}
                        onFocus={() => { setPartyPickerOpen(true); setPartyActiveIndex(-1); }}
                        onChange={event => { setPartySearch(event.target.value); setFormParty(""); setNewPartyName(""); setPartyActiveIndex(-1); setPartyPickerOpen(true); }}
                        onKeyDown={event => {
                          if (event.key === "ArrowDown") { event.preventDefault(); setPartyPickerOpen(true); setPartyActiveIndex(index => Math.min(index + 1, partyMatches.length)); }
                          if (event.key === "ArrowUp") { event.preventDefault(); setPartyActiveIndex(index => Math.max(index - 1, -1)); }
                          if (event.key === "Escape") { event.preventDefault(); setPartyPickerOpen(false); }
                          if (event.key === "Enter" && partyPickerOpen) {
                            const option = partyActiveIndex >= 0 ? partyActiveIndex : partyMatches.length === 1 && partySearch.trim() ? 0 : -1;
                            if (option >= 0) { event.preventDefault(); if (option < partyMatches.length) chooseExistingParty(partyMatches[option].name); else chooseNewParty(); }
                          }
                        }}
                      />
                      {partyPickerOpen && <div id="invoice-party-options" className="party-options" role="listbox" aria-label="Matching parties">
                        {partyMatches.map((party, index) => <button
                          key={party.id || party.name}
                          id={`invoice-party-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={formParty === party.name}
                          className={partyActiveIndex === index ? "active" : ""}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => chooseExistingParty(party.name)}
                        ><strong>{party.name}</strong>{party.place && <small>{party.place}</small>}</button>)}
                        {!partyMatches.length && <p>No existing party matches “{partySearch}”.</p>}
                        <button id={`invoice-party-option-${partyMatches.length}`} type="button" role="option" aria-selected={formParty === "__new__"} className={`new-party-option ${partyActiveIndex === partyMatches.length ? "active" : ""}`} onMouseDown={event => event.preventDefault()} onClick={chooseNewParty}>＋ Add new party instantly</button>
                      </div>}
                    </div>
                    {formParty === "__new__" && <small>New party selected. Enter its details below.</small>}
                  </div>
                  {formParty === "__new__" && (
                    <div className="inline-party full">
                      <div className="inline-party-title"><strong>New party details</strong><span>Name is required; other details are optional.</span></div>
                      <label>Party / company name<input ref={inlineNewPartyInput} autoFocus value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} placeholder="Required" /></label>
                      <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" /></label>
                      <label>Address<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Optional" /></label>
                      <label>PAN Number<input value={taxNo} onChange={(e) => setTaxNo(e.target.value)} placeholder="Optional" /></label>
                    </div>
                  )}
                </>
              )}
              <label>
                Transaction date (BS)
                <BsDateInput min={fiscalYear?.start_ad} max={fiscalYear?.end_ad} value={transactionDate} onChange={setTransactionDate}/>
              </label>
              <label>
                {modal === "sale"
                  ? billCategory === "non_vat" ? "Non-VAT invoice number" : "Invoice number"
                  : modal === "payment"
                    ? "Receipt number"
                    : modal === "purchase"
                      ? "Purchase number"
                      : "Expense number"}
                <input
                  readOnly
                  value={String(
                    modal === "sale"
                      ? editingVoucherId ? editingVoucherNumber : salesNumberPreview(nextNumbers, billCategory)
                      : modal === "payment"
                        ? nextNumbers.receipt
                        : modal === "purchase"
                          ? nextNumbers.purchase
                          : nextNumbers.expense,
                  )}
                />
                {modal === "sale" && !editingVoucherId && <small>{snapshotSync === "loading" ? "Checking latest number…" : billCategory === "non_vat" ? "Independent NB series · starts at NB 1 each FY; does not use a VAT number" : "VAT / standard series · final number assigned when saved"}</small>}
              </label>
              <label>
                Generated by
                <input readOnly value={currentMember?.name || "Signed-in employee"} />
              </label>
              {(modal === "purchase" || (modal === "sale" && !cancelledSale)) && (
                <div className="invoice-section-title full"><span>02</span><div><strong>Items & pricing</strong><small>Add products, quantity and rate. Scroll normally for totals.</small></div></div>
              )}
              {(modal === "purchase" || (modal === "sale" && !cancelledSale)) && <label>Due date / payment term (BS)<BsDateInput value={dueDate} onChange={setDueDate}/></label>}
              {(modal === "purchase" || modal === "sale") && <label>Bill type / number series<select value={billCategory} disabled={modal === "sale" && Boolean(editingVoucherId)} onChange={event => { setBillCategory(event.target.value); setTaxPercent(event.target.value === "vat" ? 13 : 0); }}><option value="vat">{modal === "sale" ? "VAT bill · 1, 2, 3…" : "VAT bill"}</option>{modal === "purchase" && <option value="pan">PAN bill (no VAT)</option>}<option value="non_vat">{modal === "sale" ? "Non-VAT bill · NB 1, NB 2…" : "No VAT / no PAN bill"}</option></select>{modal === "sale" && editingVoucherId && <small>Issued bill type and number are preserved. Cancel and create a new bill to use another series.</small>}</label>}
              {modal === "purchase" && <label>Supplier's bill number<input value={supplierBillNo} onChange={event=>setSupplierBillNo(event.target.value)} placeholder="Number printed on supplier bill"/></label>}
              {modal === "sale" && cancelledSale ? <div className="cancelled-sale-explanation full"><strong>This invoice number will be cancelled.</strong><p>No customer charge, VAT, stock movement or ledger balance will be posted. The number remains visible in the sales register.</p><label>Reason / note (optional)<input value={cancellationReason} onChange={event => setCancellationReason(event.target.value)} placeholder="e.g. Bill prepared by mistake" /></label></div> : modal === "sale" || modal === "purchase" ? (
                <div className="invoice-builder full">
                  <div className="line-head">
                    <span>PRODUCT / DESCRIPTION</span>
                    <span>QTY</span>
                    <span>RATE</span>
                    <span>AMOUNT</span>
                    <span></span>
                  </div>
                  {saleLines.map((line, index) => (
                    <div className="invoice-line" key={index}>
                      <div>
                        <span className="invoice-item-number">Item {index + 1}</span>
                        <select
                          aria-label={`Product ${index + 1}`}
                          value={line.productId}
                          onChange={(e) => chooseProduct(index, e.target.value)}
                        >
                          <option value="">Custom / non-inventory item</option>
                          {products.filter((p)=>modal === "sale" ? ["finished_good","resale_good"].includes(p.item_type) : true).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · Stock {p.stock_qty}
                            </option>
                          ))}
                        </select>
                        {!line.productId && (
                          <><input ref={element => { lineNameInputs.current[index] = element; }} aria-label={`Item name ${index + 1}`} value={line.name} onChange={(e) => updateSaleLine(index, { name: e.target.value })} placeholder="Type item name" />{modal === "purchase" && <div className="purchase-item-meta"><input list="product-unit-options" aria-label={`Unit ${index + 1}`} value={line.unit} onChange={(e) => updateSaleLine(index,{unit:e.target.value})} placeholder="Type unit"/><select aria-label={`Stock type ${index + 1}`} value={line.itemType} onChange={(e) => updateSaleLine(index,{itemType:e.target.value})}><option value="raw_material">Raw material</option><option value="packaging">Packaging</option><option value="finished_good">Finished product</option><option value="resale_good">Resale product</option></select></div>}</>
                        )}
                      </div>
                      <input
                        aria-label={`Quantity ${index + 1}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        onWheel={wheelNumberInput}
                        value={line.quantity}
                        placeholder="Qty"
                        onFocus={event => event.currentTarget.select()}
                        onChange={(e) =>
                          updateSaleLine(index, {
                            quantity: invoiceDraftNumber(e.target.value),
                          })
                        }
                      />
                      <input
                        aria-label={`Rate ${index + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        onWheel={wheelNumberInput}
                        value={line.rate}
                        placeholder="Rate"
                        onFocus={event => event.currentTarget.select()}
                        onChange={(e) =>
                          updateSaleLine(index, {
                            rate: invoiceDraftNumber(e.target.value),
                          })
                        }
                      />
                      <strong>{money(Number(line.quantity) * Number(line.rate))}</strong>
                      <button
                        aria-label={`Remove item ${index + 1}`}
                        disabled={saleLines.length === 1}
                        onClick={() =>
                          setSaleLines((lines) =>
                            lines.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="add-line"
                    onClick={addSaleLine}
                  >
                    ＋ Add another product
                  </button>
                  <label className="invoice-note">
                    Narration / note
                    <input
                      value={particulars}
                      onChange={(e) => setParticulars(e.target.value)}
                      placeholder="Optional invoice note"
                    />
                  </label>
                  <div className="invoice-summary">
                    <div>
                      <span>Subtotal</span>
                      <strong>{money(saleSubtotal)}</strong>
                    </div>
                    <div>
                      <label>
                        Discount %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          onWheel={wheelNumberInput}
                          value={discountPercent}
                          onChange={(e) =>
                            setDiscountPercent(Number(e.target.value))
                          }
                        />
                      </label>
                      <strong>− {money(saleDiscount)}</strong>
                    </div>
                    <div>
                      <label>
                        VAT / Tax %
                        <input
                          type="number"
                          min="0"
                          onWheel={wheelNumberInput}
                          value={taxPercent}
                          disabled={billCategory !== "vat"}
                          onChange={(e) =>
                            setTaxPercent(Number(e.target.value))
                          }
                        />
                      </label>
                      <strong>＋ {money(saleTax)}</strong>
                    </div>
                    <div className="grand">
                      <span>Grand total</span>
                      <strong>
                        {money(saleGrand)}
                      </strong>
                    </div>
                  </div>
                  <div className="amount-in-words"><small>AMOUNT IN WORDS</small><strong>{amountInWords(saleGrand)}</strong></div>
                </div>
              ) : (
                <>
                  <label className="full">
                    Reference / Note
                    <input
                      value={particulars}
                      onChange={(e) => setParticulars(e.target.value)}
                      placeholder="Cheque no., bank ref. or note"
                    />
                  </label>
                  <label>
                    Amount (Rs.)
                    <input
                      type="number"
                      onWheel={wheelNumberInput}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  {modal === "payment" && (
                    <label>
                      Payment mode
                      <select
                        value={paymentMode}
                        onChange={(e) => {const mode=e.target.value;setPaymentMode(mode);const eligible=moneyAccounts.filter((account)=>mode==="Cash"?["employee_wallet","office_cash"].includes(account.account_type):account.account_type==="bank");setMoneyAccountId(mode==="Cheque"?"":eligible[0]?.id||"");if(mode==="Cheque"&&!chequeExchangeDate)setChequeExchangeDate(transactionDate)}}
                      >
                        <option>Cash</option>
                        <option>Bank transfer</option>
                        <option>QR</option>
                        <option>Cheque</option>
                      </select>
                    </label>
                  )}
                  {modal === "payment" && <><label>Collected / handled by<select value={handledBy} onChange={(e)=>{const memberId=e.target.value;setHandledBy(memberId);if(paymentMode==="Cash")setMoneyAccountId(moneyAccounts.find((account)=>account.account_type==="employee_wallet"&&account.team_member_id===memberId)?.id||moneyAccounts.find((account)=>account.account_type==="office_cash")?.id||"")}}>{members.map((member)=><option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>{paymentMode!=="Cheque"?<label>Received into<select value={moneyAccountId} onChange={(e)=>setMoneyAccountId(e.target.value)}><option value="">Select account</option>{moneyAccounts.filter((account)=>paymentMode==="Cash"?["employee_wallet","office_cash"].includes(account.account_type):account.account_type==="bank").map((account)=><option key={account.id} value={account.id}>{account.name} · {money(Number(account.balance))}</option>)}</select></label>:<div className="cheque-holding-note"><strong>Cheque received</strong><span>No cash or bank balance changes until this cheque is cleared from the Cheque Register.</span></div>}</>}
                  {modal === "expense" && <><label>Paid from<select value={moneyAccountId} onChange={(e)=>setMoneyAccountId(e.target.value)}><option value="">Select cash / bank</option>{moneyAccounts.map((account)=><option key={account.id} value={account.id}>{account.name} · {money(Number(account.balance))}</option>)}</select></label><label>Payment mode<select value={paymentMode} onChange={(e)=>setPaymentMode(e.target.value)}><option>Cash</option><option>Bank transfer</option><option>QR</option><option>Cheque</option></select></label></>}
                  {modal === "payment" && paymentMode === "Cheque" && (
                    <div className="cheque-fields full">
                      <div><strong>Cheque details</strong><span>This receipt stays pending until marked cleared.</span></div>
                      <label>Cheque number *<input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} placeholder="Enter cheque number" /></label>
                      <label>Bank name *<input list="cheque-bank-options" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} placeholder="Select or type a new bank" /><datalist id="cheque-bank-options">{chequeBanks.map((bank:any)=><option key={bank.id} value={bank.name} />)}</datalist></label>
                      <label>Exchange / clearance date (BS) *<BsDateInput value={chequeExchangeDate || transactionDate} onChange={setChequeExchangeDate}/></label>
                    </div>
                  )}
                </>
              )}
            </div>
            {!(modal === "sale" && cancelledSale) && <div className="balance-note">
              <span>Current balance</span>
              <strong>
                {money(parties.find((p) => p.name === formParty)?.balance || 0)}{" "}
                Dr.
              </strong>
            </div>}
            <div className="modal-actions">
              {(modal === "purchase" || (modal === "sale" && !cancelledSale)) && (
                <button className="review-total" onClick={reviewInvoiceTotal}>
                  <span>Review total ↓</span>
                  <strong>
                    {money(saleGrand)}
                  </strong>
                </button>
              )}
              <button disabled={saving} onClick={() => {setModal(null);setEditingVoucherId("")}}>{modal === "sale" && !editingVoucherId ? "Back / Close" : "Cancel"}</button>
              <button
                className="primary"
                disabled={saving || snapshotSync !== "idle"}
                onClick={() =>
                  save(
                    modal === "sale"
                      ? "Invoice"
                      : modal === "purchase"
                        ? "Purchase"
                        : modal === "expense"
                          ? "Expense"
                          : "Receipt",
                  )
                }
              >
                {saving
                  ? "Saving…"
                  : modal === "sale"
                    ? cancelledSale ? editingVoucherId ? "Confirm cancellation" : "Reserve cancelled bill" : editingVoucherId ? "Update invoice" : snapshotSync === "loading" ? "Updating stock & number…" : "Save & next invoice"
                    : modal === "purchase"
                      ? "Save purchase"
                      : modal === "expense"
                        ? "Save expense"
                        : editingVoucherId ? "Update receipt" : "Save receipt"}
              </button>
            </div>
          </section>
        </div>
      )}
      {(modal === "party" || modal === "product") && (
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
          <section
            className="modal compact-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <small>
                  {modal === "party" ? "PARTY MASTER" : "INVENTORY MASTER"}
                </small>
                <h2>
                  {modal === "party" ? "Add new party" : editingProductId ? "Edit inventory item" : "Add inventory item"}
                </h2>
              </div>
              <button onClick={() => setModal(null)}>×</button>
            </div>
            <div className="form-grid">
              <label className="full">
                {modal === "party" ? "Party / company name" : "Product name"}
                <input
                  autoFocus
                  value={entityName}
                  onChange={(e) => setEntityName(e.target.value)}
                  placeholder="Required"
                />
              </label>
              {modal === "party" ? (
                <>
                  <label>
                    Place / Address
                    <input
                      value={place}
                      onChange={(e) => setPlace(e.target.value)}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                  <label>
                    PAN Number (optional)
                    <input
                      value={taxNo}
                      onChange={(e) => setTaxNo(e.target.value)}
                      placeholder="PAN / Tax ID"
                    />
                  </label>
                  <label>
                    Opening balance · FY {fiscalYear?.label_bs}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={openingBalance}
                      disabled={!["admin","manager","accountant"].includes(currentMember?.role || "")}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    Balance side
                    <select value={openingSide} disabled={!["admin","manager","accountant"].includes(currentMember?.role || "")} onChange={(e) => setOpeningSide(e.target.value as "debit" | "credit")}>
                      <option value="debit">Debit · Party owes us</option>
                      <option value="credit">Credit · We owe party</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    SKU / Code
                    <input
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      list="product-unit-options"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="Select or type any unit"
                    />
                  </label>
                  <label>
                    Inventory type
                    <select value={productType} onChange={(e) => setProductType(e.target.value)}>
                      <option value="raw_material">Raw material</option>
                      <option value="packaging">Packaging</option>
                      <option value="finished_good">Finished product</option>
                      <option value="resale_good">Purchased finished / resale product</option>
                    </select>
                  </label>
                  <label>
                    Purchase price
                    <input
                      type="number"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                    />
                  </label>
                  <label>
                    Sale price
                    <input
                      type="number"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                    />
                  </label>
                  <label>
                    MRP / Maximum retail price
                    <input
                      type="number"
                      value={mrp}
                      onChange={(e) => setMrp(e.target.value)}
                    />
                  </label>
                  <label>
                    {editingProductId ? "Current stock (managed by transactions)" : "Opening stock"}
                    <input
                      type="number"
                      value={openingStock}
                      onChange={(e) => setOpeningStock(e.target.value)}
                      disabled={Boolean(editingProductId)}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                disabled={saving || snapshotSync !== "idle"}
                onClick={() => save(modal === "party" ? "Party" : "Product")}
              >
                {saving
                  ? "Saving…"
                  : modal === "party"
                    ? "Save party"
                    : editingProductId ? "Update item" : "Save item"}
              </button>
            </div>
          </section>
        </div>
      )}
      <datalist id="product-unit-options">{standardUnits.map((value)=><option key={value} value={value}/>)}</datalist>
      {notice && <div className="toast" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {["Overview","Sales","Payments","Parties"].map((item) => (
          <button key={item} className={active===item?"active":""} onPointerDown={()=>warmModule(item)} onClick={()=>setActive(item)}><i><NavIcon name={item}/></i><span>{item}</span></button>
        ))}
        <button onClick={()=>setSidebarOpen(true)}><i>☰</i><span>More</span></button>
      </nav>
    </main>
  );
}
