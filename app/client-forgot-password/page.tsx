"use client";

import { useState } from "react";

export default function ClientForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMessage("");
    try {
      const companySlug = new URLSearchParams(window.location.search).get("company");
      const response = await fetch("/api/client/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, companySlug }) });
      const data = await response.json();
      setMessage(data.message || data.error || "Check your email for the secure password link.");
    } catch { setMessage("Could not request a password link. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="client-login-page"><section className="client-login-card"><div className="client-login-brand"><img src="/hamro-afno-logo.jpeg" alt="Hamro Afno Enterprises"/><span><strong>Customer portal</strong><small>Password assistance</small></span></div><div className="client-login-copy"><small>ACCOUNT RECOVERY</small><h1>Reset your password</h1><p>Enter the email registered by the Hamro Afno office.</p></div><label>Customer email<input autoFocus type="email" value={email} onChange={(event)=>setEmail(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&void send()} autoComplete="email"/></label>{message&&<div className="client-reset-message">{message}</div>}<button className="client-login-button" disabled={busy||!email} onClick={send}>{busy?"Sending…":"Send secure reset link"}</button><a className="client-login-link" href="/client-login">Return to customer login</a></section></main>;
}
