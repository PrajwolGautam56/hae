export type DocumentLine = { description: string; quantity: number; rate: number; unit: string; amount?: number };
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function documentTotals(lines: DocumentLine[], discountPercent: number, taxPercent: number, mode: string) {
  const subtotal = round(lines.reduce((sum, line) => sum + round(line.quantity * line.rate), 0));
  const discount = round(subtotal * discountPercent / 100);
  const net = round(subtotal - discount);
  const taxable = mode === "inclusive" ? round(net / (1 + taxPercent / 100)) : net;
  const tax = mode === "inclusive" ? round(net - taxable) : mode === "exclusive" ? round(net * taxPercent / 100) : 0;
  return { subtotal, discount, taxable, tax, total: mode === "exclusive" ? round(net + tax) : net };
}
export function commercialInput(body: Record<string, unknown>) {
  const text = (key: string, max = 500) => { const value = String(body[key] || "").trim(); if (value.length > max) throw new Error(`${key} is too long`); return value; };
  const documentType = text("documentType");
  if (!["quotation", "proforma"].includes(documentType)) throw new Error("Choose quotation or pro forma invoice");
  const recipientName = text("recipientName", 250);
  if (!recipientName) throw new Error("Recipient full name / company is required");
  const date = text("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("Select a valid document date");
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) throw new Error("Add 1 to 100 items");
  const lines: DocumentLine[] = body.lines.map((line: Record<string, unknown>) => {
    const description = String(line.description || "").trim();
    const quantity = Number(line.quantity), rate = Number(line.rate);
    if (!description || description.length > 2000 || !Number.isFinite(quantity) || quantity < 0.001 || quantity > 1e8 || !Number.isFinite(rate) || rate < 0 || rate > 1e8) throw new Error("Each item needs a description, a positive quantity and a non-negative rate");
    return { description, quantity: Math.round(quantity * 1000) / 1000, rate: round(rate), unit: String(line.unit || "").slice(0,30) };
  });
  const taxMode = text("taxMode");
  if (!["inclusive", "exclusive", "none"].includes(taxMode)) throw new Error("Choose whether VAT is included, extra or not applicable");
  const discountPercent = Number(body.discountPercent || 0), taxPercent = taxMode === "none" ? 0 : Number(body.taxPercent || 0);
  if (![discountPercent, taxPercent].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) throw new Error("Discount and VAT percentages must be between 0 and 100");
  return { documentType, recipientName, date, lines, taxMode, discountPercent, taxPercent, recipientPan: text("recipientPan", 50), recipientAddress: text("recipientAddress"), issuerPan: text("issuerPan", 50), subject: text("subject"), terms: text("terms", 10000), deliveryTerms: text("deliveryTerms", 1000), bankName: text("bankName", 150), bankAccount: text("bankAccount", 100), bankHolder: text("bankHolder", 250), itemHeading: text("itemHeading", 80) || "Item / Description" };
}
