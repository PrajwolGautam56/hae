/** Acknowledge committed writes without coupling success to an expensive dashboard read. */
export async function accountingMutationResponse<T>(
  prefer: string | null,
  fiscalYearId: string,
  readSnapshot: () => Promise<T>,
  savedRecord?: { id?: string; number?: string; sequence?: number },
) {
  if (prefer?.split(",").some(value => value.trim().toLowerCase() === "return=minimal")) {
    return { saved: true as const, fiscalYearId, refreshRequired: true, ...(savedRecord ? { savedRecord } : {}) };
  }
  return readSnapshot();
}
