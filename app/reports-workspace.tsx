"use client";

import { useEffect, useRef, useState } from "react";
import BsDateInput from "./bs-date-input";
import { formatBs, adToBsParts, bsToAd, bsMonths } from "../lib/nepali-date";
import { downloadCsv, printDocument } from "../lib/export-data";
import {
  getCachedJson,
  peekClientCache,
  invalidateClientCache,
} from "../lib/client-data-cache";

const money = (n: number) =>
  `Rs. ${Math.abs(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typeLabel: Record<string, string> = {
  sale: "Sales Invoice",
  sale_return: "Sales Return",
  receipt: "Payment Receipt",
  cheque_adjustment: "Cheque Cancelled",
  payment: "Payment Given",
  purchase: "Purchase Invoice",
  purchase_return: "Purchase Return",
  expense: "Office Expense",
  journal: "Journal",
  contra: "Contra",
  stock_adjustment: "Stock Journal",
  payroll: "Payroll Voucher",
};
const reportLabel: Record<string, string> = {
  daybook: "Day book",
  sales: "Sales register",
  sales_returns: "Sales return register",
  purchases: "Purchase register",
  purchase_returns: "Purchase return register",
  payments: "Payment receipt register",
  expenses: "Expense register",
  journals: "Journal register",
  contra: "Contra register",
  stock_adjustments: "Stock journal register",
  payroll: "Payroll register",
  general_ledger: "General ledger",
  trial_balance: "Trial balance",
  group_summary: "Account group summary",
  balance_sheet: "Balance sheet",
  profit_loss: "Profit & loss",
  aging_receivable: "Receivable ageing",
  aging_payable: "Payable ageing",
  stock_statement: "Stock statement",
  stock_movement: "Stock movement",
  tax_summary: "Tax summary",
  monthly_accounting: "मासिक हिसाबी",
  party_summary: "Party trading & balance summary",
  payments_given: "Payments given",
};
const businessDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export default function ReportsWorkspace({
  parties,
  fiscalYear,
  initialPartyId,
  onNotice,
}: {
  parties: any[];
  fiscalYear: any;
  initialPartyId: string;
  onNotice: (x: string) => void;
}) {
  const now =
    businessDate() < fiscalYear.start_ad
      ? fiscalYear.start_ad
      : businessDate() > fiscalYear.end_ad
        ? fiscalYear.end_ad
        : businessDate();
  const [partyId, setPartyId] = useState(initialPartyId || "");
  const [type, setType] = useState("daybook");
  const [monthOffset, setMonthOffset] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState<"today" | "fy" | "custom" | "month">(
    initialPartyId ? "fy" : "today",
  );
  const [from, setFrom] = useState(
    initialPartyId ? fiscalYear?.start_ad || now : now,
  );
  const [to, setTo] = useState(
    initialPartyId ? fiscalYear?.end_ad || now : now,
  );
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  async function classifyBill(voucherId: string, billCategory: string) {
    try {
      const response = await fetch("/api/accounting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "bill_classification",
          voucherId,
          billCategory,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Classification failed");
      invalidateClientCache();
      await run();
      onNotice("Bill classification saved; amounts unchanged");
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Could not classify bill",
      );
    }
  }

  useEffect(() => {
    if (initialPartyId) setPartyId(initialPartyId);
    setPreset(initialPartyId ? "fy" : "today");
    setFrom(initialPartyId ? fiscalYear.start_ad : now);
    setTo(initialPartyId ? fiscalYear.end_ad : now);
    setData(null);
    setMonthOffset(0);
    return () => requestRef.current?.abort();
  }, [initialPartyId, fiscalYear?.id]);
  useEffect(() => {
    if (!fiscalYear?.id) return;
    const timer = setTimeout(run, 80);
    return () => clearTimeout(timer);
  }, [partyId, type, accountId, from, to, fiscalYear?.id]);
  const firstMonth = adToBsParts(fiscalYear.start_ad);
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const m = firstMonth.month - 1 + i;
    return { year: firstMonth.year + Math.floor(m / 12), month: (m % 12) + 1 };
  });
  function chooseMonth(index: number) {
    setMonthOffset(index);
    setPreset("month");
    const m = monthOptions[index];
    const next =
      m.month === 12
        ? { year: m.year + 1, month: 1 }
        : { year: m.year, month: m.month + 1 };
    const start = bsToAd(m.year, m.month, 1);
    const endDate = new Date(bsToAd(next.year, next.month, 1) + "T12:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    setFrom(start);
    setTo(endDate.toISOString().slice(0, 10));
  }
  function choosePreset(value: "today" | "fy" | "custom" | "month") {
    setPreset(value);
    if (value === "month") {
      chooseMonth(monthOffset);
    }
    if (value === "today") {
      setFrom(now);
      setTo(now);
    }
    if (value === "fy") {
      setFrom(fiscalYear.start_ad);
      setTo(fiscalYear.end_ad);
    }
  }
  const partyFilterReports = [
    "daybook",
    "sales",
    "sales_returns",
    "purchases",
    "purchase_returns",
    "payments",
    "payments_given",
    "expenses",
    "party_summary",
    "aging_receivable",
    "aging_payable",
    "monthly_accounting",
  ];
  async function run() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const q = new URLSearchParams({
        fiscalYearId: fiscalYear.id,
        type,
        from,
        to,
      });
      if (partyId && partyFilterReports.includes(type))
        q.set("partyId", partyId);
      if (accountId && type === "general_ledger") q.set("accountId", accountId);
      const key = `reports:${q}`;
      const cached = peekClientCache<any>(key);
      setData(cached || null);
      setLoading(!cached);
      const d = await getCachedJson<any>(key, `/api/reports?${q}`, {
        maxAgeMs: 45_000,
      });
      if (!controller.signal.aborted) setData(d);
    } catch (e) {
      if ((e as any)?.name !== "AbortError")
        onNotice(e instanceof Error ? e.message : "Report could not load");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }
  function exportReport() {
    if (!data?.rows?.length) {
      onNotice("There is no report data to download");
      return;
    }
    const name = `${type}-${data.party?.name || "all"}-${from}-to-${to}`;
    if (type === "monthly_accounting") {
      downloadCsv(name, data.bills, [
        { label: "Date BS", value: (r: any) => formatBs(r.voucher_date) },
        { label: "Document", value: (r: any) => r.voucher_type },
        { label: "Reference", value: (r: any) => r.voucher_no },
        { label: "Supplier bill", value: (r: any) => r.supplier_bill_no },
        { label: "Party", value: (r: any) => r.parties?.name },
        { label: "PAN/VAT no.", value: (r: any) => r.parties?.tax_no },
        { label: "Bill type", value: (r: any) => r.category },
        { label: "Before tax", value: (r: any) => r.base },
        { label: "Taxable", value: (r: any) => r.taxable },
        { label: "Non-VAT base", value: (r: any) => r.nonTaxable },
        { label: "VAT", value: (r: any) => r.tax },
        { label: "Total", value: (r: any) => r.gross },
      ]);
    } else if (type === "party_summary")
      downloadCsv(
        name,
        data.rows,
        [
          "party",
          "opening",
          "sales",
          "salesReturns",
          "purchases",
          "purchaseReturns",
          "receipts",
          "payments",
          "debit",
          "credit",
          "closing",
        ].map((k) => ({ label: k, value: (r: any) => r[k] })),
      );
    else if (type === "trial_balance")
      downloadCsv(name, data.rows, [
        { label: "Code", value: (r: any) => r.code },
        { label: "Account", value: (r: any) => r.name },
        { label: "Opening Dr", value: (r: any) => r.openingDebit },
        { label: "Opening Cr", value: (r: any) => r.openingCredit },
        { label: "Period Dr", value: (r: any) => r.debit },
        { label: "Period Cr", value: (r: any) => r.credit },
        { label: "Closing Dr", value: (r: any) => r.closingDebit },
        { label: "Closing Cr", value: (r: any) => r.closingCredit },
      ]);
    else if (type === "general_ledger")
      downloadCsv(name, data.rows, [
        { label: "Date (BS)", value: (r: any) => formatBs(r.date) },
        { label: "Reference", value: (r: any) => r.ref },
        {
          label: "Account",
          value: (r: any) => `${r.accountCode} ${r.accountName}`,
        },
        { label: "Particulars", value: (r: any) => r.particulars },
        { label: "Debit", value: (r: any) => r.debit },
        { label: "Credit", value: (r: any) => r.credit },
        { label: "Balance", value: (r: any) => r.balance ?? "" },
      ]);
    else if (["balance_sheet", "profit_loss", "group_summary"].includes(type))
      downloadCsv(name, data.rows, [
        { label: "Code", value: (r: any) => r.code },
        { label: "Account", value: (r: any) => r.name },
        { label: "Group", value: (r: any) => r.account_type },
        { label: "Debit", value: (r: any) => r.debit },
        { label: "Credit", value: (r: any) => r.credit },
        { label: "Balance", value: (r: any) => r.balance },
      ]);
    else if (type.startsWith("aging_"))
      downloadCsv(name, data.rows, [
        { label: "Party", value: (r: any) => r.party },
        { label: "Place", value: (r: any) => r.place },
        { label: "Not due", value: (r: any) => r.notDue },
        { label: "Unknown opening age", value: (r: any) => r.unknown },
        { label: "0-30 days", value: (r: any) => r.current },
        { label: "31-60 days", value: (r: any) => r.days31to60 },
        { label: "61-90 days", value: (r: any) => r.days61to90 },
        { label: "Above 90 days", value: (r: any) => r.above90 },
        { label: "Outstanding", value: (r: any) => r.total },
      ]);
    else if (type === "stock_statement")
      downloadCsv(name, data.rows, [
        { label: "SKU", value: (r: any) => r.sku },
        { label: "Item", value: (r: any) => r.name },
        { label: "Unit", value: (r: any) => r.unit },
        { label: "Opening", value: (r: any) => r.opening },
        { label: "Inward", value: (r: any) => r.inward },
        { label: "Outward", value: (r: any) => r.outward },
        { label: "Closing", value: (r: any) => r.closing },
        { label: "Stock value", value: (r: any) => r.stockValue },
      ]);
    else if (type === "stock_movement")
      downloadCsv(name, data.rows, [
        { label: "Date (BS)", value: (r: any) => formatBs(r.movement_date) },
        { label: "Reference", value: (r: any) => r.reference },
        { label: "Item", value: (r: any) => r.product?.name },
        { label: "Movement", value: (r: any) => r.voucherType },
        { label: "Quantity", value: (r: any) => r.quantity },
        { label: "Unit cost", value: (r: any) => r.unitCost },
        { label: "Notes", value: (r: any) => r.notes },
      ]);
    else if (type === "tax_summary")
      downloadCsv(name, data.rows, [
        { label: "Particular", value: (r: any) => r.label },
        { label: "Taxable amount", value: (r: any) => r.taxable },
        { label: "Tax", value: (r: any) => r.tax },
        { label: "Gross", value: (r: any) => r.total },
      ]);
    else
      downloadCsv(name, data.rows, [
        { label: "Date (BS)", value: (r: any) => formatBs(r.date) },
        { label: "Reference", value: (r: any) => r.ref },
        { label: "Type", value: (r: any) => typeLabel[r.type] || r.type },
        { label: "Party", value: (r: any) => r.party },
        { label: "Particulars", value: (r: any) => r.particulars },
        { label: "Debit", value: (r: any) => r.debit },
        { label: "Credit", value: (r: any) => r.credit },
        { label: "Balance", value: (r: any) => r.balance ?? "" },
      ]);
  }
  const balance = Number(data?.closing || 0);
  return (
    <section className="reports-workspace">
      <div className="module-hero report-hero">
        <div>
          <span>
            {partyId && partyFilterReports.includes(type)
              ? "PARTY LEDGER"
              : "ACCOUNTING REPORTS"}
          </span>
          <h2>{data?.party?.name || reportLabel[type]}</h2>
          <p>
            {partyId && data?.party
              ? [
                  data.party.place,
                  data.party.phone,
                  data.party.tax_no ? `PAN: ${data.party.tax_no}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                "Complete debit, credit and running balance statement."
              : "Auditable double-entry, ageing, tax and stock reports for the selected fiscal period."}
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="primary soft"
            disabled={loading || !data}
            onClick={exportReport}
          >
            ⇩ Excel / CSV
          </button>
          <button
            className="primary"
            disabled={loading || !data}
            onClick={() => printDocument("report")}
          >
            Print / PDF
          </button>
        </div>
      </div>
      <article className="card report-filters">
        <label>
          Report
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "monthly_accounting")
                chooseMonth(monthOffset);
            }}
          >
            <optgroup label="Books & vouchers">
              <option value="daybook">Full Day Book</option>
              <option value="general_ledger">General Ledger</option>
              <option value="trial_balance">Trial Balance</option>
              <option value="group_summary">Account Group Summary</option>
              <option value="journals">Journal Register</option>
              <option value="contra">Contra Register</option>
              <option value="payroll">Payroll Register</option>
            </optgroup>
            <optgroup label="Financial statements">
              <option value="balance_sheet">Balance Sheet</option>
              <option value="profit_loss">Profit & Loss</option>
              <option value="tax_summary">Tax Summary</option>
              <option value="monthly_accounting">
                मासिक हिसाबी · VAT/PAN report
              </option>
              <option value="party_summary">
                Party trading & balance summary
              </option>
            </optgroup>
            <optgroup label="Sales & purchase">
              <option value="sales">Sales Register</option>
              <option value="sales_returns">Sales Return Register</option>
              <option value="purchases">Purchase Register</option>
              <option value="purchase_returns">Purchase Return Register</option>
              <option value="payments">Payment Receipt Register</option>
              <option value="payments_given">Payments Given Register</option>
              <option value="expenses">Expense Register</option>
            </optgroup>
            <optgroup label="Outstanding">
              <option value="aging_receivable">Receivable Ageing</option>
              <option value="aging_payable">Payable Ageing</option>
            </optgroup>
            <optgroup label="Inventory">
              <option value="stock_statement">Stock Statement</option>
              <option value="stock_movement">Stock Movement</option>
              <option value="stock_adjustments">Stock Journal Register</option>
            </optgroup>
          </select>
        </label>
        {partyFilterReports.includes(type) && (
          <label>
            Party / Client
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              <option value="">All parties</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "general_ledger" && (
          <label>
            Ledger account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">All accounts</option>
              {data?.accounts?.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Period
          <select
            value={preset}
            onChange={(e) => choosePreset(e.target.value as any)}
          >
            <option value="month">BS month</option>
            <option value="today">Today</option>
            <option value="fy">Full fiscal year</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {preset === "month" && (
          <label>
            BS month
            <select
              value={monthOffset}
              onChange={(e) => chooseMonth(Number(e.target.value))}
            >
              {monthOptions.map((m, i) => (
                <option key={i} value={i}>
                  {bsMonths[m.month - 1]} {m.year}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          From (BS)
          <BsDateInput
            min={fiscalYear.start_ad}
            max={fiscalYear.end_ad}
            value={from}
            onChange={(value) => {
              setPreset("custom");
              setFrom(value);
            }}
          />
        </label>
        <label>
          To (BS)
          <BsDateInput
            min={fiscalYear.start_ad}
            max={fiscalYear.end_ad}
            value={to}
            onChange={(value) => {
              setPreset("custom");
              setTo(value);
            }}
          />
        </label>
        <button onClick={run} disabled={loading}>
          {loading ? "Loading…" : "Apply report"}
        </button>
      </article>
      {partyId && data && type === "daybook" && (
        <div className="ledger-summary">
          <article>
            <small>OPENING BALANCE</small>
            <strong>{money(data.opening)}</strong>
            <span>{data.opening >= 0 ? "Debit" : "Credit"}</span>
          </article>
          <article>
            <small>PERIOD DEBIT</small>
            <strong>{money(data.totals.debit)}</strong>
            <span>Sales / receivable</span>
          </article>
          <article>
            <small>PERIOD CREDIT</small>
            <strong>{money(data.totals.credit)}</strong>
            <span>Receipts / payable</span>
          </article>
          <article className={balance >= 0 ? "receive" : "pay"}>
            <small>CLOSING BALANCE</small>
            <strong>{money(balance)}</strong>
            <span>
              {balance >= 0 ? "To receive from party" : "To pay party"}
            </span>
          </article>
        </div>
      )}
      {data &&
        [
          "sales",
          "sales_returns",
          "purchases",
          "purchase_returns",
          "payments",
          "payments_given",
          "expenses",
          "daybook",
        ].includes(type) &&
        (!partyId || type !== "daybook") && (
          <div className="ledger-summary">
            <article>
              <small>ENTRIES</small>
              <strong>{data.rows.length}</strong>
            </article>
            <article>
              <small>PERIOD DEBIT</small>
              <strong>{money(data.totals.debit)}</strong>
            </article>
            <article>
              <small>PERIOD CREDIT</small>
              <strong>{money(data.totals.credit)}</strong>
            </article>
            <article>
              <small>DOCUMENT TOTAL</small>
              <strong>
                {data.totals.amount == null ? "—" : money(data.totals.amount)}
              </strong>
            </article>
          </div>
        )}
      {data?.basis && <p role="note">{data.basis}</p>}
      {type === "trial_balance" && data && (
        <div className="ledger-summary">
          <article>
            <small>PERIOD DEBIT</small>
            <strong>{money(data.totals.debit)}</strong>
          </article>
          <article>
            <small>PERIOD CREDIT</small>
            <strong>{money(data.totals.credit)}</strong>
          </article>
          <article>
            <small>CLOSING DEBIT</small>
            <strong>{money(data.totals.closingDebit)}</strong>
          </article>
          <article className={data.balanced ? "receive" : "pay"}>
            <small>CONTROL CHECK</small>
            <strong>{data.balanced ? "Balanced" : "Out of balance"}</strong>
          </article>
        </div>
      )}
      {type === "monthly_accounting" ? (
        <MonthlyAccountingTable
          data={data}
          loading={loading}
          onClassify={classifyBill}
        />
      ) : type === "party_summary" ? (
        <PartySummaryTable data={data} loading={loading} />
      ) : type === "trial_balance" ? (
        <TrialBalanceTable data={data} loading={loading} from={from} to={to} />
      ) : type === "general_ledger" ? (
        <GeneralLedgerTable
          data={data}
          loading={loading}
          from={from}
          to={to}
          accountId={accountId}
        />
      ) : type.startsWith("aging_") ? (
        <AgingTable
          data={data}
          loading={loading}
          payable={type === "aging_payable"}
        />
      ) : type === "stock_statement" ? (
        <StockStatementTable data={data} loading={loading} />
      ) : type === "stock_movement" ? (
        <StockMovementTable data={data} loading={loading} />
      ) : ["balance_sheet", "profit_loss", "group_summary"].includes(type) ? (
        <FinancialStatementTable data={data} loading={loading} type={type} />
      ) : type === "tax_summary" ? (
        <TaxSummaryTable data={data} loading={loading} />
      ) : (
        <VoucherReportTable
          data={data}
          loading={loading}
          from={from}
          to={to}
          partyId={type === "daybook" ? partyId : ""}
          type={type}
        />
      )}
    </section>
  );
}

function TrialBalanceTable({
  data,
  loading,
  from,
  to,
}: {
  data: any;
  loading: boolean;
  from: string;
  to: string;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>Trial balance</h3>
          <p>
            {formatBs(from)} देखि {formatBs(to)} · Debit and credit control
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CODE</th>
              <th>ACCOUNT</th>
              <th>OPENING DR</th>
              <th>OPENING CR</th>
              <th>PERIOD DR</th>
              <th>PERIOD CR</th>
              <th>CLOSING DR</th>
              <th>CLOSING CR</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.code}</strong>
                  </td>
                  <td>
                    {r.name}
                    <small className="table-subtitle">{r.accountType}</small>
                  </td>
                  <td>{r.openingDebit ? money(r.openingDebit) : "—"}</td>
                  <td>{r.openingCredit ? money(r.openingCredit) : "—"}</td>
                  <td className="debit">{r.debit ? money(r.debit) : "—"}</td>
                  <td className="credit">{r.credit ? money(r.credit) : "—"}</td>
                  <td>{r.closingDebit ? money(r.closingDebit) : "—"}</td>
                  <td>{r.closingCredit ? money(r.closingCredit) : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={8}>
                  {loading
                    ? "Loading trial balance…"
                    : "No posted transactions for this period."}
                </td>
              </tr>
            )}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Total</strong>
                </td>
                <td>{money(data.totals.openingDebit)}</td>
                <td>{money(data.totals.openingCredit)}</td>
                <td>{money(data.totals.debit)}</td>
                <td>{money(data.totals.credit)}</td>
                <td>{money(data.totals.closingDebit)}</td>
                <td>{money(data.totals.closingCredit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function GeneralLedgerTable({
  data,
  loading,
  from,
  to,
  accountId,
}: {
  data: any;
  loading: boolean;
  from: string;
  to: string;
  accountId: string;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>General ledger</h3>
          <p>
            {formatBs(from)} देखि {formatBs(to)} · {data?.rows?.length || 0}{" "}
            journal lines
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE (BS)</th>
              <th>REFERENCE</th>
              <th>ACCOUNT</th>
              <th>PARTICULARS</th>
              <th>DEBIT</th>
              <th>CREDIT</th>
              {accountId && <th>BALANCE</th>}
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td>{formatBs(r.date)}</td>
                  <td>
                    <strong>{r.ref}</strong>
                  </td>
                  <td>
                    {r.accountCode} · {r.accountName}
                  </td>
                  <td>{r.particulars}</td>
                  <td className="debit">{r.debit ? money(r.debit) : "—"}</td>
                  <td className="credit">{r.credit ? money(r.credit) : "—"}</td>
                  {accountId && (
                    <td>
                      <strong>
                        {money(r.balance)} {r.balance >= 0 ? "Dr" : "Cr"}
                      </strong>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={accountId ? 7 : 6}>
                  {loading
                    ? "Loading general ledger…"
                    : "No journal lines for this filter."}
                </td>
              </tr>
            )}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <strong>Period total</strong>
                </td>
                <td>{money(data.totals.debit)}</td>
                <td>{money(data.totals.credit)}</td>
                {accountId && <td>{money(data.closing)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function VoucherReportTable({
  data,
  loading,
  from,
  to,
  partyId,
  type,
}: {
  data: any;
  loading: boolean;
  from: string;
  to: string;
  partyId: string;
  type: string;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>
            {partyId
              ? "Ledger statement"
              : reportLabel[type] || "Voucher register"}
          </h3>
          <p>
            {formatBs(from)} देखि {formatBs(to)} · {data?.rows?.length || 0}{" "}
            entries
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE (BS)</th>
              <th>REFERENCE</th>
              <th>TYPE</th>
              {!partyId && <th>PARTY / ACCOUNT</th>}
              <th>PARTICULARS</th>
              <th>DEBIT</th>
              <th>CREDIT</th>
              {partyId && <th>BALANCE</th>}
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td>{formatBs(r.date)}</td>
                  <td>
                    <strong>{r.ref}</strong>
                  </td>
                  <td>{typeLabel[r.type] || r.type}</td>
                  {!partyId && <td>{r.party}</td>}
                  <td>
                    {r.particulars}
                    {r.paymentMode ? ` · ${r.paymentMode}` : ""}
                  </td>
                  <td className="debit">{r.debit ? money(r.debit) : "—"}</td>
                  <td className="credit">{r.credit ? money(r.credit) : "—"}</td>
                  {partyId && (
                    <td>
                      <strong>
                        {money(r.balance)} {r.balance >= 0 ? "Dr" : "Cr"}
                      </strong>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={partyId ? 8 : 7}>
                  {loading
                    ? "Loading report…"
                    : "No transactions for this filter."}
                </td>
              </tr>
            )}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={partyId ? 4 : 5}>
                  <strong>Period total</strong>
                </td>
                <td className="debit">
                  <strong>{money(data.totals.debit)}</strong>
                </td>
                <td className="credit">
                  <strong>{money(data.totals.credit)}</strong>
                </td>
                {partyId && (
                  <td>
                    <strong>{money(data.closing)}</strong>
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function AgingTable({
  data,
  loading,
  payable,
}: {
  data: any;
  loading: boolean;
  payable: boolean;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>{payable ? "Aged payable" : "Aged receivable"}</h3>
          <p>
            Net party FIFO · overdue days as of{" "}
            {data?.to ? formatBs(data.to) : "selected date"}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PARTY</th>
              <th>PLACE / PHONE</th>
              <th>NOT DUE</th>
              <th>OPENING AGE UNKNOWN</th>
              <th>0–30 DAYS</th>
              <th>31–60 DAYS</th>
              <th>61–90 DAYS</th>
              <th>ABOVE 90 DAYS</th>
              <th>OUTSTANDING</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.party}</strong>
                  </td>
                  <td>
                    {[row.place, row.phone].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td>{row.notDue ? money(row.notDue) : "—"}</td>
                  <td>{row.unknown ? money(row.unknown) : "—"}</td>
                  <td>{row.current ? money(row.current) : "—"}</td>
                  <td>{row.days31to60 ? money(row.days31to60) : "—"}</td>
                  <td>{row.days61to90 ? money(row.days61to90) : "—"}</td>
                  <td className="debit">
                    {row.above90 ? money(row.above90) : "—"}
                  </td>
                  <td>
                    <strong>{money(row.total)}</strong>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={9}>
                  {loading ? "Calculating ageing…" : "No outstanding amount."}
                </td>
              </tr>
            )}
          </tbody>
          {data?.totals && (
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Total</strong>
                </td>
                <td>{money(data.totals.notDue)}</td>
                <td>{money(data.totals.unknown)}</td>
                <td>{money(data.totals.current)}</td>
                <td>{money(data.totals.days31to60)}</td>
                <td>{money(data.totals.days61to90)}</td>
                <td>{money(data.totals.above90)}</td>
                <td>
                  <strong>{money(data.totals.total)}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function FinancialStatementTable({
  data,
  loading,
  type,
}: {
  data: any;
  loading: boolean;
  type: string;
}) {
  const title = reportLabel[type];
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>{title}</h3>
          <p>
            {type === "balance_sheet"
              ? `As of ${data?.to ? formatBs(data.to) : "—"}`
              : `${data?.from ? formatBs(data.from) : "—"} देखि ${data?.to ? formatBs(data.to) : "—"}`}
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CODE</th>
              <th>ACCOUNT</th>
              <th>GROUP</th>
              <th>DEBIT</th>
              <th>CREDIT</th>
              <th>BALANCE</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.code}</strong>
                  </td>
                  <td>{row.name}</td>
                  <td className="capitalize">{row.account_type}</td>
                  <td>{row.debit ? money(row.debit) : "—"}</td>
                  <td>{row.credit ? money(row.credit) : "—"}</td>
                  <td>
                    <strong>
                      {row.balance < 0 ? "−" : ""}
                      {money(row.balance)}
                    </strong>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={6}>
                  {loading
                    ? "Preparing financial statement…"
                    : "No posted balance for this period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data?.totals && (
        <div className="statement-summary">
          {type === "profit_loss" ? (
            <>
              <span>
                Income <strong>{money(data.totals.income)}</strong>
              </span>
              <span>
                Expenses <strong>{money(data.totals.expenses)}</strong>
              </span>
              <span className={data.totals.netProfit >= 0 ? "profit" : "loss"}>
                Net {data.totals.netProfit >= 0 ? "profit" : "loss"}{" "}
                <strong>{money(data.totals.netProfit)}</strong>
              </span>
            </>
          ) : type === "balance_sheet" ? (
            <>
              <span>
                Assets <strong>{money(data.totals.assets)}</strong>
              </span>
              <span>
                Liabilities <strong>{money(data.totals.liabilities)}</strong>
              </span>
              <span>
                Equity + retained earnings{" "}
                <strong>
                  {money(data.totals.equity + data.totals.retainedEarnings)}
                </strong>
              </span>
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}

function StockStatementTable({
  data,
  loading,
}: {
  data: any;
  loading: boolean;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>Stock statement</h3>
          <p>
            Opening, inward, outward and closing quantity. Value is an estimate
            at the current recorded unit cost, not a historical valuation.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>ITEM</th>
              <th>TYPE</th>
              <th>OPENING</th>
              <th>INWARD</th>
              <th>OUTWARD</th>
              <th>CLOSING</th>
              <th>VALUE</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((row: any) => (
                <tr key={row.id}>
                  <td>{row.sku || "—"}</td>
                  <td>
                    <strong>{row.name}</strong>
                    <small className="table-subtitle">{row.unit}</small>
                  </td>
                  <td>{row.item_type?.replaceAll("_", " ")}</td>
                  <td>{row.opening}</td>
                  <td className="credit">{row.inward || "—"}</td>
                  <td className="debit">{row.outward || "—"}</td>
                  <td>
                    <strong>{row.closing}</strong>
                  </td>
                  <td>{money(row.stockValue)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={8}>
                  {loading ? "Calculating stock…" : "No inventory items."}
                </td>
              </tr>
            )}
          </tbody>
          {data?.totals && (
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>Total</strong>
                </td>
                <td>{data.totals.opening}</td>
                <td>{data.totals.inward}</td>
                <td>{data.totals.outward}</td>
                <td>{data.totals.closing}</td>
                <td>
                  <strong>{money(data.totals.stockValue)}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function StockMovementTable({
  data,
  loading,
}: {
  data: any;
  loading: boolean;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>Stock movement</h3>
          <p>Voucher-wise item audit trail</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE (BS)</th>
              <th>REFERENCE</th>
              <th>ITEM</th>
              <th>SOURCE</th>
              <th>QUANTITY</th>
              <th>UNIT COST</th>
              <th>NOTES</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((row: any) => (
                <tr key={row.id}>
                  <td>{formatBs(row.movement_date)}</td>
                  <td>
                    <strong>{row.reference}</strong>
                  </td>
                  <td>{row.product?.name || "—"}</td>
                  <td>{typeLabel[row.voucherType] || row.voucherType}</td>
                  <td className={row.quantity >= 0 ? "credit" : "debit"}>
                    {row.quantity >= 0 ? "+" : ""}
                    {row.quantity} {row.product?.unit}
                  </td>
                  <td>{money(row.unitCost)}</td>
                  <td>{row.notes || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={7}>
                  {loading
                    ? "Loading stock movements…"
                    : "No stock movement in this period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function TaxSummaryTable({ data, loading }: { data: any; loading: boolean }) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>Tax summary</h3>
          <p>Output tax less input tax, including returns</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PARTICULAR</th>
              <th>TAXABLE AMOUNT</th>
              <th>TAX</th>
              <th>GROSS</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.length ? (
              data.rows.map((row: any) => (
                <tr key={row.label}>
                  <td>
                    <strong>{row.label}</strong>
                  </td>
                  <td>{money(row.taxable)}</td>
                  <td>{money(row.tax)}</td>
                  <td>{money(row.total)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-year" colSpan={4}>
                  {loading
                    ? "Preparing tax report…"
                    : "No taxable vouchers in this period."}
                </td>
              </tr>
            )}
          </tbody>
          {data?.totals && (
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Net tax payable</strong>
                </td>
                <td colSpan={2}>
                  <strong>{money(data.totals.netTaxPayable)}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  );
}

function MonthlyAccountingTable({
  data,
  loading,
  onClassify,
}: {
  data: any;
  loading: boolean;
  onClassify: (id: string, category: string) => Promise<void>;
}) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>मासिक हिसाबी · VAT / PAN / non-VAT</h3>
          <p>
            {data?.from ? formatBs(data.from) : ""} —{" "}
            {data?.to ? formatBs(data.to) : ""} · Returns shown separately;
            totals are net of returns.
          </p>
          {data?.totals?.unclassifiedCount > 0 && (
            <p role="status">
              {data.totals.unclassifiedCount} older bills need classification
              before this report is handed to the accountant.
            </p>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>BOOK</th>
              <th>BILL TYPE</th>
              <th>COUNT</th>
              <th>BEFORE TAX</th>
              <th>TAXABLE BASE</th>
              <th>NON-VAT BASE</th>
              <th>VAT</th>
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.map((r: any) => (
              <tr key={r.key}>
                <td>
                  {r.side}
                  {r.isReturn ? " · Return" : ""}
                </td>
                <td>{r.label}</td>
                <td>{r.count}</td>
                <td>{money(r.base)}</td>
                <td>{money(r.taxable)}</td>
                <td>{money(r.nonTaxable)}</td>
                <td>{money(r.tax)}</td>
                <td>{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.rows?.length && (
          <p className="empty-year">
            {loading
              ? "Preparing monthly accounts…"
              : "No bills in this period."}
          </p>
        )}
      </div>
      {data?.totals && (
        <div className="statement-summary">
          <span>
            Sales bills <strong>{data.totals.salesCount}</strong>
          </span>
          <span>
            Purchase bills <strong>{data.totals.purchaseCount}</strong>
          </span>
          <span>
            Output VAT <strong>{money(data.totals.outputTax)}</strong>
          </span>
          <span>
            Input VAT <strong>{money(data.totals.inputTax)}</strong>
          </span>
          <span>
            Net VAT {data.totals.netTax < 0 ? "credit" : "payable"}{" "}
            <strong>{money(data.totals.netTax)}</strong>
          </span>
        </div>
      )}
      <details>
        <summary>View source bills ({data?.bills?.length || 0})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DATE BS</th>
                <th>BILL</th>
                <th>PARTY / PAN</th>
                <th>CLASS</th>
                <th>BEFORE TAX</th>
                <th>VAT</th>
                <th>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {data?.bills?.map((b: any) => (
                <tr key={b.id}>
                  <td>{formatBs(b.voucher_date)}</td>
                  <td>
                    {b.voucher_type} #{b.supplier_bill_no || b.voucher_no}
                  </td>
                  <td>
                    {b.parties?.name}
                    <small>{b.parties?.tax_no}</small>
                  </td>
                  <td>
                    <span>{b.category}</span>
                    {["sale", "purchase"].includes(b.voucher_type) && (
                      <BillClassPicker bill={b} onSave={onClassify} />
                    )}
                  </td>
                  <td>{money(b.base)}</td>
                  <td>{money(b.tax)}</td>
                  <td>{money(b.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
function PartySummaryTable({ data, loading }: { data: any; loading: boolean }) {
  return (
    <article className="card report-table">
      <div className="card-title">
        <div>
          <h3>Party trading & balances</h3>
          <p>
            Opening + debits − credits = closing. Positive is receivable;
            negative is payable.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Party",
                "Opening Dr/Cr",
                "Sales",
                "Sales returns",
                "Purchases",
                "Purchase returns",
                "Receipts",
                "Payments",
                "Debit",
                "Credit",
                "Closing Dr/Cr",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows?.map((r: any) => (
              <tr key={r.id}>
                <td>{r.party}</td>
                {[
                  "opening",
                  "sales",
                  "salesReturns",
                  "purchases",
                  "purchaseReturns",
                  "receipts",
                  "payments",
                  "debit",
                  "credit",
                  "closing",
                ].map((k) => (
                  <td key={k}>
                    {money(r[k])}
                    {["opening", "closing"].includes(k)
                      ? r[k] >= 0
                        ? " Dr"
                        : " Cr"
                      : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.rows?.length && (
          <p className="empty-year">
            {loading ? "Loading party accounts…" : "No party accounts."}
          </p>
        )}
      </div>
    </article>
  );
}

function BillClassPicker({
  bill,
  onSave,
}: {
  bill: any;
  onSave: (id: string, category: string) => Promise<void>;
}) {
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <select
        aria-label={`Classify bill ${bill.voucher_no}`}
        value={category}
        disabled={saving}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">Choose classification</option>
        <option value="vat">VAT bill</option>
        {bill.voucher_type === "purchase" && (
          <option value="pan">PAN bill</option>
        )}
        <option value="non_vat">Non-VAT bill</option>
      </select>
      <button
        disabled={!category || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(bill.id, category);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save class"}
      </button>
    </div>
  );
}
