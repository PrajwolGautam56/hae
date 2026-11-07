"use client";

import { useState } from "react";
import { overviewTotals, type OverviewMonth } from "../lib/overview-model";
import "./overview-analytics.css";

const metrics = [
  { key: "sales", label: "Net sales", color: "#4267e8", target: "Sales" },
  {
    key: "purchases",
    label: "Net purchases",
    color: "#ee9561",
    target: "Purchases",
  },
  { key: "expenses", label: "Expenses", color: "#9470d8", target: "Expenses" },
  {
    key: "collections",
    label: "Collections",
    color: "#1b9d89",
    target: "Payments",
  },
] as const;
type Metric = (typeof metrics)[number]["key"];
const money = (n: number) =>
  `Rs. ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const short = (n: number) =>
  Math.abs(n) >= 100000
    ? `${(n / 100000).toFixed(1)}L`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toFixed(1)}K`
      : String(Math.round(n));

function Donut({
  title,
  subtitle,
  items,
  onOpen,
}: {
  title: string;
  subtitle: string;
  items: { label: string; value: number; color: string; target: string }[];
  onOpen: (target: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const active = items.find((i) => i.label === selected && i.value > 0);
  return (
    <article className="oa-donut-card">
      <div className="oa-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="oa-donut-content">
        <div className="oa-ring">
          <svg
            viewBox="0 0 180 180"
            aria-label={`${title}: ${money(total)}`}
            role="img"
          >
            <circle
              cx="90"
              cy="90"
              r="69"
              fill="none"
              stroke="#eef1f6"
              strokeWidth="19"
            />
            {items.map((item, index) => {
              const portion = total
                ? (Math.max(0, item.value) / total) * 100
                : 0;
              const start = total
                ? (items
                    .slice(0, index)
                    .reduce(
                      (sum, previous) => sum + Math.max(0, previous.value),
                      0,
                    ) /
                    total) *
                  100
                : 0;
              return (
                portion > 0 && (
                  <circle
                    key={item.label}
                    cx="90"
                    cy="90"
                    r="69"
                    fill="none"
                    stroke={item.color}
                    strokeWidth={active?.label === item.label ? 24 : 19}
                    pathLength="100"
                    strokeDasharray={`${portion} ${100 - portion}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 90 90)"
                    onPointerEnter={() => setSelected(item.label)}
                    onClick={() => setSelected(item.label)}
                  >
                    <title>
                      {item.label}: {money(item.value)}
                    </title>
                  </circle>
                )
              );
            })}
          </svg>
          <div className="oa-ring-label" aria-live="polite">
            <small>{active?.label || "Total"}</small>
            <strong>{money(active?.value ?? total)}</strong>
            <span>
              {active && total
                ? `${((active.value / total) * 100).toFixed(1)}% of total`
                : total
                  ? "Selected period"
                  : "No records yet"}
            </span>
          </div>
        </div>
        <div className="oa-breakdown">
          {items.map((item) => (
            <button
              key={item.label}
              className={active?.label === item.label ? "selected" : ""}
              onClick={() =>
                setSelected(selected === item.label ? null : item.label)
              }
              aria-pressed={active?.label === item.label}
            >
              <i style={{ background: item.color }} />
              <span>
                {item.label}
                <strong>{money(item.value)}</strong>
              </span>
              <small>
                {total
                  ? ((Math.max(0, item.value) / total) * 100).toFixed(0)
                  : 0}
                %
              </small>
            </button>
          ))}
          {active && (
            <button className="oa-open" onClick={() => onOpen(active.target)}>
              Open {active.target.toLowerCase()} →
            </button>
          )}
        </div>
      </div>
      <p className="oa-footnote">
        {items.some((i) => i.value < 0)
          ? "Negative net amounts are shown in the list, not as pie slices."
          : "Tap a category to explore its share."}
      </p>
    </article>
  );
}

export default function OverviewAnalytics({
  months,
  fiscalLabel,
  currentKey,
  onOpen,
}: {
  months: OverviewMonth[];
  fiscalLabel: string;
  currentKey: string;
  onOpen: (target: string) => void;
}) {
  const [period, setPeriod] = useState("6");
  const [enabled, setEnabled] = useState<Metric[]>([
    "sales",
    "purchases",
    "expenses",
    "collections",
  ]);
  const [picked, setPicked] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const endpoint = months.findIndex((m) => m.key === currentKey);
  const available = months.slice(
    0,
    endpoint < 0 ? months.length : endpoint + 1,
  );
  const shown = period === "fy" ? months : available.slice(-Number(period));
  const selected = shown.find((m) => m.key === picked);
  const totals = overviewTotals(selected ? [selected] : shown);
  const min = Math.min(
    0,
    ...shown.flatMap((m) => enabled.map((key) => m[key])),
  );
  const max = Math.max(
    1,
    ...shown.flatMap((m) => enabled.map((key) => m[key])),
  );
  const y = (value: number) => 190 - ((value - min) / (max - min)) * 160;
  const x = (index: number) =>
    58 + (index * 624) / Math.max(1, shown.length - 1);
  const receiptTotals: Record<string, number> = {};
  for (const m of selected ? [selected] : shown)
    for (const [mode, value] of Object.entries(m.receipts))
      receiptTotals[mode] = (receiptTotals[mode] || 0) + value;
  const receiptColors = ["#1b9d89", "#4267e8", "#ee9561", "#9470d8", "#b27955"];
  const modes = Object.entries(receiptTotals).sort((a, b) => b[1] - a[1]);
  return (
    <section className="overview-analytics" aria-label="Business analytics">
      <div className="oa-toolbar">
        <div>
          <span className="oa-eyebrow">BUSINESS PULSE · FY {fiscalLabel}</span>
          <h2>Your business, at a glance</h2>
          <p>Sales, spending and collections. One clear view.</p>
        </div>
        <label className="oa-period">
          Chart period
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPicked(null);
            }}
          >
            <option value="3">Last 3 BS months</option>
            <option value="6">Last 6 BS months</option>
            <option value="fy">Full fiscal year</option>
          </select>
        </label>
      </div>
      <div className="oa-period-label">
        <span>
          {selected
            ? `${selected.label} ${selected.year}`
            : shown.length
              ? `${shown[0].label} ${shown[0].year} — ${shown.at(-1)?.label} ${shown.at(-1)?.year}`
              : "Waiting for accounting data"}
        </span>
        {selected && (
          <button onClick={() => setPicked(null)}>Clear month ×</button>
        )}
        <small>{totals.count} posted records</small>
      </div>
      <div className="oa-metrics">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            onClick={() => onOpen(metric.target)}
            style={{ "--metric-color": metric.color } as React.CSSProperties}
          >
            <span>
              {metric.label}
              <b>↗</b>
            </span>
            <strong>{money(totals[metric.key])}</strong>
            <small>
              {metric.key === "sales" || metric.key === "purchases"
                ? "After returns · including tax"
                : metric.key === "collections"
                  ? "Receipts · excluding cancelled cheques"
                  : "Recorded expense vouchers"}
            </small>
          </button>
        ))}
      </div>
      <article className="oa-trends">
        <div className="oa-chart-head">
          <div>
            <h3>Monthly performance</h3>
            <p>Tap a month to explore. Toggle a series below.</p>
          </div>
          <button
            className="oa-view"
            onClick={() => setTable(!table)}
            aria-pressed={table}
          >
            {table ? "Show chart" : "View data"}
          </button>
        </div>
        <div className="oa-series">
          {metrics.map((metric) => (
            <button
              key={metric.key}
              aria-pressed={enabled.includes(metric.key)}
              onClick={() =>
                setEnabled((previous) =>
                  previous.includes(metric.key)
                    ? previous.filter((k) => k !== metric.key)
                    : [...previous, metric.key],
                )
              }
            >
              <i
                style={{
                  background: enabled.includes(metric.key)
                    ? metric.color
                    : "#cdd5e2",
                }}
              />
              {metric.label}
            </button>
          ))}
        </div>
        {table ? (
          <div className="oa-table-scroll">
            <table>
              <caption>Monthly voucher totals in Nepalese rupees</caption>
              <thead>
                <tr>
                  <th>BS month</th>
                  {metrics.map((m) => (
                    <th key={m.key}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.key}>
                    <th>
                      {m.label} {m.year}
                    </th>
                    {metrics.map((k) => (
                      <td key={k.key}>{money(m[k.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="oa-plot">
            <svg
              viewBox="0 0 740 230"
              role="img"
              aria-label="Monthly sales, purchases, expenses and collections in rupees"
            >
              {[0, 1, 2, 3, 4].map((step) => {
                const value = min + ((max - min) * step) / 4;
                return (
                  <g key={step}>
                    <line
                      x1="58"
                      x2="700"
                      y1={y(value)}
                      y2={y(value)}
                      stroke="#e8edf5"
                      strokeDasharray="4 5"
                    />
                    <text
                      x="46"
                      y={y(value) + 4}
                      textAnchor="end"
                      fill="#7e8ca3"
                      fontSize="10"
                    >
                      {short(value)}
                    </text>
                  </g>
                );
              })}
              {metrics
                .filter((m) => enabled.includes(m.key))
                .map((metric) => (
                  <g key={metric.key}>
                    <polyline
                      points={shown
                        .map((m, index) => `${x(index)},${y(m[metric.key])}`)
                        .join(" ")}
                      fill="none"
                      stroke={metric.color}
                      strokeWidth="3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {shown.map((m, index) => (
                      <circle
                        key={m.key}
                        cx={x(index)}
                        cy={y(m[metric.key])}
                        r={picked === m.key ? 6 : 4}
                        fill="white"
                        stroke={metric.color}
                        strokeWidth="2"
                      >
                        <title>
                          {m.label} {m.year} · {metric.label}:{" "}
                          {money(m[metric.key])}
                        </title>
                      </circle>
                    ))}
                  </g>
                ))}
              {shown.map((m, index) => (
                <text
                  key={m.key}
                  x={x(index)}
                  y="217"
                  textAnchor="middle"
                  fill="#77849b"
                  fontSize="10"
                >
                  {m.label}
                </text>
              ))}
            </svg>
            {!overviewTotals(shown).count && (
              <p className="oa-empty">
                No posted activity in this period. Charts will update when you
                record a transaction.
              </p>
            )}
            {!enabled.length && (
              <p className="oa-empty">
                Select a series above to show it on the chart.
              </p>
            )}
          </div>
        )}
        <div className="oa-months" aria-label="Explore a month">
          {shown.map((m) => (
            <button
              key={m.key}
              onClick={() => setPicked(picked === m.key ? null : m.key)}
              aria-pressed={picked === m.key}
            >
              {m.label}
              <small>{m.year}</small>
            </button>
          ))}
        </div>
      </article>
      <div className="oa-donuts">
        <Donut
          title="Purchases & expenses"
          subtitle="How recorded spending is distributed"
          items={[
            {
              label: "Net purchases",
              value: totals.purchases,
              color: "#ee9561",
              target: "Purchases",
            },
            {
              label: "Expenses",
              value: totals.expenses,
              color: "#9470d8",
              target: "Expenses",
            },
          ]}
          onOpen={onOpen}
        />
        <Donut
          title="Collection mix"
          subtitle="Recorded receipts by payment mode"
          items={(modes.length
            ? modes
            : ([
                ["Cash", 0],
                ["Bank / cheque", 0],
              ] as [string, number][])
          ).map(([label, value], index) => ({
            label,
            value,
            color: receiptColors[index % receiptColors.length],
            target: "Payments",
          }))}
          onOpen={onOpen}
        />
      </div>
      <p className="oa-disclaimer">
        Voucher-based overview, not a profit or bank-balance statement. Cheque
        receipts may still await clearance. Summary cards above show the full
        fiscal year.
      </p>
    </section>
  );
}
