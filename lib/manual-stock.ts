const uuid=(value:unknown)=>typeof value==="string"&&/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export function manualStockInput(body:any){
  if(!uuid(body.productId)||!uuid(body.fiscalYearId)||!uuid(body.requestId))throw new Error("Select a product and fiscal year, then open a fresh stock adjustment");
  if(!["add","remove","count"].includes(body.mode))throw new Error("Select add, remove or counted total");
  if(body.quantity===""||body.quantity===null||body.quantity===undefined)throw new Error("Enter the stock quantity");
  const quantity=Number(body.quantity),expectedStock=Number(body.expectedStock),expectedCost=Number(body.expectedCost);
  if(!Number.isFinite(quantity)||quantity<0||quantity>1e9||(body.mode!=="count"&&quantity===0)||Math.abs(quantity*1000-Math.round(quantity*1000))>0.00001)throw new Error("Use a valid quantity with up to 3 decimal places");
  if(body.expectedStock===null||body.expectedStock===undefined||body.expectedCost===null||body.expectedCost===undefined||!Number.isFinite(expectedStock)||!Number.isFinite(expectedCost)||expectedCost<0)throw new Error("Refresh current stock and cost before saving");
  const reason=String(body.reason||"").trim();if(reason.length<3||reason.length>1000)throw new Error("Add a reason for this manual stock adjustment (3–1,000 characters)");
  const date=String(body.date||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error("Select a valid adjustment date");
  return{productId:body.productId,fiscalYearId:body.fiscalYearId,requestId:body.requestId,mode:body.mode,quantity,expectedStock,expectedCost,reason,date};
}
