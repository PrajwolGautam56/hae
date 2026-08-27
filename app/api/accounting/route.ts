import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { adToBsParts, bsMonths } from "../../../lib/nepali-date";
import { getCurrentMember } from "../../../lib/current-member";
import { getSelectedBusinessCompany } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
export const dynamic = "force-dynamic";

const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function accountingContext(requestedFy?:string){
  const supabase=getSupabaseAdmin();if(!supabase)throw new Error("Supabase server configuration is missing");
  const company=await getSelectedBusinessCompany(supabase);
  let {data:fiscalYears,error:fyError}=await supabase.from("fiscal_years").select("*").eq("company_id",company.id).order("start_ad",{ascending:false});
  if(fyError)throw fyError;const today=businessDate();let fiscalYear=requestedFy?fiscalYears?.find(f=>f.id===requestedFy):fiscalYears?.find(f=>f.start_ad<=today&&f.end_ad>=today);
  if(!fiscalYear&&!requestedFy){const {error}=await supabase.rpc("ensure_fiscal_year_for_date",{p_company_id:company.id,p_date:today});if(error)throw error;const refreshed=await supabase.from("fiscal_years").select("*").eq("company_id",company.id).order("start_ad",{ascending:false});if(refreshed.error)throw refreshed.error;fiscalYears=refreshed.data;fiscalYear=fiscalYears?.find(f=>f.start_ad<=today&&f.end_ad>=today)}
  fiscalYear ||= fiscalYears?.[0];if(!fiscalYear)throw new Error("Fiscal year not found");return{supabase,company,fiscalYears:fiscalYears||[],fiscalYear};
}

async function snapshot(requestedFy?: string) {
  const {supabase,company,fiscalYears,fiscalYear}=await accountingContext(requestedFy);
  const today = businessDate();
  const [
    { data: parties, error: partyError },
    { data: openings, error: openingError },
    { data: vouchers, error: voucherError },
    { data: fiscalVouchers, error: fiscalVoucherError },
    { data: partyLedger, error: partyLedgerError },
    { data: products, error: productError },
    { data: sequences, error: sequenceError },
    { data: members, error: memberError },
    { data: moneyAccounts, error: moneyAccountError },
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
        "id,party_id,voucher_type,voucher_no,voucher_date,payment_mode,narration,total,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,sequence_no,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,cheque_cleared_at,generated_by,handled_by,money_account_id,parties(name),generator:team_members!vouchers_generated_by_fkey(name),handler:team_members!vouchers_handled_by_fkey(name),money_account:money_accounts(name,account_type)",
      )
      .eq("fiscal_year_id", fiscalYear.id)
      .order("voucher_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("vouchers")
      .select("voucher_type,voucher_date,total,payment_mode,cheque_status")
      .eq("fiscal_year_id", fiscalYear.id)
      .order("voucher_date"),
    supabase
      .from("ledger_entries")
      .select("party_id,debit,credit")
      .eq("company_id", company.id)
      .gte("entry_date", fiscalYear.start_ad)
      .lte("entry_date", fiscalYear.end_ad),
    supabase
      .from("products")
      .select(
        "id,sku,name,unit,sale_price,purchase_price,stock_qty,low_stock_at,item_type",
      )
      .eq("company_id", company.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("voucher_sequences")
      .select("voucher_type,last_number")
      .eq("fiscal_year_id", fiscalYear.id),
    supabase.from("team_members").select("id,name,email,role,active").eq("company_id", company.id).eq("active", true).order("name"),
    supabase.from("money_account_balances").select("id,account_type,name,bank_name,account_number,team_member_id,opening_balance,balance,active").eq("company_id", company.id).eq("active", true).order("account_type").order("name"),
  ]);
  if (partyError || openingError || voucherError || fiscalVoucherError || partyLedgerError || productError || sequenceError || memberError || moneyAccountError)
    throw partyError || openingError || voucherError || fiscalVoucherError || partyLedgerError || productError || sequenceError || memberError || moneyAccountError;
  const currentMember = await getCurrentMember(supabase, company.id);
  const productRows = (products || []).map((row:any) => ({ ...row, item_type: row.item_type || "finished_good" }));
  const openingMap = new Map(
    (openings || []).map((o) => [o.party_id, Number(o.amount)]),
  );
  const movement = new Map<string, number>();
  for (const entry of partyLedger || [])
    if (entry.party_id)
      movement.set(
        entry.party_id,
        (movement.get(entry.party_id) || 0) + Number(entry.debit) - Number(entry.credit),
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
  const transactions = (vouchers || []).map((v) => {
    const cancelledCheque=v.voucher_type==="receipt"&&v.payment_mode==="Cheque"&&v.cheque_status==="cancelled";
    return ({
    id: v.id,
    type: v.voucher_type,
    ref: v.voucher_no,
    date: v.voucher_date,
    particulars: cancelledCheque?`${v.narration||"Cheque receipt"} · Cancelled / adjusted`:v.narration,
    debit: v.voucher_type === "sale" || cancelledCheque ? Number(v.total) : 0,
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
    generated_by: v.generated_by,
    handled_by: v.handled_by,
    generated_by_name: (v.generator as any)?.name || "Office",
    handled_by_name: (v.handler as any)?.name || null,
    money_account_name: (v.money_account as any)?.name || null,
    });
  });
  const totals = {
    sales: 0,
    received: 0,
    expenses: 0,
    receivable: partyRows.reduce((s, p) => s + Math.max(0, p.balance), 0),
  };
  for (const v of fiscalVouchers || []) {
    if (v.voucher_type === "sale") totals.sales += Number(v.total);
    if (v.voucher_type === "receipt" && !(v.payment_mode === "Cheque" && v.cheque_status === "cancelled")) totals.received += Number(v.total);
    if (v.voucher_type === "expense") totals.expenses += Number(v.total);
  }
  const chartEnd = today < fiscalYear.start_ad
    ? fiscalYear.start_ad
    : today > fiscalYear.end_ad
      ? fiscalYear.end_ad
      : today;
  const currentBs = adToBsParts(chartEnd);
  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const offset = 5 - index;
    const absoluteMonth = currentBs.year * 12 + currentBs.month - 1 - offset;
    const year = Math.floor(absoluteMonth / 12);
    const month = (absoluteMonth % 12) + 1;
    return { key: `${year}-${month}`, year, month, label: bsMonths[month - 1] };
  });
  const performance = new Map(monthKeys.map((month) => [month.key, { ...month, sales: 0, collections: 0 }]));
  for (const voucher of fiscalVouchers || []) {
    const parts = adToBsParts(voucher.voucher_date);
    const bucket = performance.get(`${parts.year}-${parts.month}`);
    if (!bucket) continue;
    if (voucher.voucher_type === "sale") bucket.sales += Number(voucher.total);
    if (voucher.voucher_type === "receipt" && !(voucher.payment_mode === "Cheque" && voucher.cheque_status === "cancelled")) bucket.collections += Number(voucher.total);
  }
  return {
    source: "supabase",
    company,
    fiscalYear,
    fiscalYears,
    parties: partyRows,
    products: productRows,
    transactions,
    totals,
    monthlyPerformance: monthKeys.map((month) => performance.get(month.key)),
    members: members || [],
    moneyAccounts: (moneyAccounts || [])
      .filter((account:any) => ["admin", "manager", "accountant"].includes(currentMember?.role) || account.account_type !== "employee_wallet" || account.team_member_id === currentMember?.id)
      .map((account:any) => ({ ...account, opening_balance: Number(account.opening_balance), balance: Number(account.balance) })),
    currentMember,
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
    await requireFeature("accounting");
    const voucherId = new URL(request.url).searchParams.get("voucherId");
    if (voucherId) {
      const supabase = getSupabaseAdmin();
      if (!supabase) throw new Error("Supabase server configuration is missing");
      const selectedCompany = await getSelectedBusinessCompany(supabase);
      const currentMember = await getCurrentMember(supabase, selectedCompany.id);
      if (!currentMember) return NextResponse.json({ error: "Active team access is required" }, { status: 401 });
      const { data: voucher, error: voucherError } = await supabase
        .from("vouchers")
        .select("id,party_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,payment_mode,narration,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,generated_by,handled_by,money_account_id,parties(name,place,phone,tax_no),fiscal_years(label_bs),generator:team_members!vouchers_generated_by_fkey(name),handler:team_members!vouchers_handled_by_fkey(name),money_account:money_accounts(name,account_type)")
        .eq("id", voucherId)
        .eq("company_id", selectedCompany.id)
        .single();
      if (voucherError) throw voucherError;
      const { data: lines, error: lineError } = await supabase
        .from("voucher_lines")
        .select("id,product_id,description,quantity,rate,amount,inventory_item,products(name,sku,unit)")
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
    await requireFeature("accounting");
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error("Supabase server configuration is missing");
    const body = (await request.json()) as Record<string, unknown>;
    const type = String(body.type || "");
    const initialState = await accountingContext(String(body.fiscalYearId || ""));
    const currentMember = await getCurrentMember(supabase, initialState.company.id);
    if (!currentMember) return NextResponse.json({ error: "Active team access is required" }, { status: 401 });
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
          item_type: String(body.productType || "finished_good"),
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
    if ((type === "expense" || (type === "payment" && String(body.paymentMode) !== "Cheque")) && !body.moneyAccountId)
      return NextResponse.json({ error: type === "payment" ? "Select where the payment was received" : "Select the cash or bank account used" }, { status: 400 });
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
                : "Cash",
              p_generated_by: currentMember.id,
              p_handled_by: body.handledBy ? String(body.handledBy) : currentMember.id,
              p_money_account_id: body.moneyAccountId ? String(body.moneyAccountId) : null,
              p_movement_status: type === "payment" && String(body.paymentMode) === "Cheque" ? "pending" : "posted",
            });
    if (historicalYear) {
      const { error: restoreError } = await supabase
        .from("fiscal_years")
        .update({ status: "closed" })
        .eq("id", state.fiscalYear.id);
      if (restoreError) throw restoreError;
    }
    if (result.error) throw result.error;
    if (["sale", "purchase"].includes(type)) {
      const voucherId = (result.data as any)?.id;
      if (voucherId) {
        const { error: attributionError } = await supabase.from("vouchers").update({ generated_by: currentMember.id, handled_by: currentMember.id }).eq("id", voucherId);
        if (attributionError) throw attributionError;
      }
    }
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

export async function PUT(request: Request) {
  try {
    await requireFeature("accounting");
    const supabase=getSupabaseAdmin();if(!supabase)throw new Error("Supabase server configuration is missing");
    const body=await request.json();
    const selectedCompany=await getSelectedBusinessCompany(supabase);const currentMember=await getCurrentMember(supabase,selectedCompany.id);if(!currentMember)return NextResponse.json({error:"Active team access is required"},{status:401});
    const productId=String(body.productId||"");
    if(productId){
      const state=await accountingContext(String(body.fiscalYearId||""));
      const name=String(body.productName||"").trim();
      if(!name)return NextResponse.json({error:"Product name is required"},{status:400});
      const values={name,sku:String(body.sku||""),unit:String(body.unit||"pcs"),sale_price:Number(body.salePrice||0),purchase_price:Number(body.purchasePrice||0),item_type:String(body.productType||"finished_good")};
      if(!Number.isFinite(values.sale_price)||!Number.isFinite(values.purchase_price)||values.sale_price<0||values.purchase_price<0)return NextResponse.json({error:"Product prices must be valid positive numbers"},{status:400});
      const {data,error}=await supabase.from("products").update(values).eq("id",productId).eq("company_id",state.company.id).select("id").maybeSingle();
      if(error)throw error;if(!data)return NextResponse.json({error:"Product was not found"},{status:404});
      return NextResponse.json(await snapshot(state.fiscalYear.id));
    }
    const voucherId=String(body.voucherId||"");const type=String(body.type||"");
    if(!voucherId||!["sale","payment"].includes(type))return NextResponse.json({error:"Editable voucher is required"},{status:400});
    const partyId=String(body.partyId||"");if(!partyId)return NextResponse.json({error:"Party is required"},{status:400});
    if(type==="payment"&&String(body.paymentMode)!=="Cheque"&&!body.moneyAccountId)return NextResponse.json({error:"Select where the payment was received"},{status:400});
    const result=type==="sale"?await supabase.rpc("update_sales_invoice",{p_voucher_id:voucherId,p_party_id:partyId,p_date:String(body.date),p_lines:body.lines,p_discount_percent:Number(body.discountPercent||0),p_tax_percent:Number(body.taxPercent||0),p_narration:String(body.particulars||"")}):await supabase.rpc("update_payment_receipt",{p_voucher_id:voucherId,p_party_id:partyId,p_date:String(body.date),p_amount:Number(body.amount),p_narration:String(body.particulars||""),p_payment_mode:String(body.paymentMode||"Cash"),p_cheque_no:body.chequeNo||null,p_cheque_bank:body.chequeBank||null,p_cheque_exchange_date:body.chequeExchangeDate||null});
    if(result.error)throw result.error;
    if(type==="payment"){
      const pending=String(body.paymentMode)==="Cheque";
      const voucherUpdate:any={handled_by:body.handledBy||currentMember.id,money_account_id:pending?null:body.moneyAccountId};
      if(pending){voucherUpdate.cheque_status="pending";voucherUpdate.cheque_cleared_at=null}
      const {error:attributionError}=await supabase.from("vouchers").update(voucherUpdate).eq("id",voucherId);if(attributionError)throw attributionError;
      if(pending){
        const {error:pendingError}=await supabase.rpc("set_received_cheque_status",{p_voucher_id:voucherId,p_status:"pending",p_destination_account_id:null,p_approved_by:currentMember.id});if(pendingError)throw pendingError;
      }else{
        const movementValues={to_account_id:body.moneyAccountId,from_account_id:null,amount:Number(body.amount),movement_date:String(body.date),payment_mode:String(body.paymentMode||"Cash"),handled_by:body.handledBy||currentMember.id,title:String(body.particulars||"Payment received"),status:"posted",posted_at:new Date().toISOString()};
        const {data:updatedMovements,error:movementError}=await supabase.from("money_movements").update(movementValues).eq("voucher_id",voucherId).select("id");if(movementError)throw movementError;
        if(!updatedMovements?.length){
        const {data:legacyVoucher,error:legacyError}=await supabase.from("vouchers").select("company_id,fiscal_year_id,party_id,voucher_no").eq("id",voucherId).single();if(legacyError)throw legacyError;
        const {error:insertMovementError}=await supabase.from("money_movements").insert({...movementValues,company_id:legacyVoucher.company_id,fiscal_year_id:legacyVoucher.fiscal_year_id,voucher_id:voucherId,movement_type:"customer_receipt",party_id:legacyVoucher.party_id,generated_by:currentMember.id,reference:legacyVoucher.voucher_no,notes:String(body.particulars||"")});if(insertMovementError)throw insertMovementError;
        }
      }
    }
    const {data:voucher}=await supabase.from("vouchers").select("fiscal_year_id,company_id").eq("id",voucherId).single();
    if(voucher)await supabase.rpc("refresh_future_opening_balances",{p_company_id:voucher.company_id,p_from_fiscal_year_id:voucher.fiscal_year_id});
    return NextResponse.json(await snapshot(voucher?.fiscal_year_id));
  }catch(error:any){return NextResponse.json({error:error?.message||"Could not update voucher"},{status:500})}
}
