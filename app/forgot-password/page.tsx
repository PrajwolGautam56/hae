"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function ForgotPassword() {
  const [companySlug, setCompanySlug] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCompanySlug(new URLSearchParams(window.location.search).get("company") || ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function send() {
    if (!companySlug) return setMessage("Return to sign in and choose your company first.");
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, companySlug }),
    });
    const data = await response.json();
    setBusy(false);
    setMessage(data.message || data.error || "Could not send email");
  }

  return <main className="login-page"><section className="login-card"><div className="login-brand"><Image src="/hamro-afno-logo.jpeg" width={52} height={52} alt="Hamro Aafno Enterprises"/><div><strong>Hamro Aafno Enterprises</strong><span>Secure account recovery</span></div></div><div className="login-copy"><small>PASSWORD RECOVERY</small><h1>Reset password</h1><p>Enter the team email assigned by the company you selected.</p></div>{!companySlug&&<div className="login-error">Choose a company before requesting a password reset.</div>}<label>Email address<input autoFocus type="email" value={email} onChange={event=>setEmail(event.target.value)} onKeyDown={event=>event.key==="Enter"&&send()} autoComplete="email"/></label>{message&&<div className="reset-message">{message}</div>}<button className="primary" disabled={busy||!email||!companySlug} onClick={send}>{busy?"Sending email…":"Email reset link"}</button><a href={companySlug?`/login?company=${encodeURIComponent(companySlug)}`:"/login"}>← Return to company sign in</a><footer>For security, reset links expire and can only be used once.</footer></section></main>;
}
