export function partyDetailsInput(body: Record<string, unknown>) {
  const name=String(body.name || "").trim();
  const address=String(body.address || "").trim();
  const phone=String(body.phone || "").trim();
  const taxNo=String(body.taxNo || "").trim();
  if(!name || name.length>250)throw new Error("Party name is required (up to 250 characters)");
  if(address.length>1000 || phone.length>60 || taxNo.length>50)throw new Error("Party contact details are too long");
  if(!Number.isSafeInteger(body.revision) || Number(body.revision)<1)throw new Error("Reopen the editor to load the latest party details");
  return {name,address,phone,taxNo,revision:Number(body.revision)};
}
