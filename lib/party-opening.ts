import { cents } from "./accounting-report-model";

export function openingBalanceInput(body: Record<string, unknown>) {
  if (!["manual", "automatic"].includes(String(body.source))) throw new Error("Choose manual or automatic opening");
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new Error("Reload the latest opening balance before saving");
  const source = String(body.source);
  let amount = "0";
  if (source === "manual") {
    const value = String(body.amount ?? "").trim();
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount of zero or more, with at most two decimal places");
    if (!["debit", "credit"].includes(String(body.side))) throw new Error("Choose Debit or Credit");
    amount = body.side === "credit" && Number(value) !== 0 ? `-${value}` : value;
  }
  const note = String(body.note || "").trim();
  if (note.length > 1000) throw new Error("Opening balance note must be 1,000 characters or fewer");
  return { source, amount, note, revision: Number(body.revision) };
}

/** Manual year baselines replace prior balances; they must not be counted twice in the trial balance. */
export function openingFinancialAdjustments(parties: any[], openings: any[], years: any[], lines: any[], accounts: any[], through: string) {
  const first = years[0];
  if (!first) return [];
  const ar = accounts.find(a => a.system_key === "accounts_receivable")?.id;
  const ap = accounts.find(a => a.system_key === "accounts_payable")?.id;
  const result: Array<{ receivable: number; payable: number; equity: number }> = [];
  const byOpening = new Map(openings.map(o => [`${o.party_id}:${o.fiscal_year_id}`,o]));
  const byParty = new Map<string,any[]>();
  for (const line of lines) if (line.party_id && (line.account_id === ar || line.account_id === ap)) {
    const rows=byParty.get(line.party_id)||[]; rows.push(line); byParty.set(line.party_id,rows);
  }
  for (const party of parties) {
    const initial = cents(byOpening.get(`${party.id}:${first.id}`)?.amount ?? party.opening_balance);
    let adjustedAr = Math.max(initial, 0), adjustedAp = Math.min(initial, 0);
    for (const year of years.filter(y => y.start_ad > first.start_ad && y.start_ad <= through)) {
      const opening = byOpening.get(`${party.id}:${year.id}`);
      if (opening?.balance_source !== "manual") continue;
      const history = (byParty.get(party.id)||[]).filter(l => l.effective_date < year.start_ad);
      const priorAr = adjustedAr + history.filter(l => l.account_id === ar).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0);
      const priorAp = adjustedAp + history.filter(l => l.account_id === ap).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0);
      const target = cents(opening.amount);
      const receivable = Math.max(target, 0) - priorAr;
      const payable = Math.min(target, 0) - priorAp;
      adjustedAr += receivable;
      adjustedAp += payable;
      result.push({ receivable, payable, equity: -receivable - payable });
    }
  }
  return result;
}
