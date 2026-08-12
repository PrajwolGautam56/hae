import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
export const dynamic = "force-dynamic";

const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function snapshot(requestedFy?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase server configuration is missing");
  const { data: companies, error: companyError } = await supabase
    .from("companies")
    .select("id,name,currency,fiscal_year")
    .order("created_at")
    .limit(1);
  if (companyError || !companies?.[0])
    throw companyError || new Error("Company not found");
  const company = companies[0];
  const { error: fiscalEnsureError } = await supabase.rpc(
    "ensure_fiscal_year_for_date",
    { p_company_id: company.id, p_date: businessDate() },
  );
  if (fiscalEnsureError) throw fiscalEnsureError;
  const { data: fiscalYears, error: fyError } = await supabase
    .from("fiscal_years")
    .select("*")
    .eq("company_id", company.id)
    .order("start_ad", { ascending: false });
  if (fyError) throw fyError;
  const now = new Date().toISOString().slice(0, 10);
  const fiscalYear =
    (requestedFy
      ? fiscalYears?.find((f) => f.id === requestedFy)
      : fiscalYears?.find((f) => f.start_ad <= now && f.end_ad >= now)) ||
    fiscalYears?.[0];
  if (!fiscalYear) throw new Error("Fiscal year not found");
  const [
    { data: parties, error: partyError },
    { data: openings, error: openingError },
    { data: vouchers, error: voucherError },
    { data: products, error: productError },
    { data: sequences, error: sequenceError },
  ] = await Promise.all([
    supabase
      .from("parties")
      .select("id,name,place,phone,tax_no,party_type,opening_balance")
      .eq("company_id", company.id)
      .order("name"),
    supabase
      .from("party_opening_balances")
      .select("party_id,amount")
      .eq("fiscal_year_id", fiscalYear.id),
    supabase
      .from("vouchers")
      .select(
        "id,party_id,voucher_type,voucher_no,voucher_date,payment_mode,narration,total,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,sequence_no,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,cheque_cleared_at,parties(name),ledger_entries(debit,credit)",
      )
      .eq("fiscal_year_id", fiscalYear.id)
      .order("voucher_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("products")
      .select(
        "id,sku,name,unit,sale_price,purchase_price,stock_qty,low_stock_at",
      )
      .eq("company_id", company.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("voucher_sequences")
      .select("voucher_type,last_number")
      .eq("fiscal_year_id", fiscalYear.id),
  ]);
  if (partyError || openingError || voucherError || productError || sequenceError)
    throw partyError || openingError || voucherError || productError || sequenceError;
  const openingMap = new Map(
    (openings || []).map((o) => [o.party_id, Number(o.amount)]),
  );
  const movement = new Map<string, number>();
  for (const v of vouchers || [])
    for (const e of v.ledger_entries || [])
      if (v.party_id)
        movement.set(
          v.party_id,
          (movement.get(v.party_id) || 0) + Number(e.debit) - Number(e.credit),
        );
  const partyRows = (parties || [])
    .map((p) => {
      const opening = openingMap.get(p.id) ?? Number(p.opening_balance);
      return {
        ...p,
        opening_balance: opening,
        balance: opening + (movement.get(p.id) || 0),
      };
    })
    .sort((a, b) => b.balance - a.balance);
  const transactions = (vouchers || []).map((v) => ({
    id: v.id,
    type: v.voucher_type === "receipt" ? "payment" : v.voucher_type,
    ref: v.voucher_no,
    date: v.voucher_date,
    particulars: v.narration,
    debit: v.voucher_type === "sale" ? Number(v.total) : 0,
    credit: v.voucher_type !== "sale" ? Number(v.total) : 0,
    payment_mode: v.payment_mode,
    cheque_no: v.cheque_no,
    cheque_bank: v.cheque_bank,
    cheque_exchange_date: v.cheque_exchange_date,
    cheque_status: v.cheque_status,
    cheque_cleared_at: v.cheque_cleared_at,
    party:
      (v.parties as any)?.name ||
      (v.voucher_type === "expense" ? "Office Expense" : "Cash / General"),
    sequence_no: v.sequence_no,
  }));
  const totals = {
    sales: 0,
    received: 0,
    expenses: 0,
    receivable: partyRows.reduce((s, p) => s + Math.max(0, p.balance), 0),
  };
  for (const v of vouchers || []) {
    if (v.voucher_type === "sale") totals.sales += Number(v.total);
    if (v.voucher_type === "receipt") totals.received += Number(v.total);
    if (v.voucher_type === "expense") totals.expenses += Number(v.total);
  }
  return {
    source: "supabase",
    company,
    fiscalYear,
    fiscalYears,
    parties: partyRows,
    products: products || [],
    transactions,
    totals,
    nextNumbers: Object.fromEntries(
      ["sale", "receipt", "purchase", "expense"].map((type) => [
        type,
        Number(sequences?.find((row) => row.voucher_type === type)?.last_number || 0) + 1,
      ]),
    ),
  };
}

export async function GET(request: Request) {
  try {
    const voucherId = new URL(request.url).searchParams.get("voucherId");
    if (voucherId) {
      const supabase = getSupabaseAdmin();
      if (!supabase) throw new Error("Supabase server configuration is missing");
      const { data: voucher, error: voucherError } = await supabase
        .from("vouchers")
        .select("id,voucher_type,voucher_no,sequence_no,voucher_date,payment_mode,narration,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,parties(name,place,phone,tax_no),fiscal_years(label_bs)")
        .eq("id", voucherId)
        .single();
      if (voucherError) throw voucherError;
      const { data: lines, error: lineError } = await supabase
        .from("voucher_lines")
        .select("id,description,quantity,rate,amount,inventory_item,products(name,sku,unit)")
        .eq("voucher_id", voucherId)
        .order("id");
      if (lineError) throw lineError;
      return NextResponse.json({ ...voucher, lines: lines || [] });
    }
    return NextResponse.json(
      await snapshot(new URL(request.url).searchParams.get("fy") || undefined),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase server configuration is missing");
    const body = (await request.json()) as Record<string, unknown>;
    const type = String(body.type || "");
    const initialState = await snapshot(String(body.fiscalYearId || ""));
    if (type === "party") {
      const name = String(body.partyName || "").trim();
      if (!name)
        return NextResponse.json(
          { error: "Party name is required" },
          { status: 400 },
        );
      const openingBalance = Number(body.openingBalance || 0);
      if (!Number.isFinite(openingBalance))
        return NextResponse.json({ error: "Opening balance must be a valid number" }, { status: 400 });
      const { data: party, error } = await supabase.from("parties").upsert(
        {
          company_id: initialState.company.id,
          name,
          place: String(body.place || ""),
          phone: String(body.phone || ""),
          tax_no: String(body.taxNo || "") || null,
          party_type: String(body.partyType || "both"),
          opening_balance: openingBalance,
        },
        { onConflict: "company_id,name" },
      ).select("id").single();
      if (error) throw error;
      const { error: openingError } = await supabase
        .from("party_opening_balances")
        .upsert(
          { fiscal_year_id: initialState.fiscalYear.id, party_id: party.id, amount: openingBalance },
          { onConflict: "fiscal_year_id,party_id" },
        );
      if (openingError) throw openingError;
      await supabase.rpc("refresh_future_opening_balances", {
        p_company_id: initialState.company.id,
        p_from_fiscal_year_id: initialState.fiscalYear.id,
      });
      return NextResponse.json(await snapshot(initialState.fiscalYear.id), {
        status: 201,
      });
    }
    if (type === "product") {
      const name = String(body.productName || "").trim();
      if (!name)
        return NextResponse.json(
          { error: "Product name is required" },
          { status: 400 },
        );
      const { error } = await supabase.from("products").upsert(
        {
          company_id: initialState.company.id,
          name,
          sku: String(body.sku || ""),
          unit: String(body.unit || "pcs"),
          sale_price: Number(body.salePrice || 0),
          purchase_price: Number(body.purchasePrice || 0),
          stock_qty: Number(body.openingStock || 0),
          low_stock_at: Number(body.lowStockAt || 0),
        },
        { onConflict: "company_id,name" },
      );
      if (error) throw error;
      return NextResponse.json(await snapshot(initialState.fiscalYear.id), {
        status: 201,
      });
    }
    const amount = Number(body.amount);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (
      !["sale", "payment", "purchase", "expense"].includes(type) ||
      (["sale", "purchase"].includes(type)
        ? lines.length === 0
        : !Number.isFinite(amount) || amount <= 0)
    )
      return NextResponse.json(
        { error: "Valid transaction and amount are required" },
        { status: 400 },
      );
    if (type === "payment" && String(body.paymentMode) === "Cheque") {
      if (!String(body.chequeNo || "").trim())
        return NextResponse.json({ error: "Cheque number is required" }, { status: 400 });
      if (!String(body.chequeBank || "").trim())
        return NextResponse.json({ error: "Bank name is required" }, { status: 400 });
      if (!body.chequeExchangeDate)
        return NextResponse.json({ error: "Cheque exchange date is required" }, { status: 400 });
    }
    let partyId = body.partyId ? String(body.partyId) : null;
    const state = initialState;
    if (!partyId && body.partyName) {
      const { data, error } = await supabase
        .from("parties")
        .upsert(
          {
            company_id: state.company.id,
            name: String(body.partyName),
            place: String(body.place || ""),
            phone: String(body.phone || ""),
            tax_no: String(body.taxNo || "") || null,
            party_type: type === "purchase" ? "supplier" : "customer",
          },
          { onConflict: "company_id,name" },
        )
        .select("id")
        .single();
      if (error) throw error;
      partyId = data.id;
    }
    const historicalYear = state.fiscalYear.status === "closed";
    if (historicalYear) {
      const { error: modeError } = await supabase
        .from("fiscal_years")
        .update({ status: "open" })
        .eq("id", state.fiscalYear.id);
      if (modeError) throw modeError;
    }
    const result =
      type === "purchase"
        ? await supabase.rpc("record_purchase_bill", {
            p_company_id: state.company.id,
            p_fiscal_year_id: state.fiscalYear.id,
            p_party_id: partyId,
            p_date: String(body.date || businessDate()),
            p_lines: lines,
            p_narration: String(body.particulars || ""),
          })
        : type === "sale"
          ? await supabase.rpc("record_sales_invoice", {
              p_company_id: state.company.id,
              p_fiscal_year_id: state.fiscalYear.id,
              p_party_id: partyId,
              p_date: String(
                body.date || businessDate(),
              ),
              p_lines: lines,
              p_discount_percent: Number(body.discountPercent || 0),
              p_tax_percent: Number(body.taxPercent || 0),
              p_narration: String(body.particulars || ""),
            })
          : await supabase.rpc("record_accounting_voucher", {
              p_company_id: state.company.id,
              p_fiscal_year_id: state.fiscalYear.id,
              p_party_id: partyId,
              p_type: type === "payment" ? "receipt" : type,
              p_amount: amount,
              p_date: String(
                body.date || businessDate(),
              ),
              p_narration: String(body.particulars || ""),
              p_payment_mode: body.paymentMode
                ? String(body.paymentMode)
                : null,
            });
    if (historicalYear) {
      const { error: restoreError } = await supabase
        .from("fiscal_years")
        .update({ status: "closed" })
        .eq("id", state.fiscalYear.id);
      if (restoreError) throw restoreError;
    }
    if (result.error) throw result.error;
    if (type === "payment" && String(body.paymentMode) === "Cheque") {
      const voucherId = (result.data as any)?.id;
      if (!voucherId) throw new Error("Receipt was created but cheque details could not be linked");
      const exchangeDate = String(body.chequeExchangeDate || "");
      if (!exchangeDate) throw new Error("Cheque exchange date is required");
      const { error: chequeError } = await supabase.from("vouchers").update({
        cheque_no: String(body.chequeNo).trim(),
        cheque_bank: String(body.chequeBank).trim(),
        cheque_exchange_date: exchangeDate,
        cheque_status: "pending",
      }).eq("id", voucherId);
      if (chequeError) throw chequeError;
      const { error: bankError } = await supabase.from("cheque_banks").upsert(
        { company_id: state.company.id, name: String(body.chequeBank).trim(), active: true },
        { onConflict: "company_id,name" },
      );
      if (bankError) throw bankError;
    }
    await supabase.rpc("refresh_future_opening_balances", {
      p_company_id: state.company.id,
      p_from_fiscal_year_id: state.fiscalYear.id,
    });
    return NextResponse.json(await snapshot(state.fiscalYear.id), {
      status: 201,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500 },
    );
  }
}
