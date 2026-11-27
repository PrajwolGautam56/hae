import{manualStockInput}from"./manual-stock";
export const stockRequestKey=(companyId:string,productId:string,fiscalYearId:string)=>`hae-manual-stock:${companyId}:${productId}:${fiscalYearId}`;
export function readStockRequest(storage:Pick<Storage,"getItem">,key:string,scope:{companyId:string;productId:string;fiscalYearId:string}){
 const raw=storage.getItem(key);if(!raw)return null;
 const pending=JSON.parse(raw);manualStockInput({...pending.body,requestId:pending.id});
 if(pending.body.companyId!==scope.companyId||pending.body.productId!==scope.productId||pending.body.fiscalYearId!==scope.fiscalYearId)throw new Error("Stock recovery request belongs to a different company or product");
 return pending as {id:string;body:any};
}
