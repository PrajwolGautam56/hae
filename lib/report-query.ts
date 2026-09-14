/** PostgREST caps each response. Page all report rows in deterministic order. */
export async function allReportRows(query: any): Promise<any[]> {
  const rows: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error)
      throw new Error(error.message || "Report records could not load");
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
