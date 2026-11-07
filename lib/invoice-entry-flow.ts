/** Only creating a new sale starts another entry. Updates and other vouchers close normally. */
export function continueSalesEntry(type: string | null, editingVoucherId: string) {
  return type === "sale" && !editingVoucherId;
}

export function nextInvoicePreview(savedSequence: unknown): number | null {
  const value = Number(savedSequence);
  return Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? value + 1 : null;
}
