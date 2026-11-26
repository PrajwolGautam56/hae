import {readSheet} from "read-excel-file/node";
import {MAX_PRODUCT_IMPORT_BYTES} from "./product-name-import";

/** Bound ZIP metadata before the XML reader runs (including highly compressed workbooks). */
export function validateProductWorkbookZip(buffer: Buffer) {
  if (buffer.length>MAX_PRODUCT_IMPORT_BYTES) throw new Error("Excel file must be 2 MB or smaller");
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  if(end<0) throw new Error("Select a valid .xlsx workbook, not an old .xls file");
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
  if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||count>200||count===0||offset+size!==end) throw new Error("Workbook archive is too large or unsupported. Save a simple one-sheet .xlsx file.");
  let cursor=offset,total=0;const entries=new Set<string>();
  for(let i=0;i<count;i++){
    if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50) throw new Error("Workbook archive is damaged");
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),length=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32);
    const next=cursor+46+length+extra+comment;
    if(next>end||(flags&1)||![0,8].includes(method))throw new Error("Encrypted or unsupported Excel archive");
    total+=buffer.readUInt32LE(cursor+24);
    if(total>16*1024*1024)throw new Error("Expanded workbook is too large. Use a simple product-name worksheet.");
    const name=buffer.toString("utf8",cursor+46,cursor+46+length);
    if(entries.has(name)||name.includes("..")||name.startsWith("/")||/vbaProject|externalLinks/i.test(name))throw new Error("Use a workbook without macros or external links");
    entries.add(name);cursor=next;
  }
  if(cursor!==end||!entries.has("xl/workbook.xml")||!entries.has("[Content_Types].xml"))throw new Error("Select a valid .xlsx workbook");
}

export async function readProductWorkbook(file: File) {
  if(!/\.xlsx$/i.test(file.name))throw new Error("Choose an Excel .xlsx file. Save old .xls files as .xlsx first.");
  if(file.size>MAX_PRODUCT_IMPORT_BYTES)throw new Error("Excel file must be 2 MB or smaller");
  const buffer=Buffer.from(await file.arrayBuffer());validateProductWorkbookZip(buffer);
  try{return await readSheet(buffer,1) as unknown[][];}
  catch{throw new Error("Could not read this workbook. Save a simple .xlsx file with Product Name in the first column.");}
}
