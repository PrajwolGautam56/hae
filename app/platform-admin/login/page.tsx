"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PlatformAdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true); setError("");
    const response = await fetch("/api/platform/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) return setError(data.error || "Could not sign in");
    router.replace("/platform-admin"); router.refresh();
  }

  return <main className="pc-auth-page"><section className="pc-auth-card"><div className="pc-auth-brand"><span>K</span><div><strong>Kritech Control</strong><small>Platform administration</small></div></div><div className="pc-auth-copy"><span>RESTRICTED ACCESS</span><h1>Manage every workspace.</h1><p>Secure control centre for Kritech clients, companies, subscriptions and deployment readiness.</p></div><label>Email address<input autoFocus type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} onKeyDown={event=>event.key==="Enter"&&login()} /></label>{error&&<div className="pc-alert error">{error}</div>}<button className="pc-button primary" disabled={busy||!email||!password} onClick={login}>{busy?"Signing in…":"Sign in securely"}</button><a href="/platform-admin/forgot-password">Activate access or reset password</a><footer>Authorized Kritech platform administrators only</footer></section></main>;
}
