"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BsDateInput from "./bs-date-input";
import { formatBs } from "../lib/nepali-date";
import { downloadCsv, printDocument } from "../lib/export-data";
import CrmWorkspace from "./crm-workspace";
import ReportsWorkspace from "./reports-workspace";
import ChequeWorkspace from "./cheque-workspace";

const nav = [
  "Overview",
  "Sales",
  "Purchases",
  "Payments",
  "Cheques",
  "Parties",
  "Inventory",
  "Stock",
  "Expenses",
  "Reports",
  "Leads",
  "Tasks",
  "Activity",
  "Team",
];

const iconPaths:Record<string,string>={Overview:"M3 11.5 12 4l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",Sales:"M5 19 19 5m-9 0h9v9",Purchases:"M19 5 5 19m9 0H5v-9",Payments:"M4 7h16M4 12h16M4 17h10",Cheques:"M3 6h18v12H3zM7 14h4",Parties:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75 1",Inventory:"M4 7h16v13H4zM8 3h8v4M8 11h8",Stock:"M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",Expenses:"M6 2h9l3 3v17H6zM9 13h6M9 17h4",Reports:"M4 19V9m5 10V5m5 14v-7m5 7V3",Leads:"M12 22s7-4.35 7-11A7 7 0 1 0 5 11c0 6.65 7 11 7 11m0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6",Tasks:"M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",Activity:"M3 12h4l2-7 4 14 2-7h6",Team:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m14 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75 1"};
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
  quantity: number;
  rate: number;
  unit?: string;
  itemType?: string;
};
const emptySaleLine = (): SaleLine => ({
  productId: "",
  name: "",
  quantity: 1,
  rate: 0,
  unit: "pcs",
  itemType: "finished_good",
});

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clientToday, setClientToday] = useState("");
  const [active, setActive] = useState("Overview");
  const [range, setRange] = useState("This month");
  const [modal, setModal] = useState<
    "sale" | "payment" | "purchase" | "expense" | "party" | "product" | "production" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [formParty, setFormParty] = useState("");
  const [parties, setParties] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [monthlyPerformance, setMonthlyPerformance] = useState<any[]>([]);
  const [company, setCompany] = useState<any>({ name: "Hamro Afno Enterprises" });
  const [totals, setTotals] = useState({
    sales: 0,
    received: 0,
    receivable: 0,
  });
  const [nextNumbers, setNextNumbers] = useState({ sale: 1, receipt: 1, purchase: 1, expense: 1 });
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeExchangeDate, setChequeExchangeDate] = useState("");
  const [chequeCounts, setChequeCounts] = useState({ pending: 0, dueToday: 0, overdue: 0 });
  const [chequeBanks, setChequeBanks] = useState<any[]>([]);
  const [particulars, setParticulars] = useState("");
  const [saving, setSaving] = useState(false);
  const [calendar, setCalendar] = useState<"BS" | "AD">("BS");
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  const [fiscalYear, setFiscalYear] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [saleLines, setSaleLines] = useState<SaleLine[]>([emptySaleLine()]);
  const [taxPercent, setTaxPercent] = useState(13);
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
  const [openingStock, setOpeningStock] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingSide, setOpeningSide] = useState<"debit" | "credit">("debit");
  const [transactionDate, setTransactionDate] = useState(today);
  const [voucherDetail, setVoucherDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [productType, setProductType] = useState("finished_good");
  const [outputProductId, setOutputProductId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("");
  const [productionInputs, setProductionInputs] = useState([{ productId: "", quantity: 0 }]);
  const [reportPartyId, setReportPartyId] = useState("");
  const fiscalRequest = useRef(0);
  const visibleParties = useMemo(
    () =>
      parties.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [parties, query],
  );

  useEffect(() => {
    setClientToday(localBusinessDate());
  }, []);
  async function refreshChequeCounts() {
    try {
      const response = await fetch("/api/cheques", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) { setChequeCounts(data.counts); setChequeBanks(data.banks || []); }
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
              payment: "Payment Received",
              purchase: "Purchase",
              expense: "Office Expense",
            } as any
          )[t.type] || t.type,
      })),
    );
    setTotals(data.totals);
    setMonthlyPerformance(data.monthlyPerformance || []);
    setNextNumbers(data.nextNumbers || { sale: 1, receipt: 1, purchase: 1, expense: 1 });
    setFiscalYears(data.fiscalYears || []);
    setFiscalYear(data.fiscalYear || null);
    setProducts(data.products || []);
    setCompany(data.company || { name: "Hamro Afno Enterprises" });
    try { sessionStorage.setItem(`hae-snapshot-${data.fiscalYear?.id || "current"}`, JSON.stringify(data)); sessionStorage.setItem("hae-snapshot-current", JSON.stringify(data)); } catch {}
  }
  function clearReportCache(){try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith("hae-report-"))sessionStorage.removeItem(key)}}catch{}}
  useEffect(() => {
    try { const cached=sessionStorage.getItem("hae-snapshot-current");if(cached)applySnapshot(JSON.parse(cached)); } catch {}
    const controller=new AbortController();
    fetch("/api/accounting",{signal:controller.signal})
      .then((r) => r.json())
      .then(applySnapshot)
      .catch((error) => {if(error?.name!=="AbortError")setNotice("Database could not be loaded")});
    return()=>controller.abort();
  }, []);
  async function changeFiscalYear(id: string) {
    const request = ++fiscalRequest.current;
    try{const cached=sessionStorage.getItem(`hae-snapshot-${id}`);if(cached)applySnapshot(JSON.parse(cached))}catch{}
    const data = await fetch(`/api/accounting?fy=${id}`).then((r) => r.json());
    if (request === fiscalRequest.current) {
      applySnapshot(data);
      const inYear = today >= data.fiscalYear.start_ad && today <= data.fiscalYear.end_ad;
      setTransactionDate(inYear ? today : data.fiscalYear.end_ad);
    }
  }

  async function save(kind: string) {
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
    const validLines = saleLines.filter(
      (l) => l.name.trim() && l.quantity > 0 && l.rate >= 0,
    );
    if (
      (modal === "sale" || modal === "purchase") &&
      (!validLines.length || (!party && !newPartyName.trim()))
    ) {
      setNotice("Please add a party and at least one valid product");
      return;
    }
    if (
      (modal === "payment" || modal === "expense") &&
      (!amount || Number(amount) <= 0)
    ) {
      setNotice("Please enter a valid amount");
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
    setSaving(true);
    const response = await fetch("/api/accounting", {
      method: editingVoucherId || editingProductId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voucherId: editingVoucherId || undefined,
        productId: editingProductId || undefined,
        type: modal || "payment",
        partyId: modal === "expense" ? undefined : party?.id,
        partyName:
          modal === "party"
            ? entityName
            : modal === "expense"
              ? ""
              : party?.name || newPartyName.trim(),
        amount: Number(amount),
        particulars,
        paymentMode,
        chequeNo,
        chequeBank,
        chequeExchangeDate,
        date: transactionDate,
        fiscalYearId: fiscalYear?.id,
        lines: validLines.map((l) => ({
          product_id: l.productId || null,
          name: l.name,
          quantity: l.quantity,
          rate: l.rate,
          unit: l.unit || "pcs",
          item_type: l.itemType || "finished_good",
        })),
        taxPercent,
        discountPercent,
        productName: entityName,
        sku,
        unit,
        salePrice: Number(salePrice || 0),
        purchasePrice: Number(purchasePrice || 0),
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
      setNotice(data.error || "Could not save");
      return;
    }
    clearReportCache();
    applySnapshot(data);
    setModal(null);
    setEditingVoucherId("");
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
    setOpeningStock("");
    setOpeningBalance("");
    setOpeningSide("debit");
    setNotice(`${kind} saved in local database`);
    refreshChequeCounts();
    window.setTimeout(() => setNotice(""), 2600);
  }
  function openSale() {
    setEditingVoucherId("");
    setModal("sale");
    setFormParty(parties[0]?.name || "__new__");
    setSaleLines([emptySaleLine()]);
    setNewPartyName("");
    setPlace(""); setPhone(""); setTaxNo("");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
  }
  function openPayment() {
    setEditingVoucherId("");
    setModal("payment");
    setFormParty(parties[0]?.name || "__new__");
    setNewPartyName(""); setAmount(""); setParticulars("");
    setPaymentMode("Cash"); setChequeNo(""); setChequeBank(""); setChequeExchangeDate("");
    setPlace(""); setPhone(""); setTaxNo("");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
  }
  function openModuleModal(kind: "purchase" | "expense" | "party" | "product") {
    setEditingProductId("");
    setModal(kind);
    setAmount("");
    setParticulars("");
    setEntityName("");
    if (kind === "product") { setSku(""); setUnit("pcs"); setSalePrice(""); setPurchasePrice(""); setOpeningStock(""); }
    setOpeningBalance(""); setOpeningSide("debit");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
    if (kind === "purchase") {
      setSaleLines([emptySaleLine()]);
      setFormParty(parties[0]?.name || "__new__");
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
        : { productId: "", name: "", rate: 0 },
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
    setDetailLoading(true);
    setVoucherDetail({ id });
    try {
      const response = await fetch(`/api/accounting?voucherId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load voucher details");
      setVoucherDetail(data);
    } catch (error) {
      setVoucherDetail(null);
      setNotice(error instanceof Error ? error.message : "Could not load voucher details");
    } finally {
      setDetailLoading(false);
    }
  }
  function editVoucher() {
    const detail=voucherDetail;if(!detail||!["sale","receipt"].includes(detail.voucher_type))return;
    setEditingVoucherId(detail.id);setFormParty(detail.parties?.name||"");setTransactionDate(detail.voucher_date);setParticulars(detail.narration||"");
    if(detail.voucher_type==="sale"){setSaleLines((detail.lines||[]).map((line:any)=>({productId:line.product_id||"",name:line.description||line.products?.name||"",quantity:Number(line.quantity),rate:Number(line.rate),unit:line.products?.unit||"pcs",itemType:"finished_good"})));setDiscountPercent(Number(detail.discount_percent||0));setTaxPercent(Number(detail.tax_percent||0));setModal("sale");}
    else{setAmount(String(detail.total||""));setPaymentMode(detail.payment_mode||"Cash");setChequeNo(detail.cheque_no||"");setChequeBank(detail.cheque_bank||"");setChequeExchangeDate(detail.cheque_exchange_date||"");setModal("payment");}
    setVoucherDetail(null);
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
  const performanceMax = Math.max(
    1,
    ...monthlyPerformance.flatMap((month) => [Number(month.sales || 0), Number(month.collections || 0)]),
  );
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
    if(module==="Inventory"||module==="Stock"){const rows=products.filter(p=>module==="Inventory"?["raw_material","packaging"].includes(p.item_type):["finished_good","resale_good"].includes(p.item_type));downloadCsv(`${module}-FY-${fiscalYear?.label_bs}`,rows,[{label:"SKU",value:(r:any)=>r.sku},{label:"Product",value:(r:any)=>r.name},{label:"Type",value:(r:any)=>r.item_type},{label:"Unit",value:(r:any)=>r.unit},{label:"Purchase price",value:(r:any)=>r.purchase_price},{label:"Sale price",value:(r:any)=>r.sale_price},{label:"Stock quantity",value:(r:any)=>r.stock_qty}]);return}
    if(module==="Parties"){downloadCsv(`Parties-FY-${fiscalYear?.label_bs}`,parties,[{label:"Party",value:(r:any)=>r.name},{label:"Address",value:(r:any)=>r.place},{label:"Phone",value:(r:any)=>r.phone},{label:"PAN",value:(r:any)=>r.tax_no},{label:"Opening balance",value:(r:any)=>r.opening_balance},{label:"Current balance",value:(r:any)=>r.balance}]);return}
    const reportType=module==="Sales"?"sales":module==="Purchases"?"purchases":module==="Payments"?"payments":"expenses";try{const q=new URLSearchParams({fiscalYearId:fiscalYear.id,type:reportType,from:fiscalYear.start_ad,to:fiscalYear.end_ad});const response=await fetch(`/api/reports?${q}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error);downloadCsv(`${module}-FY-${fiscalYear?.label_bs}`,data.rows,[{label:"Reference",value:(r:any)=>r.ref},{label:"Date (BS)",value:(r:any)=>formatBs(r.date)},{label:"Party / Account",value:(r:any)=>r.party},{label:"Particulars",value:(r:any)=>r.particulars},{label:"Payment mode",value:(r:any)=>r.paymentMode},{label:"Subtotal",value:(r:any)=>r.subtotal},{label:"Discount",value:(r:any)=>r.discount},{label:"Tax",value:(r:any)=>r.tax},{label:"Amount",value:(r:any)=>r.amount},{label:"Debit",value:(r:any)=>r.debit},{label:"Credit",value:(r:any)=>r.credit}])}catch(error){setNotice(error instanceof Error?error.message:"Download failed")}
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <img className="brand-logo" src="/hamro-afno-logo.jpeg" alt="Hamro Afno Enterprises logo" />
          <div>
            <strong>Hamro Afno</strong>
            <span>ENTERPRISES</span>
          </div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={()=>setSidebarOpen(false)}>×</button>
        </div>
        <nav>
          <p>WORKSPACE</p>
          {nav.map((item, i) => (
            <button
              key={item}
              className={active === item ? "active" : ""}
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
            <div>PG</div>
            <span>
              <strong>Prajwol Gautam</strong>
              <small>Administrator</small>
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
            <img className="company-logo" src="/hamro-afno-logo.jpeg" alt="" />
            <div>
              <strong>{company.name}</strong>
              <small>FY {fiscalYear?.label_bs || "2083/84"} · NPR</small>
            </div>
            <strong className="mobile-page-title">{active}</strong>
          </div>
          <div className="fy-tools">
            <select
              aria-label="Financial year"
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
              <button
                className="date-pill"
                onClick={() =>
                  setRange(
                    range === "This month" ? "This fiscal year" : "This month",
                  )
                }
              >
                ◷ &nbsp;{range}
              </button>
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
                <article className="activity card">
                  <div className="card-title">
                    <div>
                      <h3>Sales & Collections</h3>
                      <p>Last six Nepali months · FY {fiscalYear?.label_bs}</p>
                    </div>
                    <div className="legend">
                      <span>
                        <i className="leg-sales"></i>Sales
                      </span>
                      <span>
                        <i className="leg-cash"></i>Collections
                      </span>
                    </div>
                  </div>
                  <div className="performance-chart" aria-label="Monthly sales and collections chart">
                    {monthlyPerformance.map((month) => (
                      <div className="performance-month" key={`${month.year}-${month.month}`}>
                        <div className="performance-bars">
                          <i className="performance-bar sales" title={`Sales ${money(month.sales)}`} style={{ height: `${Math.max(month.sales ? 7 : 1, (Number(month.sales) / performanceMax) * 100)}%` }} />
                          <i className="performance-bar collections" title={`Collections ${money(month.collections)}`} style={{ height: `${Math.max(month.collections ? 7 : 1, (Number(month.collections) / performanceMax) * 100)}%` }} />
                        </div>
                        <strong>{month.label}</strong>
                      </div>
                    ))}
                    {!monthlyPerformance.length && <div className="dashboard-empty">Monthly figures will appear after the first transaction.</div>}
                  </div>
                </article>

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
                      onClick={openPayment}
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
                          setFormParty(p.name);
                          openPayment();
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
                  <small>INVOICES ISSUED</small>
                  <strong>{salesTransactions.length}</strong>
                </article>
                <article>
                  <small>LAST INVOICE</small>
                  <strong>{salesTransactions[0]?.sequence_no || "No bill yet"}</strong>
                </article>
                <article>
                  <small>NEXT NUMBER</small>
                  <strong>{nextInvoice}</strong>
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
                              <strong>{t.sequence_no}</strong>
                            </td>
                            <td>
                              {calendar === "BS"
                                ? bsDate(t.date)
                                : adDate(t.date)}
                            </td>
                            <td>{t.party}</td>
                            <td className="debit">{money(t.debit)}</td>
                            <td>
                              <span className="paid-chip">Posted</span>
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
                      <span><strong>Invoice #{transaction.sequence_no || transaction.ref}</strong><small>{transaction.party}</small></span>
                      <span className="mobile-register-amount"><strong>{money(transaction.debit)}</strong><small>{calendar === "BS" ? bsDate(transaction.date) : adDate(transaction.date)}</small></span>
                      <span className="mobile-register-meta"><span>{transaction.ref}</span><span className="paid-chip">Posted</span></span>
                    </button>
                  ))}
                  {!salesTransactions.length && <div className="dashboard-empty">No sales invoice in this fiscal year. Next invoice starts at 1.</div>}
                </div>
              </article>
            </section>
          ) : active === "Cheques" ? (
            <ChequeWorkspace onNotice={setNotice} />
          ) : active === "Reports" ? (
            <ReportsWorkspace
              parties={parties}
              fiscalYear={fiscalYear}
              initialPartyId={reportPartyId}
              onNotice={setNotice}
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
                  <div className="hero-actions"><button className="primary soft" onClick={() => {setProductType("raw_material");openModuleModal("product")}}>＋ Add material / packaging</button><button className="primary" onClick={openProduction}>⚙ Convert / produce stock</button></div>
                )}
                {active === "Stock" && (
                  <div className="hero-actions"><button className="primary soft" onClick={() => {setProductType("finished_good");openModuleModal("product")}}>＋ Add sellable item</button><button className="primary" onClick={openProduction}>⚙ Produce finished goods</button></div>
                )}
                {active === "Parties" && (
                  <button
                    className="primary"
                    onClick={() => openModuleModal("party")}
                  >
                    ＋ Add party
                  </button>
                )}
                {active === "Payments" && (
                  <button
                    className="primary"
                    onClick={openPayment}
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
                            <td>
                              <strong>{p.stock_qty}</strong>
                            </td>
                            <td><button className="table-action" onClick={() => editProduct(p)}>Edit</button></td>
                          </tr>
                        ))}
                        {!registerProducts.length && <tr><td colSpan={8} className="empty-year">{active === "Inventory" ? "No raw material or packaging yet. Add directly or receive through a purchase bill." : "No sellable stock yet. Purchase a resale item or produce finished goods."}</td></tr>}
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
                              if (e.key === "Enter") {
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
                        <button key={party.id} onClick={() => { setReportPartyId(party.id); setActive("Reports"); }}>
                          <span><strong>{party.name}</strong><small>{[party.place, party.phone].filter(Boolean).join(" · ") || "No contact details"}</small></span>
                          <span className="mobile-register-amount"><strong>{money(Number(party.balance))}</strong><small>{Number(party.balance) < 0 ? "Advance" : "To receive"}</small></span>
                          <span className="mobile-register-meta"><span>{party.tax_no ? `PAN ${party.tax_no}` : "PAN not added"}</span><span>View ledger ›</span></span>
                        </button>
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
            </section>
          )}
        </div>
      </section>

      {voucherDetail && (
        <div className="modal-backdrop" onMouseDown={() => setVoucherDetail(null)}>
          <section className="modal voucher-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <small>{voucherDetail.voucher_type === "sale" ? "SALES INVOICE" : voucherDetail.voucher_type === "receipt" ? "PAYMENT RECEIPT" : "VOUCHER"} · FY {voucherDetail.fiscal_years?.label_bs || fiscalYear?.label_bs}</small>
                <h2>{detailLoading ? "Loading details…" : `${voucherDetail.voucher_type === "sale" ? "Invoice" : voucherDetail.voucher_type === "receipt" ? "Receipt" : "Voucher"} #${voucherDetail.sequence_no || voucherDetail.voucher_no}`}</h2>
              </div>
              <button aria-label="Close voucher details" onClick={() => setVoucherDetail(null)}>×</button>
            </div>
            {!detailLoading && (
              <div className="voucher-document">
                <div className="voucher-company">
                  <img src="/hamro-afno-logo.jpeg" alt="" />
                  <div><strong>{company.name}</strong><span>Official accounting record</span></div>
                  <div className="voucher-status"><span>POSTED</span><small>{voucherDetail.voucher_date ? bsDate(voucherDetail.voucher_date) : ""}</small></div>
                </div>
                <div className="voucher-meta">
                  <div><small>PARTY / CUSTOMER</small><strong>{voucherDetail.parties?.name || "Cash / General"}</strong><span>{[voucherDetail.parties?.place, voucherDetail.parties?.phone, voucherDetail.parties?.tax_no ? `PAN ${voucherDetail.parties.tax_no}` : ""].filter(Boolean).join(" · ") || "No additional details"}</span></div>
                  <div><small>DATE</small><strong>{calendar === "BS" ? bsDate(voucherDetail.voucher_date) : adDate(voucherDetail.voucher_date)}</strong><span>AD {adDate(voucherDetail.voucher_date)}</span></div>
                  <div><small>{voucherDetail.voucher_type === "receipt" ? "RECEIPT NO." : "INVOICE NO."}</small><strong>{voucherDetail.sequence_no || voucherDetail.voucher_no}</strong><span>FY {voucherDetail.fiscal_years?.label_bs}</span></div>
                </div>
                {voucherDetail.lines?.length > 0 && <div className="voucher-lines"><table><thead><tr><th>#</th><th>PRODUCT / DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>{voucherDetail.lines.map((line:any,index:number)=><tr key={line.id}><td>{index+1}</td><td><strong>{line.description || line.products?.name}</strong><small>{[line.products?.sku,line.products?.unit].filter(Boolean).join(" · ")}</small></td><td>{Number(line.quantity).toLocaleString()}</td><td>{money(Number(line.rate))}</td><td><strong>{money(Number(line.amount))}</strong></td></tr>)}</tbody></table></div>}
                {voucherDetail.voucher_type === "receipt" && <div className="receipt-panel"><div><small>AMOUNT RECEIVED</small><strong>{money(Number(voucherDetail.total))}</strong></div><div><small>PAYMENT MODE</small><strong>{voucherDetail.payment_mode || "Cash"}</strong></div>{voucherDetail.payment_mode === "Cheque" && <><div><small>CHEQUE / BANK</small><strong>{voucherDetail.cheque_no || "—"} · {voucherDetail.cheque_bank || "—"}</strong></div><div><small>CLEARANCE DATE</small><strong>{voucherDetail.cheque_exchange_date ? adDate(voucherDetail.cheque_exchange_date) : "—"}</strong><span className={`cheque-status ${voucherDetail.cheque_status}`}>{voucherDetail.cheque_status}</span></div></>}</div>}
                {voucherDetail.voucher_type === "sale" && <div className="voucher-totals"><div><span>Subtotal</span><strong>{money(Number(voucherDetail.subtotal))}</strong></div><div><span>Discount ({Number(voucherDetail.discount_percent)}%)</span><strong>− {money(Number(voucherDetail.discount_amount))}</strong></div><div><span>VAT / Tax ({Number(voucherDetail.tax_percent)}%)</span><strong>＋ {money(Number(voucherDetail.tax_amount))}</strong></div><div className="grand"><span>Grand total</span><strong>{money(Number(voucherDetail.total))}</strong></div></div>}
                {voucherDetail.narration && <div className="voucher-note"><small>NARRATION</small><p>{voucherDetail.narration}</p></div>}
              </div>
            )}
            <div className="modal-actions"><button onClick={() => setVoucherDetail(null)}>Close</button>{["sale","receipt"].includes(voucherDetail.voucher_type)&&<button className="edit-voucher" onClick={editVoucher}>✎ Edit record</button>}<button className="primary" onClick={() => printDocument("voucher")}>Print / PDF</button></div>
          </section>
        </div>
      )}

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
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
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
              <button onClick={() => setModal(null)}>×</button>
            </div>
            <div className="form-grid">
              {modal !== "expense" && (
                <>
                  {(modal === "sale" || modal === "purchase") && (
                    <div className="invoice-section-title full"><span>01</span><div><strong>{modal === "sale" ? "Customer details" : "Supplier details"}</strong><small>Select an existing party or create one instantly.</small></div></div>
                  )}
                  <label className="full">
                    {modal === "purchase"
                      ? "Supplier / Party"
                      : "Party / Customer"}
                    <select
                      value={formParty}
                      onChange={(e) => {
                        setFormParty(e.target.value);
                        if (e.target.value !== "__new__") setNewPartyName("");
                      }}
                    >
                      {parties.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                      <option value="__new__">
                        ＋ Add new party instantly
                      </option>
                    </select>
                  </label>
                  {formParty === "__new__" && (
                    <div className="inline-party full">
                      <div className="inline-party-title"><strong>New party details</strong><span>Name is required; other details are optional.</span></div>
                      <label>Party / company name<input autoFocus value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} placeholder="Required" /></label>
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
                  ? "Invoice number"
                  : modal === "payment"
                    ? "Receipt number"
                    : modal === "purchase"
                      ? "Purchase number"
                      : "Expense number"}
                <input
                  readOnly
                  value={String(
                    modal === "sale"
                      ? nextNumbers.sale
                      : modal === "payment"
                        ? nextNumbers.receipt
                        : modal === "purchase"
                          ? nextNumbers.purchase
                          : nextNumbers.expense,
                  )}
                />
              </label>
              {(modal === "sale" || modal === "purchase") && (
                <div className="invoice-section-title full"><span>02</span><div><strong>Items & pricing</strong><small>Add products, quantity and rate. Scroll normally for totals.</small></div></div>
              )}
              {modal === "sale" || modal === "purchase" ? (
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
                        <select
                          value={line.productId}
                          onChange={(e) => chooseProduct(index, e.target.value)}
                        >
                          <option value="">Custom / non-inventory item</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · Stock {p.stock_qty}
                            </option>
                          ))}
                        </select>
                        {!line.productId && (
                          <><input value={line.name} onChange={(e) => updateSaleLine(index, { name: e.target.value })} placeholder="Type item name" />{modal === "purchase" && <div className="purchase-item-meta"><select aria-label={`Unit ${index + 1}`} value={line.unit} onChange={(e) => updateSaleLine(index,{unit:e.target.value})}><option value="pcs">pcs</option><option value="litre">litre</option><option value="ml">ml</option><option value="kg">kg</option><option value="bag">bag</option><option value="box">box</option><option value="bucket">bucket</option></select><select aria-label={`Stock type ${index + 1}`} value={line.itemType} onChange={(e) => updateSaleLine(index,{itemType:e.target.value})}><option value="raw_material">Raw material</option><option value="packaging">Packaging</option><option value="finished_good">Finished product</option><option value="resale_good">Resale product</option></select></div>}</>
                        )}
                      </div>
                      <input
                        aria-label={`Quantity ${index + 1}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        onWheel={wheelNumberInput}
                        value={line.quantity}
                        onChange={(e) =>
                          updateSaleLine(index, {
                            quantity: Number(e.target.value),
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
                        onChange={(e) =>
                          updateSaleLine(index, {
                            rate: Number(e.target.value),
                          })
                        }
                      />
                      <strong>{money(line.quantity * line.rate)}</strong>
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
                    onClick={() =>
                      setSaleLines((lines) => [...lines, emptySaleLine()])
                    }
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
                        {money(modal === "purchase" ? saleSubtotal : saleGrand)}
                      </strong>
                    </div>
                  </div>
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
                        onChange={(e) => {setPaymentMode(e.target.value);if(e.target.value==="Cheque"&&!chequeExchangeDate)setChequeExchangeDate(transactionDate)}}
                      >
                        <option>Cash</option>
                        <option>Bank transfer</option>
                        <option>Cheque</option>
                      </select>
                    </label>
                  )}
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
            <div className="balance-note">
              <span>Current balance</span>
              <strong>
                {money(parties.find((p) => p.name === formParty)?.balance || 0)}{" "}
                Dr.
              </strong>
            </div>
            <div className="modal-actions">
              {(modal === "sale" || modal === "purchase") && (
                <button className="review-total" onClick={reviewInvoiceTotal}>
                  <span>Review total ↓</span>
                  <strong>
                    {money(modal === "purchase" ? saleSubtotal : saleGrand)}
                  </strong>
                </button>
              )}
              <button onClick={() => {setModal(null);setEditingVoucherId("")}}>Cancel</button>
              <button
                className="primary"
                disabled={saving}
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
                    ? editingVoucherId ? "Update invoice" : "Save invoice"
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
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    Balance side
                    <select value={openingSide} onChange={(e) => setOpeningSide(e.target.value as "debit" | "credit")}>
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
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    >
                      <option>pcs</option>
                      <option>bag</option>
                      <option>kg</option>
                      <option>box</option>
                      <option>sheet</option>
                      <option>meter</option>
                      <option value="litre">litre</option>
                      <option value="ml">ml</option>
                    </select>
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
                disabled={saving}
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
      {notice && <div className="toast">✓ {notice}</div>}
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {["Overview","Sales","Payments","Parties"].map((item) => (
          <button key={item} className={active===item?"active":""} onClick={()=>setActive(item)}><i><NavIcon name={item}/></i><span>{item}</span></button>
        ))}
        <button onClick={()=>setSidebarOpen(true)}><i>☰</i><span>More</span></button>
      </nav>
    </main>
  );
}
