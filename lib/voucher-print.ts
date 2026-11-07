const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

// documentMarkup comes only from React's rendered voucher document, never raw user HTML.
export function voucherPrintHtml(documentMarkup: string, title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#172333;font-family:Arial,"Noto Sans Devanagari",sans-serif;font-size:10pt;line-height:1.45}
body{padding:12mm}.voucher-document{width:100%;max-width:186mm;margin:0 auto;height:auto;max-height:none;overflow:visible}
.voucher-print-heading{font-size:16pt;margin:0 0 7mm;overflow-wrap:anywhere}
.voucher-company{display:flex;align-items:center;gap:5mm;padding-bottom:5mm;border-bottom:2px solid #294b75;break-inside:avoid}
.voucher-company img{width:24mm;height:24mm;object-fit:contain}.voucher-company>div{min-width:0}.voucher-company strong{font-size:16pt}.voucher-company span,.voucher-company small{display:block}.voucher-status{margin-left:auto;text-align:right;font-size:9pt}
.voucher-meta{display:grid;grid-template-columns:2fr 1fr 1fr;gap:5mm;padding:5mm 0;break-inside:avoid}.voucher-meta>div,.voucher-audit>span{min-width:0}.voucher-meta small,.voucher-meta strong,.voucher-meta span{display:block}.voucher-meta strong{margin:1mm 0}small{font-size:8pt;color:#526176}span,strong,p,td{overflow-wrap:anywhere}
.voucher-audit{display:flex;flex-wrap:wrap;gap:5mm;padding:3mm 0;border-top:1px solid #dce2e9;border-bottom:1px solid #dce2e9;break-inside:avoid}.voucher-audit small,.voucher-audit strong{display:block}
.voucher-lines{overflow:visible;margin:5mm 0}table{width:100%;min-width:0;border-collapse:collapse;table-layout:fixed;font-size:9pt}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{padding:2.5mm 2mm;text-align:left;vertical-align:top;border-bottom:1px solid #dce2e9;white-space:normal}th{background:#edf2f8;color:#294b75;font-size:8pt}th:first-child{width:6%}th:nth-child(2){width:43%}th:nth-child(3){width:12%}th:nth-child(4){width:18%}th:nth-child(5){width:21%}td:nth-child(n+3),th:nth-child(n+3){text-align:right}td small{display:block}
.voucher-settlement{break-inside:avoid;page-break-inside:avoid;margin-top:4mm}.voucher-totals{width:85mm;max-width:100%;margin-left:auto}.voucher-totals>div{display:flex;justify-content:space-between;gap:5mm;padding:1.5mm 0}.voucher-totals .grand{border-top:2px solid #294b75;font-size:12pt;padding-top:3mm;margin-top:2mm}
.amount-in-words{margin:5mm 0 0;padding:3mm 0;border-top:1px solid #dce2e9}.amount-in-words small{display:block;margin-bottom:1mm}.amount-in-words strong{font-size:10pt}
.receipt-panel{display:grid;grid-template-columns:1fr 1fr;gap:5mm;padding:5mm 0;break-inside:avoid}.receipt-panel small,.receipt-panel strong{display:block}.voucher-note{margin-top:5mm;white-space:pre-wrap}.voucher-note p{margin:1mm 0}.cheque-status{display:block}
@media print{body{padding:0}.voucher-document{max-width:none}.voucher-print-heading{break-after:avoid}.voucher-company{break-after:avoid}}
</style></head><body><div class="voucher-document"><h1 class="voucher-print-heading">${escape(title)}</h1>${documentMarkup}</div></body></html>`;
}
