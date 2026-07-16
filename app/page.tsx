"use client";

import { useMemo, useState } from "react";

const parties = [
  { name: "Tashi Delek Traders", place: "Phuentsholing", balance: 1842500, tone: "amber", initials: "TD" },
  { name: "Druk Hardware House", place: "Thimphu", balance: 785400, tone: "blue", initials: "DH" },
  { name: "Norbu Enterprise", place: "Paro", balance: -124000, tone: "green", initials: "NE" },
  { name: "Karma General Store", place: "Gelephu", balance: 346800, tone: "violet", initials: "KG" },
];

const transactions = [
  { type: "Sales Invoice", party: "Tashi Delek Traders", ref: "INV-2081", date: "16 Jul 2026", debit: 485000, credit: 0 },
  { type: "Payment Received", party: "Druk Hardware House", ref: "REC-0942 · Cash", date: "16 Jul 2026", debit: 0, credit: 200000 },
  { type: "Purchase", party: "Himalayan Suppliers", ref: "PUR-0718", date: "15 Jul 2026", debit: 0, credit: 326500 },
  { type: "Sales Invoice", party: "Karma General Store", ref: "INV-2080", date: "15 Jul 2026", debit: 175800, credit: 0 },
  { type: "Office Expense", party: "Bhutan Telecom", ref: "EXP-0137 · Internet", date: "14 Jul 2026", debit: 0, credit: 4800 },
];

const nav = ["Overview", "Sales", "Purchases", "Payments", "Parties", "Inventory", "Expenses", "Reports"];

const money = (n: number) => `Nu. ${Math.abs(n).toLocaleString("en-IN")}`;

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [range, setRange] = useState("This month");
  const [modal, setModal] = useState<"sale" | "payment" | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [formParty, setFormParty] = useState("Tashi Delek Traders");
  const visibleParties = useMemo(() => parties.filter(p => p.name.toLowerCase().includes(query.toLowerCase())), [query]);

  function save(kind: string) {
    setModal(null);
    setNotice(`${kind} saved successfully`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">ह</div><div><strong>हाम्रो खाता</strong><span>TRADING & ACCOUNTS</span></div></div>
        <nav>
          <p>WORKSPACE</p>
          {nav.map((item, i) => <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}><i>{["⌂","↗","↙","⇄","♙","▦","◫","▥"][i]}</i>{item}{item === "Inventory" && <b>12</b>}</button>)}
        </nav>
        <div className="sidebar-foot">
          <button><i>⚙</i>Settings</button><button><i>?</i>Help & Support</button>
          <div className="profile"><div>PG</div><span><strong>Prajwol Gautam</strong><small>Administrator</small></span><button>⋮</button></div>
        </div>
      </aside>

      <section className="content">
        <header><div><button className="mobile-menu">☰</button><span className="company-dot">H</span><div><strong>Himalayan Link Trading</strong><small>FY 2026–27 · BTN</small></div><button className="chev">⌄</button></div><div><button className="icon-btn">⌕</button><button className="icon-btn">♢<em></em></button><button className="primary" onClick={() => setModal("sale")}>＋ New Transaction</button></div></header>

        <div className="page">
          <div className="title-row"><div><p>Thursday, 16 July</p><h1>{active}</h1></div><div className="title-actions"><button className="date-pill">◷ &nbsp;{range}⌄</button><button className="dots">•••</button></div></div>

          <div className="summary-grid">
            <article><div className="stat-head"><span className="stat-icon blue">↗</span><button>•••</button></div><p>TOTAL SALES</p><h2>Nu. 2,840,500</h2><small><b>↑ 12.4%</b> vs last month</small><div className="spark blue-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
            <article><div className="stat-head"><span className="stat-icon orange">◔</span><button>•••</button></div><p>RECEIVABLE</p><h2>Nu. 3,098,700</h2><small><mark>18 invoices</mark> awaiting payment</small><div className="spark orange-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
            <article><div className="stat-head"><span className="stat-icon green">↙</span><button>•••</button></div><p>CASH RECEIVED</p><h2>Nu. 1,624,800</h2><small><b>↑ 8.2%</b> vs last month</small><div className="spark green-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
            <article><div className="stat-head"><span className="stat-icon violet">▦</span><button>•••</button></div><p>STOCK VALUE</p><h2>Nu. 4,210,600</h2><small><mark className="redmark">12 items</mark> low in stock</small><div className="spark violet-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
          </div>

          <div className="dashboard-grid">
            <article className="activity card"><div className="card-title"><div><h3>Sales & Collections</h3><p>Monthly performance overview</p></div><div className="legend"><span><i className="leg-sales"></i>Sales</span><span><i className="leg-cash"></i>Collections</span><button>•••</button></div></div><div className="chart"><div className="ylabels"><span>800k</span><span>600k</span><span>400k</span><span>200k</span><span>0</span></div><div className="plot"><div className="gridline g1"></div><div className="gridline g2"></div><div className="gridline g3"></div><div className="gridline g4"></div><div className="chart-lines"><div className="line sales-line"></div><div className="line cash-line"></div><span className="point p1"></span><span className="point p2"></span></div><div className="xlabels"><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span></div></div></div></article>

            <article className="quick card"><div className="card-title"><div><h3>Quick Actions</h3><p>Record a transaction</p></div></div><div className="quick-grid"><button onClick={() => setModal("sale")}><i className="qa-blue">↗</i><span><strong>Sales Invoice</strong><small>Create a new bill</small></span></button><button onClick={() => setModal("payment")}><i className="qa-green">↓</i><span><strong>Receive Payment</strong><small>Cash, bank or cheque</small></span></button><button onClick={() => setNotice("Purchase form will open in the next module")}><i className="qa-orange">↙</i><span><strong>Add Purchase</strong><small>Stock or expense</small></span></button><button onClick={() => setNotice("Expense form will open in the next module")}><i className="qa-violet">◫</i><span><strong>Add Expense</strong><small>Record office expense</small></span></button></div></article>

            <article className="recent card"><div className="card-title"><div><h3>Recent Transactions</h3><p>Latest entries across all accounts</p></div><button className="link" onClick={() => setActive("Reports")}>View day book →</button></div><div className="table-wrap"><table><thead><tr><th>TYPE</th><th>PARTY / ACCOUNT</th><th>DATE</th><th>DEBIT</th><th>CREDIT</th><th></th></tr></thead><tbody>{transactions.map((t, i) => <tr key={i}><td><span className={`tx-icon t${i}`}>{["↗","↓","↙","↗","◫"][i]}</span><div><strong>{t.type}</strong><small>{t.ref}</small></div></td><td>{t.party}</td><td>{t.date}</td><td className="debit">{t.debit ? money(t.debit) : "—"}</td><td className="credit">{t.credit ? money(t.credit) : "—"}</td><td>•••</td></tr>)}</tbody></table></div></article>

            <article className="balances card"><div className="card-title"><div><h3>Top Outstanding</h3><p>Parties with pending balance</p></div><button className="link" onClick={() => setActive("Parties")}>View all →</button></div><div className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search party" /></div><div className="party-list">{visibleParties.map(p => <button key={p.name} onClick={() => { setFormParty(p.name); setModal("payment"); }}><span className={`avatar ${p.tone}`}>{p.initials}</span><span><strong>{p.name}</strong><small>{p.place}</small></span><span className={p.balance < 0 ? "advance" : "due"}><strong>{money(p.balance)}</strong><small>{p.balance < 0 ? "Advance" : "To receive"}</small></span></button>)}</div></article>
          </div>
        </div>
      </section>

      {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><section className="modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><small>{modal === "sale" ? "SALES" : "RECEIPT"}</small><h2>{modal === "sale" ? "Create sales invoice" : "Receive payment"}</h2></div><button onClick={() => setModal(null)}>×</button></div><div className="form-grid"><label className="full">Party / Customer<select value={formParty} onChange={e => setFormParty(e.target.value)}>{parties.map(p => <option key={p.name}>{p.name}</option>)}</select></label><label>Date<input type="date" defaultValue="2026-07-16" /></label><label>{modal === "sale" ? "Invoice no." : "Receipt no."}<input defaultValue={modal === "sale" ? "INV-2082" : "REC-0943"} /></label>{modal === "sale" ? <><label className="full">Product / Particulars<input placeholder="Search inventory or type custom item" /></label><label>Quantity<input type="number" defaultValue="1" /></label><label>Rate (Nu.)<input type="number" placeholder="0.00" /></label><label>Sale type<select><option>Credit</option><option>Cash</option></select></label><label>Payment received<input type="number" placeholder="Optional partial amount" /></label></> : <><label>Amount received (Nu.)<input type="number" placeholder="0.00" /></label><label>Payment mode<select><option>Cash</option><option>Bank transfer</option><option>Cheque</option></select></label><label className="full">Reference / Note<input placeholder="Cheque no., bank ref. or note" /></label></>}</div><div className="balance-note"><span>Current balance</span><strong>Nu. 1,842,500 Dr.</strong></div><div className="modal-actions"><button onClick={() => setModal(null)}>Cancel</button><button className="primary" onClick={() => save(modal === "sale" ? "Invoice" : "Receipt")}>{modal === "sale" ? "Save invoice" : "Save receipt"}</button></div></section></div>}
      {notice && <div className="toast">✓ {notice}</div>}
    </main>
  );
}
