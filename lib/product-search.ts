export type SearchProduct = {id:string;name:string;sku?:string|null;stock_qty?:number;unit?:string;item_type?:string;sale_price?:number;purchase_price?:number};
const normal=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim();
export function matchingProducts<T extends SearchProduct>(products:T[],query:string,limit=25):T[]{
  const text=normal(query),tokens=text.split(" ").filter(Boolean);
  const compact=(value:string)=>value.replace(/[\s\-_/\.]+/g,"");
  return products.map((product,index)=>{const name=normal(product.name),sku=normal(product.sku||""),haystack=`${name} ${sku}`,alias=compact(haystack);return{product,index,match:tokens.every(token=>haystack.includes(token)||(compact(token)!==""&&alias.includes(compact(token)))),score:!text?3:name===text||sku===text?0:name.startsWith(text)||sku.startsWith(text)?1:name.split(" ").some(word=>word.startsWith(text))?2:3};}).filter(row=>row.match).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,limit).map(row=>row.product);
}
