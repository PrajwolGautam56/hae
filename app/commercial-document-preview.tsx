"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commercialPrintHtml } from "../lib/commercial-print";
import { formatBs } from "../lib/nepali-date";
import "./work-documents.css";
import { useWorkDialog } from "./use-work-dialog";
export default function CommercialDocumentPreview({ record, close }: { record: Record<string, any>; close: () => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const frame = useRef<HTMLIFrameElement>(null);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  useWorkDialog(true, close);
  async function print() {
    const doc = frame.current?.contentDocument; const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    setPrinting(true); setError("");
    try {
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images).map(image => image.decode()));
      win.focus(); win.print();
    } catch { setError("The logo could not load. Check your connection and retry before printing."); }
    finally { setPrinting(false); }
  }
  return createPortal(<div className="work-overlay"><section className="work-dialog document-preview" role="dialog" aria-modal="true" aria-label="Saved document preview"><header><div><small>SAVED DOCUMENT · #{record.sequence_no}</small><h2>Preview & print</h2></div><button aria-label="Close preview" onClick={close}>×</button></header><iframe ref={frame} title="Printable document" sandbox="allow-same-origin allow-modals" srcDoc={commercialPrintHtml(record, formatBs(record.document_date))} /><footer>{error && <p className="work-error" role="alert">{error}</p>}<button onClick={close}>Close</button><button className="primary" disabled={printing} onClick={() => void print()}>{printing ? "Preparing…" : "Print / Save PDF"}</button></footer></section></div>, document.body);
}
