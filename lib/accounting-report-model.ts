export type BillCategory = "vat" | "pan" | "non_vat" | "unclassified";
export const billCategoryLabels: Record<BillCategory, string> = {
  vat: "VAT bill",
  pan: "PAN bill",
  non_vat: "Non-VAT / no PAN bill",
  unclassified: "Needs classification",
};
export const cents = (n: unknown) => Math.round(Number(n || 0) * 100);
export const rupees = (n: number) => n / 100;
export function categoryOf(v: any): BillCategory {
  return v.bill_category || (Number(v.tax_amount) > 0 ? "vat" : "unclassified");
}

/** Summaries retain returns as separate credit/debit-note rows and net them only in totals. */
export function monthlyAccounting(vouchers: any[]) {
  const groups = new Map<string, any>();
  const bills = vouchers.map((v) => {
    const category = categoryOf(v);
    const isReturn = ["sale_return", "purchase_return"].includes(
      v.voucher_type,
    );
    const side = ["sale", "sale_return"].includes(v.voucher_type)
      ? "sales"
      : "purchases";
    const key = `${side}:${category}:${isReturn ? "return" : "invoice"}`;
    const net = cents(v.subtotal) - cents(v.discount_amount);
    const tax = cents(v.tax_amount);
    const gross = cents(v.total);
    const row = groups.get(key) || {
      key,
      side,
      category,
      label: billCategoryLabels[category],
      isReturn,
      count: 0,
      base: 0,
      taxable: 0,
      nonTaxable: 0,
      tax: 0,
      total: 0,
    };
    row.count++;
    row.base += net;
    row.taxable += category === "vat" ? net : 0;
    row.nonTaxable += category !== "vat" ? net : 0;
    row.tax += tax;
    row.total += gross;
    groups.set(key, row);
    return {
      ...v,
      category,
      isReturn,
      side,
      base: rupees(net),
      taxable: category === "vat" ? rupees(net) : 0,
      nonTaxable: category !== "vat" ? rupees(net) : 0,
      tax: rupees(tax),
      gross: rupees(gross),
    };
  });
  const rows = [...groups.values()].map((row) => ({
    ...row,
    base: rupees(row.base),
    taxable: rupees(row.taxable),
    nonTaxable: rupees(row.nonTaxable),
    tax: rupees(row.tax),
    total: rupees(row.total),
  }));
  const sum = (side: string, field: string) =>
    rupees(
      rows
        .filter((r) => r.side === side)
        .reduce((s, r) => s + cents(r[field]) * (r.isReturn ? -1 : 1), 0),
    );
  return {
    rows,
    bills,
    totals: {
      sales: sum("sales", "total"),
      purchases: sum("purchases", "total"),
      outputTax: sum("sales", "tax"),
      inputTax: sum("purchases", "tax"),
      netTax: sum("sales", "tax") - sum("purchases", "tax"),
      salesCount: bills.filter((b) => b.side === "sales" && !b.isReturn).length,
      purchaseCount: bills.filter((b) => b.side === "purchases" && !b.isReturn)
        .length,
      unclassifiedCount: bills.filter((b) => b.category === "unclassified")
        .length,
    },
  };
}

/** Net party FIFO, reconstructed from dated subledger entries, including cheque reversals. */
export function ageParty(
  opening: number,
  entries: any[],
  asOf: string,
  payable = false,
) {
  const direction = payable ? -1 : 1;
  const obligations: {
    due: string | null;
    reference: string;
    remaining: number;
  }[] = [];
  let credit = 0;
  const apply = (signed: number, due: string | null, reference: string) => {
    if (signed > 0) {
      const offset = Math.min(credit, signed);
      credit -= offset;
      if (signed > offset)
        obligations.push({ due, reference, remaining: signed - offset });
    } else {
      let available = -signed;
      for (const item of obligations) {
        const used = Math.min(available, item.remaining);
        item.remaining -= used;
        available -= used;
        if (!available) break;
      }
      credit += available;
    }
  };
  apply(
    cents(opening) * direction,
    null,
    "Opening balance (original due date unknown)",
  );
  const dated = entries.filter((e) => e.entry_date <= asOf);
  // A fully cancelled receipt must restore the original debt's age, not create new debt today.
  const cancelled = new Set(
    dated
      .filter(
        (e) =>
          e.voucher_id &&
          e.account_name === "Cancelled Cheque Receipt Adjustment",
      )
      .filter(
        (e) =>
          dated
            .filter((r) => r.voucher_id === e.voucher_id)
            .reduce((s, r) => s + cents(r.debit) - cents(r.credit), 0) === 0,
      )
      .map((e) => e.voucher_id),
  );
  for (const entry of dated
    .filter((e) => !cancelled.has(e.voucher_id))
    .sort(
      (a, b) =>
        a.entry_date.localeCompare(b.entry_date) ||
        String(a.created_at).localeCompare(String(b.created_at)) ||
        a.id.localeCompare(b.id),
    )) {
    apply(
      (cents(entry.debit) - cents(entry.credit)) * direction,
      entry.due_date || entry.entry_date,
      entry.voucher_no || entry.id,
    );
  }
  const buckets = {
    notDue: 0,
    current: 0,
    days31to60: 0,
    days61to90: 0,
    above90: 0,
    unknown: 0,
  };
  const details = obligations
    .filter((o) => o.remaining > 0)
    .map((o) => {
      const days = o.due
        ? Math.floor(
            (Date.parse(asOf + "T12:00:00Z") -
              Date.parse(o.due + "T12:00:00Z")) /
              86400000,
          )
        : null;
      const bucket =
        days === null
          ? "unknown"
          : days < 0
            ? "notDue"
            : days <= 30
              ? "current"
              : days <= 60
                ? "days31to60"
                : days <= 90
                  ? "days61to90"
                  : "above90";
      buckets[bucket] += o.remaining;
      return {
        reference: o.reference,
        due: o.due,
        overdueDays: days,
        remaining: rupees(o.remaining),
      };
    });
  return {
    ...Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, rupees(v)]),
    ),
    total: rupees(Object.values(buckets).reduce((a, b) => a + b, 0)),
    advance: rupees(credit),
    details,
  };
}
