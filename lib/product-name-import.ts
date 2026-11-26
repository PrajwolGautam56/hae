export const MAX_PRODUCT_IMPORT_ROWS = 1000;
export const MAX_PRODUCT_IMPORT_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMPORT_TYPES = ["resale_good", "finished_good", "raw_material", "packaging"] as const;
export type ProductImportType = typeof PRODUCT_IMPORT_TYPES[number];
export type ProductImportRow = {row: number; name: string; status: "new" | "existing" | "duplicate" | "invalid"; reason?: string};
export function productNameKey(name: string) { return name.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase(); }

/** Validate the actual worksheet, not browser-supplied product objects or stock quantities. */
export function previewProductNames(rows: unknown[][], existing: {name: string}[]) {
  if (!Array.isArray(rows)) throw new Error("Could not read the product worksheet");
  const populated = rows.map((cells,index)=>({cells,row:index+1})).filter(({cells})=>cells.some(value=>value!==null&&value!==undefined&&value!==""));
  const first = populated[0];
  if (first && typeof first.cells[0]==="string" && ["productname","product","name","प्रोडक्टनाम","नाम"].includes(first.cells[0].toLowerCase().replace(/[\s_-]+/g,""))) {
    if (first.cells.slice(1).some(value=>value!==null&&value!==undefined&&value!=="")) throw new Error("Use one Product Name column only. Remove price, quantity and other columns first.");
    populated.shift();
  }
  if (!populated.length) throw new Error("Add product names below the Product Name header");
  if (populated.length>MAX_PRODUCT_IMPORT_ROWS) throw new Error(`Import up to ${MAX_PRODUCT_IMPORT_ROWS} product names at a time`);
  const known = new Set(existing.map(product=>productNameKey(product.name))), seen = new Set<string>();
  const result: ProductImportRow[] = populated.map(({cells,row})=>{
    const value=cells[0];
    if (cells.slice(1).some(value=>value!==null&&value!==undefined&&value!=="")) return {row,name:typeof value==="string"?value:"",status:"invalid",reason:"Only one Product Name column is allowed; remove other values"};
    if (typeof value!=="string") return {row,name:"",status:"invalid",reason:"Product name must be text in the first column"};
    const name=value.normalize("NFKC").trim().replace(/\s+/g," ");
    if (!name || name.length>250 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(name) || name.startsWith("=")) return {row,name:name.slice(0,250),status:"invalid",reason:"Use a text name between 1 and 250 characters, not a formula"};
    const key=productNameKey(name);
    if (seen.has(key)) return {row,name,status:"duplicate",reason:"Repeated in this file; skipped"};
    seen.add(key);
    if (known.has(key)) return {row,name,status:"existing",reason:"Already exists in this company; left unchanged"};
    return {row,name,status:"new"};
  });
  return {rows:result,total:result.length,newCount:result.filter(row=>row.status==="new").length,existingCount:result.filter(row=>row.status==="existing").length,duplicateCount:result.filter(row=>row.status==="duplicate").length,invalidCount:result.filter(row=>row.status==="invalid").length};
}

export function newProductNameRows(companyId: string, type: ProductImportType, rows: ProductImportRow[]) {
  if (!PRODUCT_IMPORT_TYPES.includes(type)) throw new Error("Select a valid product type");
  if (rows.some(row=>row.status==="invalid")) throw new Error("Fix invalid worksheet rows before importing");
  return rows.filter(row=>row.status==="new").map(row=>({company_id:companyId,name:row.name,item_type:type,unit:"pcs",sku:null,stock_qty:0,sale_price:0,purchase_price:0,mrp:0,low_stock_at:0,active:true}));
}
