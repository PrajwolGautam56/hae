"use client";
import {useRef,useState} from "react";
import type {ProductImportType,ProductImportRow} from "../lib/product-name-import";
import "./product-import-panel.css";

type Preview={rows:ProductImportRow[];newCount:number;existingCount:number;duplicateCount:number;invalidCount:number;total:number;previewHash:string;company:{id:string;name:string}};
const labels:Record<ProductImportType,string>={resale_good:"Resale product · ready to sell",finished_good:"Finished product · manufacturing output",raw_material:"Raw material · inventory",packaging:"Packaging · inventory"};
export default function ProductImportPanel({companyId,companyName,defaultType,onImported}:{companyId:string;companyName:string;defaultType:ProductImportType;onImported:()=>void|Promise<void>}){
  const[open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[type,setType]=useState(defaultType);
  const[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[search,setSearch]=useState("");
  const lock=useRef(false),fileInput=useRef<HTMLInputElement>(null);
  function clearPreview(){setPreview(null);setError("");setNotice("");setSearch("");}
  async function submit(action:"preview"|"import"){
    if(lock.current||!file)return;
    lock.current=true;setBusy(true);setError("");setNotice("");
    const form=new FormData();form.set("file",file);form.set("action",action);form.set("productType",type);form.set("companyId",companyId);if(preview)form.set("previewHash",preview.previewHash);
    try{
      const response=await fetch("/api/products/import",{method:"POST",body:form});const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Product import failed");
      if(action==="preview")setPreview(body);
      else{
        setPreview(null);setFile(null);if(fileInput.current)fileInput.current.value="";
        setNotice(`${body.created} product names added; ${body.skipped} existing / repeated names skipped. Stock quantities and existing prices were not changed.`);
        try{await onImported();}catch{setError("Product names were saved, but the register could not refresh. Reload this page; re-uploading the same file will skip existing names.");}
      }
    }catch(cause:any){
      setError(cause instanceof TypeError||cause instanceof SyntaxError?"Connection interrupted. Preview the same file again to check which names are already saved. Existing products are never overwritten.":cause.message);
      if(action==="import")setPreview(null);
    }finally{lock.current=false;setBusy(false);}
  }
  const visible=preview?.rows.filter(row=>`${row.name} ${row.status}`.toLowerCase().includes(search.toLowerCase()))||[];
  return <section className="card product-import-panel" aria-label="Bulk product name import">
    <button type="button" className="product-import-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Import product names · Excel<span aria-hidden="true">{open?"−":"＋"}</span></button>
    {open&&<div className="product-import-body">
      <p>Import into <strong>{companyName}</strong>. Creates product names only, with zero opening stock. Add stock later through purchases, production or your normal stock workflow.</p>
      <p>Use one column headed <strong>Product Name</strong>, one full product / pack-size name per row. Only the first worksheet is read. No prices or quantities. Up to 1,000 names, .xlsx only, 2 MB maximum.</p>
      <a className="product-import-template" href="/templates/product-names.xlsx" download>Download blank Excel template</a>
      <div className="product-import-fields"><label>Excel file<input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>{clearPreview();setFile(event.target.files?.[0]||null);}}/></label><label>Product type<select value={type} disabled={busy} onChange={event=>{clearPreview();setType(event.target.value as ProductImportType);}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      <p>Unit starts as pcs (one pack/item). Edit product details later if needed. Existing names—including inactive products—are skipped, not replaced.</p>
      <button type="button" className="primary soft" disabled={busy||!file} onClick={()=>void submit("preview")}>{busy?"Working…":"Preview product names"}</button>
      {error&&<p className="product-import-error" role="alert">{error}</p>}{notice&&<p className="product-import-success" role="status">{notice}</p>}
      {preview&&<div className="product-import-preview"><h3>Review for {preview.company.name}</h3><div className="product-import-summary"><span><strong>{preview.newCount}</strong> new</span><span><strong>{preview.existingCount}</strong> already exist</span><span><strong>{preview.duplicateCount}</strong> repeated in file</span><span><strong>{preview.invalidCount}</strong> need correction</span></div>
        <label>Search preview<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Product name or status"/></label>
        <div className="product-import-table"><table><thead><tr><th>Excel row</th><th>Product name</th><th>Result</th></tr></thead><tbody>{visible.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.name||"—"}</td><td><span className={`product-import-status ${row.status}`}>{row.status==="new"?"Will add":row.status==="invalid"?"Fix row":"Skip"}</span>{row.reason&&<small>{row.reason}</small>}</td></tr>)}</tbody></table>{!visible.length&&<p>No matching names in this preview.</p>}</div>
        {preview.invalidCount>0&&<p role="alert">Correct the marked Excel rows, select the corrected file and preview again. Nothing has been imported.</p>}
        <button type="button" className="primary" disabled={busy||preview.invalidCount>0||preview.newCount===0} onClick={()=>void submit("import")}>{busy?"Importing…":`Import ${preview.newCount} product name${preview.newCount===1?"":"s"}`}</button>
      </div>}
    </div>}
  </section>;
}
