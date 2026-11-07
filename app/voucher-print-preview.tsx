"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkDialog } from "./use-work-dialog";
import "./work-documents.css";

export default function VoucherPrintPreview({ html, close }: { html: string; close: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  useWorkDialog(true, close);
  async function print() {
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    setPrinting(true); setError("");
    try {
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images).map(image => image.decode()));
      win.focus(); win.print();
    } catch { setError("The company logo could not load. Please check your connection and retry."); }
    finally { setPrinting(false); }
  }
  return createPortal(<div className="work-overlay"><section className="work-dialog document-preview" role="dialog" aria-modal="true" aria-label="A4 invoice print preview"><header><div><small>A4 · PRINT PREVIEW</small><h2>Invoice / receipt</h2><p>Choose A4, scale 100%, and turn off “Headers and footers” to remove the browser URL and date.</p></div><button aria-label="Close print preview" onClick={close}>×</button></header><iframe ref={frame} title="Printable invoice or receipt" sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={() => setReady(true)} /><footer>{error && <p role="alert" className="work-error">{error}</p>}<button onClick={close}>Back</button><button className="primary" disabled={!ready || printing} onClick={() => void print()}>{printing ? "Preparing…" : "Print / Save PDF"}</button></footer></section></div>, document.body);
}
