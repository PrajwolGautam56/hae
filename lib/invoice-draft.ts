export type InvoiceDraft = {
  formParty: string;
  partySearch: string;
  newPartyName: string;
  place: string;
  phone: string;
  taxNo: string;
  transactionDate: string;
  dueDate: string;
  particulars: string;
  billCategory: string;
  taxPercent: number;
  discountPercent: number;
  supplierBillNo: string;
  saleLines: Array<{ productId: string; name: string; quantity: number | ""; rate: number | ""; unit?: string; itemType?: string }>;
};

const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

export function invoiceDraftKey(companyId?: string, memberId?: string, fiscalYearId?: string): string | null {
  return companyId && memberId && fiscalYearId ? `hae-invoice-draft:${companyId}:${memberId}:${fiscalYearId}` : null;
}

function hasContent(draft: InvoiceDraft): boolean {
  return Boolean(draft.formParty || draft.partySearch.trim() || draft.newPartyName.trim() || draft.place.trim() || draft.phone.trim() || draft.taxNo.trim() || draft.dueDate || draft.particulars.trim() || draft.saleLines.some(line => line.productId || line.name.trim() || line.rate !== "" || line.quantity !== 1));
}

export function saveInvoiceDraft(key: string, draft: InvoiceDraft, storage: Pick<Storage, "setItem" | "removeItem"> = sessionStorage) {
  try {
    if (hasContent(draft)) storage.setItem(key, JSON.stringify({ savedAt: Date.now(), draft }));
    else storage.removeItem(key);
    return true;
  } catch { return false; /* The live form remains intact if browser storage is disabled/full. */ }
}

export function loadInvoiceDraft(key: string, storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): InvoiceDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > maxAgeMs || !value.draft || !Array.isArray(value.draft.saleLines) || value.draft.saleLines.length > 100 || typeof value.draft.transactionDate !== "string" || typeof value.draft.formParty !== "string") {
      storage.removeItem(key);
      return null;
    }
    return value.draft as InvoiceDraft;
  } catch { return null; }
}

export function clearInvoiceDraft(key: string, storage: Pick<Storage, "removeItem"> = sessionStorage) {
  try { storage.removeItem(key); } catch { /* Best effort. */ }
}
