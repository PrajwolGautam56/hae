export type InvoiceDraftNumber = number | "";

// Blank is a real editing state, not zero. Zero remains valid for a free item.
export function invoiceDraftNumber(value: string): InvoiceDraftNumber {
  return value === "" ? "" : Number(value);
}

export function invalidInvoiceLine(lines: { productId: string; name: string; quantity: InvoiceDraftNumber; rate: InvoiceDraftNumber }[]): number {
  return lines.findIndex(line => {
    const started = Boolean(line.productId || line.name.trim() || line.rate !== "");
    return started && (!line.name.trim() || line.quantity === "" || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.rate === "" || !Number.isFinite(line.rate) || line.rate < 0);
  });
}
