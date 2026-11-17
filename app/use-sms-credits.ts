"use client";
import {useCallback, useEffect, useRef, useState} from "react";

const changedEvent = "hae:sms-credits-changed";
export function refreshSmsCredits() { window.dispatchEvent(new Event(changedEvent)); }

/** Lightweight, authenticated polling; never reload the invoice/ageing reports just to sync credits. */
export function useSmsCredits(companyId: string, refreshVersion: number, active = true) {
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController(); controller.current = next; setRefreshing(true);
    try {
      const response = await fetch("/api/sms/wallet", {cache: "no-store", signal: AbortSignal.any([next.signal, AbortSignal.timeout(12_000)])});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not refresh SMS credits");
      if (body.companyId !== companyId) throw new Error("Company changed. Reload this workspace before sending.");
      if (!next.signal.aborted) { setData(body); setError(""); }
    } catch (cause: any) {
      if (!next.signal.aborted) setError(cause.message || "Could not refresh SMS credits. Try Refresh credits.");
    } finally { if (!next.signal.aborted) setRefreshing(false); }
  }, [companyId]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener(changedEvent, visibleRefresh);
    return () => { controller.current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", visibleRefresh); document.removeEventListener("visibilitychange", visibleRefresh); window.removeEventListener(changedEvent, visibleRefresh); };
  }, [active, refresh, refreshVersion]);
  return {data, error, refreshing, refresh};
}
