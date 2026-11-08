"use client";

import "./report-voucher-reference.css";

export default function ReportVoucherReference({voucherId,reference,label,onOpen}: {
  voucherId?: string | null;
  reference?: string | number | null;
  label?: string;
  onOpen?: (id: string) => void;
}) {
  const text = reference == null || reference === "" ? "View record" : String(reference);
  if (!voucherId || !onOpen) return <strong>{reference == null || reference === "" ? "—" : text}</strong>;
  return <button type="button" className="report-voucher-link" aria-label={`Open ${label || "voucher"} ${text}`} title="View full record" onClick={()=>onOpen(voucherId)}><strong>{text}</strong><span aria-hidden="true">↗</span></button>;
}
