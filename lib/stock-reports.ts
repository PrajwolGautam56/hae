const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const stockSources: Record<string, string> = {
  purchase: "Purchase received",
  sale: "Sales invoice",
  sale_return: "Sales return",
  purchase_return: "Purchase return",
  manual: "Manual stock adjustment",
  production_in: "Production output",
  production_out: "Production material used",
  other: "Other / legacy movement",
};
export function stockSource(move: any) {
  if (move.manual_request_id || move.voucher_type === "stock_adjustment")
    return "manual";
  if (move.production_batch_id)
    return Number(move.quantity) >= 0 ? "production_in" : "production_out";
  return ["purchase", "sale", "sale_return", "purchase_return"].includes(
    move.voucher_type,
  )
    ? move.voucher_type
    : "other";
}
export function salesStockDeficits(products: any[], lines: any[]) {
  const required = new Map<string, number>();
  for (const line of lines)
    if (line.productId && Number(line.quantity) > 0)
      required.set(
        line.productId,
        (required.get(line.productId) || 0) + Number(line.quantity),
      );
  return products
    .filter(
      (product) =>
        required.has(product.id) &&
        Number(product.stock_qty) < required.get(product.id)!,
    )
    .map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      after: round(Number(product.stock_qty) - required.get(product.id)!),
    }));
}
export function stockReport(
  snapshot: any,
  reportType: string,
  filters: {
    productId?: string;
    itemType?: string;
    source?: string;
    actorId?: string;
  } = {},
) {
  const allProducts: any[] = snapshot.products || [],
    moves: any[] = snapshot.movements || [];
  if (
    filters.productId &&
    !allProducts.some((product) => product.id === filters.productId)
  )
    throw new Error("Product does not belong to this company");
  const future = new Map<string, number>(
    (snapshot.future || []).map((row: any) => [
      row.product_id,
      Number(row.quantity),
    ]),
  );
  const activity = new Map<
    string,
    {
      inward: number;
      outward: number;
      net: number;
      manualIn: number;
      manualOut: number;
      purchaseIn: number;
      productionIn: number;
    }
  >();
  for (const move of moves) {
    const quantity = Number(move.quantity),
      value = activity.get(move.product_id) || {
        inward: 0,
        outward: 0,
        net: 0,
        manualIn: 0,
        manualOut: 0,
        purchaseIn: 0,
        productionIn: 0,
      },
      source = stockSource(move);
    if (quantity >= 0) value.inward += quantity;
    else value.outward -= quantity;
    value.net += quantity;
    if (source === "manual") {
      if (quantity > 0) value.manualIn += quantity;
      else value.manualOut -= quantity;
    }
    if (source === "purchase" && quantity > 0) value.purchaseIn += quantity;
    if (source === "production_in") value.productionIn += quantity;
    activity.set(move.product_id, value);
  }
  const selected = allProducts.filter(
    (product) =>
      (!filters.productId || product.id === filters.productId) &&
      (!filters.itemType || product.item_type === filters.itemType),
  );
  const rows = selected.map((product) => {
    const totals = activity.get(product.id) || {
      inward: 0,
      outward: 0,
      net: 0,
      manualIn: 0,
      manualOut: 0,
      purchaseIn: 0,
      productionIn: 0,
    };
    const closing = round(
      Number(product.stock_qty) - (future.get(product.id) || 0),
    );
    return {
      ...product,
      ...Object.fromEntries(
        Object.entries(totals).map(([key, value]) => [key, round(value)]),
      ),
      opening: round(closing - totals.net),
      closing,
      stockValue:
        Math.round(closing * Number(product.purchase_price) * 100) / 100,
    };
  });
  const productMap = new Map(rows.map((product) => [product.id, product])),
    balances = new Map(rows.map((product) => [product.id, product.opening]));
  const movementRows = moves
    .filter((move) => productMap.has(move.product_id))
    .map((move) => {
      const source = stockSource(move),
        before = balances.get(move.product_id)!,
        quantity = Number(move.quantity),
        balance = round(before + quantity);
      balances.set(move.product_id, balance);
      return {
        ...move,
        product: productMap.get(move.product_id),
        quantity,
        opening: before,
        inward: Math.max(quantity, 0),
        outward: Math.max(-quantity, 0),
        balance,
        source,
        sourceLabel: stockSources[source],
        actorName: move.actor_name || "Not recorded",
        recordedAt: move.manual_recorded_at || move.created_at,
        unitCost: Number(move.unit_cost || 0),
        reference: move.voucher_no || move.batch_no || "—",
        voucherType: move.voucher_type || source,
        notes: move.manual_reason || move.notes || "",
      };
    })
    .filter(
      (move) =>
        (!filters.source || move.source === filters.source) &&
        (!filters.actorId || move.actor_id === filters.actorId),
    );
  const units = new Map<string, any>();
  for (const row of rows) {
    const unit = row.unit || "unspecified",
      total = units.get(unit) || {
        unit,
        opening: 0,
        inward: 0,
        outward: 0,
        closing: 0,
      };
    for (const key of ["opening", "inward", "outward", "closing"])
      total[key] = round(total[key] + Number(row[key as keyof typeof row]));
    units.set(unit, total);
  }
  const actors = Array.from(
    new Map(
      moves
        .filter((move) => move.actor_id)
        .map((move) => [
          move.actor_id,
          { id: move.actor_id, name: move.actor_name || "Not recorded" },
        ]),
    ).values(),
  );
  return {
    reportType,
    rows: reportType === "stock_movement" ? movementRows : rows,
    products: allProducts.map(({ id, name, unit, item_type }) => ({
      id,
      name,
      unit,
      item_type,
    })),
    actors,
    unitTotals: Array.from(units.values()),
    totals: {
      stockValue:
        Math.round(rows.reduce((sum, row) => sum + row.stockValue, 0) * 100) /
        100,
    },
    filters,
    basis:
      "Opening + dated inward − dated outward = closing, from one database snapshot. Edited/cancelled bills restate their original period; original versions remain in the voucher audit log. Opening is reconstructed from current stock and recorded movements, including later-dated entries. Legacy changes without movement records have no reliable historical date or staff attribution. Values are estimates at current recorded cost, not historical inventory valuation.",
    filteredMovements: Boolean(filters.source || filters.actorId),
  };
}
