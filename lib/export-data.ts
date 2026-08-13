export type ExportColumn<T>={label:string;value:(row:T)=>unknown};
const safe=(value:unknown)=>{let text=String(value??"");if(/^[=+\-@]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`};
export function downloadCsv<T>(filename:string,rows:T[],columns:ExportColumn<T>[]){
  const csv=[columns.map(x=>safe(x.label)).join(","),...rows.map(row=>columns.map(x=>safe(x.value(row))).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=`${filename.replace(/[^a-z0-9-_]+/gi,"-")}.csv`;a.click();URL.revokeObjectURL(url);
}
export function printDocument(mode:"report"|"voucher"="report"){
  const name=`print-${mode}`;document.body.classList.add(name);
  const clear=()=>document.body.classList.remove(name);window.addEventListener("afterprint",clear,{once:true});window.print();setTimeout(clear,1500);
}
