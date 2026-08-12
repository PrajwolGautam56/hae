"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NepaliDate from "nepali-date-converter";
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
  "Expenses",
  "Reports",
  "Leads",
  "Tasks",
  "Activity",
  "Team",
];

const money = (n: number) => `Nu. ${Math.abs(n).toLocaleString("en-IN")}`;
const localBusinessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const today = localBusinessDate();
const parseDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
const bsDate = (value: string) =>
  new NepaliDate(parseDate(value)).format("DD MMMM YYYY", "np");
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
};
const emptySaleLine = (): SaleLine => ({
  productId: "",
  name: "",
  quantity: 1,
  rate: 0,
});

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clientToday, setClientToday] = useState("");
  const [active, setActive] = useState("Overview");
  const [range, setRange] = useState("This month");
  const [modal, setModal] = useState<
    "sale" | "payment" | "purchase" | "expense" | "party" | "product" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [formParty, setFormParty] = useState("");
  const [parties, setParties] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
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
    setNextNumbers(data.nextNumbers || { sale: 1, receipt: 1, purchase: 1, expense: 1 });
    setFiscalYears(data.fiscalYears || []);
    setFiscalYear(data.fiscalYear || null);
    setProducts(data.products || []);
    setCompany(data.company || { name: "Hamro Afno Enterprises" });
  }
  useEffect(() => {
    fetch("/api/accounting")
      .then((r) => r.json())
      .then(applySnapshot)
      .catch(() => setNotice("Local database could not be loaded"));
  }, []);
  async function changeFiscalYear(id: string) {
    const request = ++fiscalRequest.current;
    const data = await fetch(`/api/accounting?fy=${id}`).then((r) => r.json());
    if (request === fiscalRequest.current) {
      applySnapshot(data);
      const inYear = today >= data.fiscalYear.start_ad && today <= data.fiscalYear.end_ad;
      setTransactionDate(inYear ? today : data.fiscalYear.end_ad);
    }
  }

  async function save(kind: string) {
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
    applySnapshot(data);
    setModal(null);
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
    setModal("sale");
    setFormParty(parties[0]?.name || "__new__");
    setSaleLines([emptySaleLine()]);
    setNewPartyName("");
    setPlace(""); setPhone(""); setTaxNo("");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
  }
  function openPayment() {
    setModal("payment");
    setFormParty(parties[0]?.name || "__new__");
    setNewPartyName(""); setAmount(""); setParticulars("");
    setPaymentMode("Cash"); setChequeNo(""); setChequeBank(""); setChequeExchangeDate("");
    setPlace(""); setPhone(""); setTaxNo("");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
  }
  function openModuleModal(kind: "purchase" | "expense" | "party" | "product") {
    setModal(kind);
    setAmount("");
    setParticulars("");
    setEntityName("");
    setOpeningBalance(""); setOpeningSide("debit");
    setTransactionDate(today >= fiscalYear?.start_ad && today <= fiscalYear?.end_ad ? today : fiscalYear?.end_ad || today);
    if (kind === "purchase") {
      setSaleLines([emptySaleLine()]);
      setFormParty(parties[0]?.name || "__new__");
      setNewPartyName("");
      setPlace(""); setPhone(""); setTaxNo("");
    }
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
  const nextInvoice = nextNumbers.sale;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <img className="brand-logo" src="/hamro-afno-logo.jpeg" alt="Hamro Afno Enterprises logo" />
          <div>
            <strong>Hamro Afno</strong>
            <span>ENTERPRISES</span>
          </div>
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
              <i>{["⌂", "↗", "↙", "⇄", "▣", "♙", "▦", "◫", "▥", "◉", "✓", "◷", "♟"][i]}</i>
              {item}
              {item === "Inventory" && lowStockCount > 0 && <b>{lowStockCount}</b>}
              {item === "Cheques" && chequeCounts.pending > 0 && <b>{chequeCounts.pending}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button>
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
            <button>⋮</button>
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
              <small>FY {fiscalYear?.label_bs || "2083/84"} · BTN</small>
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
              <div className="summary-grid">
                <article>
                  <div className="stat-head">
                    <span className="stat-icon blue">↗</span>
                    <button>•••</button>
                  </div>
                  <p>TOTAL SALES</p>
                  <h2>{money(totals.sales)}</h2>
                  <small>Recorded in Supabase</small>
                  <div className="spark blue-spark">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </article>
                <article>
                  <div className="stat-head">
                    <span className="stat-icon orange">◔</span>
                    <button>•••</button>
                  </div>
                  <p>RECEIVABLE</p>
                  <h2>{money(totals.receivable)}</h2>
                  <small>Current party balances</small>
                  <div className="spark orange-spark">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </article>
                <article>
                  <div className="stat-head">
                    <span className="stat-icon green">↙</span>
                    <button>•••</button>
                  </div>
                  <p>CASH RECEIVED</p>
                  <h2>{money(totals.received)}</h2>
                  <small>Saved payment receipts</small>
                  <div className="spark green-spark">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </article>
                <article>
                  <div className="stat-head">
                    <span className="stat-icon violet">▦</span>
                    <button>•••</button>
                  </div>
                  <p>STOCK VALUE</p>
                  <h2>{money(stockValue)}</h2>
                  <small>
                    <mark className="redmark">{lowStockCount} items</mark> low in stock
                  </small>
                  <div className="spark violet-spark">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </article>
              </div>

              <div className="dashboard-grid">
                <article className="activity card">
                  <div className="card-title">
                    <div>
                      <h3>Sales & Collections</h3>
                      <p>Monthly performance overview</p>
                    </div>
                    <div className="legend">
                      <span>
                        <i className="leg-sales"></i>Sales
                      </span>
                      <span>
                        <i className="leg-cash"></i>Collections
                      </span>
                      <button>•••</button>
                    </div>
                  </div>
                  <div className="chart">
                    <div className="ylabels">
                      <span>800k</span>
                      <span>600k</span>
                      <span>400k</span>
                      <span>200k</span>
                      <span>0</span>
                    </div>
                    <div className="plot">
                      <div className="gridline g1"></div>
                      <div className="gridline g2"></div>
                      <div className="gridline g3"></div>
                      <div className="gridline g4"></div>
                      <div className="chart-lines">
                        <div className="line sales-line"></div>
                        <div className="line cash-line"></div>
                        <span className="point p1"></span>
                        <span className="point p2"></span>
                      </div>
                      <div className="xlabels">
                        <span>Feb</span>
                        <span>Mar</span>
                        <span>Apr</span>
                        <span>May</span>
                        <span>Jun</span>
                        <span>Jul</span>
                      </div>
                    </div>
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
                      <i className="qa-blue">↗</i>
                      <span>
                        <strong>Sales Invoice</strong>
                        <small>Create a new bill</small>
                      </span>
                    </button>
                    <button
                      onClick={openPayment}
                    >
                      <i className="qa-green">↓</i>
                      <span>
                        <strong>Receive Payment</strong>
                        <small>Cash, bank or cheque</small>
                      </span>
                    </button>
                    <button onClick={() => openModuleModal("purchase")}>
                      <i className="qa-orange">↙</i>
                      <span>
                        <strong>Add Purchase</strong>
                        <small>Stock or expense</small>
                      </span>
                    </button>
                    <button onClick={() => openModuleModal("expense")}>
                      <i className="qa-violet">◫</i>
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
                        {transactions.map((t, i) => (
                          <tr key={i}>
                            <td>
                              <span className={`tx-icon t${i % 5}`}>
                                {["↗", "↓", "↙", "↗", "◫"][i % 5]}
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
                            <td>•••</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                    {visibleParties.map((p) => (
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
                <button
                  className="primary"
                  onClick={openSale}
                >
                  ＋ Add sales invoice
                </button>
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
                          <tr key={t.id}>
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
                        ? "Manage products, prices and live stock."
                        : active === "Parties"
                          ? "Customers, suppliers and their balances."
                          : active === "Payments"
                            ? "Record and review party receipts."
                            : "Record office and operating expenses."}
                  </p>
                </div>
                {active === "Purchases" && (
                  <button
                    className="primary"
                    onClick={() => openModuleModal("purchase")}
                  >
                    ＋ Add purchase bill
                  </button>
                )}
                {active === "Inventory" && (
                  <button
                    className="primary"
                    onClick={() => openModuleModal("product")}
                  >
                    ＋ Add inventory item
                  </button>
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
                  {active === "Inventory" ? (
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>PRODUCT</th>
                          <th>UNIT</th>
                          <th>PURCHASE</th>
                          <th>SALE</th>
                          <th>STOCK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((p) => (
                          <tr key={p.id}>
                            <td>{p.sku || "—"}</td>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.unit}</td>
                            <td>{money(Number(p.purchase_price))}</td>
                            <td>{money(Number(p.sale_price))}</td>
                            <td>
                              <strong>{p.stock_qty}</strong>
                            </td>
                          </tr>
                        ))}
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
                        {transactions
                          .filter((t) =>
                            active === "Purchases"
                              ? t.type === "Purchase"
                              : active === "Payments"
                                ? t.type === "Payment Received"
                                : active === "Expenses"
                                  ? t.type === "Office Expense"
                                  : true,
                          )
                          .map((t) => (
                            <tr key={t.id}>
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
              </article>
            </section>
          )}
        </div>
      </section>

      {modal && !["party", "product"].includes(modal) && (
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
                    ? "Create sales invoice"
                    : modal === "purchase"
                      ? "Create purchase bill"
                      : modal === "expense"
                        ? "Add expense"
                        : "Receive payment"}
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
                Transaction date (AD)
                <input
                  type="date"
                  min={fiscalYear?.start_ad}
                  max={fiscalYear?.end_ad}
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                />
                <small className="date-conversion">BS: {transactionDate ? bsDate(transactionDate) : "—"}</small>
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
                          <input
                            value={line.name}
                            onChange={(e) =>
                              updateSaleLine(index, { name: e.target.value })
                            }
                            placeholder="Type item name"
                          />
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
                    Amount (Nu.)
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
                        onChange={(e) => setPaymentMode(e.target.value)}
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
                      <label>Exchange / clearance date *<input type="date" value={chequeExchangeDate} onChange={(e) => setChequeExchangeDate(e.target.value)} /></label>
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
              <button onClick={() => setModal(null)}>Cancel</button>
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
                    ? "Save invoice"
                    : modal === "purchase"
                      ? "Save purchase"
                      : modal === "expense"
                        ? "Save expense"
                        : "Save receipt"}
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
                  {modal === "party" ? "Add new party" : "Add inventory item"}
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
                    Opening stock
                    <input
                      type="number"
                      value={openingStock}
                      onChange={(e) => setOpeningStock(e.target.value)}
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
                    : "Save item"}
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
        {[["Overview","⌂"],["Sales","↗"],["Payments","⇄"],["Parties","♙"]].map(([item,icon]) => (
          <button key={item} className={active===item?"active":""} onClick={()=>setActive(item)}><i>{icon}</i><span>{item}</span></button>
        ))}
        <button onClick={()=>setSidebarOpen(true)}><i>☰</i><span>More</span></button>
      </nav>
    </main>
  );
}
