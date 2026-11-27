"use client";
import { useEffect, useRef, useState } from "react";
import "./company-manufacturing-control.css";
export default function CompanyManufacturingControl({
  companyId,
  companyName,
  clientEnabled,
  override,
  canManage,
  onSaved,
}: {
  companyId: string;
  companyName: string;
  clientEnabled: boolean;
  override: boolean | null;
  canManage: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState(
      override === null ? "inherit" : String(override),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    setSelected(override === null ? "inherit" : String(override));
  }, [companyId, override]);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setCompanyManufacturing",
          companyId,
          enabled: selected === "inherit" ? null : selected === "true",
          expectedOverride: override,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not save company module access");
      setNotice(body.notice || "Company manufacturing access saved.");
      await onSaved();
    } catch (error: any) {
      setError(error.message || "Could not save company manufacturing");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="company-manufacturing-control">
      <strong>Manufacturing · {companyName}</strong>
      <p>
        Current access:{" "}
        <b>{clientEnabled && override !== false ? "Enabled" : "Disabled"}</b>.
        This company only; other companies are not changed.
      </p>
      {!clientEnabled && (
        <p>
          Manufacturing is disabled in this client's subscription. Enable that
          module under Client → Subscription before enabling it here.
        </p>
      )}
      <label>
        Company module setting
        <select
          aria-label="Company manufacturing setting"
          disabled={busy || !canManage}
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setError("");
            setNotice("");
          }}
        >
          <option value="inherit">Use client subscription</option>
          <option value="true" disabled={!clientEnabled}>
            Enable manufacturing
          </option>
          <option value="false">Disable manufacturing · trading only</option>
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !canManage}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save manufacturing access"}
      </button>
      <small>
        Disabling hides Manufacturing, BOM and production actions and blocks
        their APIs. Existing bills, products, stock and production history are
        retained.
      </small>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
