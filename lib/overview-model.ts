export type OverviewMonth = {
  key: string;
  label: string;
  year: number;
  month: number;
  sales: number;
  purchases: number;
  expenses: number;
  collections: number;
  receipts: Record<string, number>;
  count: number;
};
type Voucher = {
  voucher_type: string;
  voucher_date: string;
  total: number | string;
  payment_mode?: string | null;
  cheque_status?: string | null;
  document_status?: string | null;
};

export function buildOverviewMonths(
  vouchers: Voucher[],
  months: Pick<OverviewMonth, "key" | "label" | "year" | "month">[],
  dateKey: (date: string) => string,
): OverviewMonth[] {
  const buckets = new Map(
    months.map((m) => [
      m.key,
      {
        ...m,
        sales: 0,
        purchases: 0,
        expenses: 0,
        collections: 0,
        receipts: {} as Record<string, number>,
        count: 0,
      },
    ]),
  );
  for (const v of vouchers) {
    if (v.document_status && v.document_status !== "posted") continue;
    const month = buckets.get(dateKey(v.voucher_date));
    const amount = Number(v.total);
    if (!month || !Number.isFinite(amount)) continue;
    if (
      v.voucher_type === "receipt" &&
      v.payment_mode === "Cheque" &&
      v.cheque_status === "cancelled"
    )
      continue;
    if (
      ![
        "sale",
        "sale_return",
        "purchase",
        "purchase_return",
        "expense",
        "receipt",
      ].includes(v.voucher_type)
    )
      continue;
    month.count++;
    if (v.voucher_type === "sale") month.sales += amount;
    if (v.voucher_type === "sale_return") month.sales -= amount;
    if (v.voucher_type === "purchase") month.purchases += amount;
    if (v.voucher_type === "purchase_return") month.purchases -= amount;
    if (v.voucher_type === "expense") month.expenses += amount;
    if (v.voucher_type === "receipt") {
      month.collections += amount;
      const mode = v.payment_mode || "Other";
      month.receipts[mode] = (month.receipts[mode] || 0) + amount;
    }
  }
  return [...buckets.values()];
}

export function overviewTotals(months: OverviewMonth[]) {
  return months.reduce(
    (sum, m) => ({
      sales: sum.sales + m.sales,
      purchases: sum.purchases + m.purchases,
      expenses: sum.expenses + m.expenses,
      collections: sum.collections + m.collections,
      count: sum.count + m.count,
    }),
    { sales: 0, purchases: 0, expenses: 0, collections: 0, count: 0 },
  );
}
