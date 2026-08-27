"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Company = { id: string; slug: string; name: string; status: string; loginEnabled: boolean };

export default function ClientLoginPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState("Customer portal");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/platform/companies", { cache: "no-store" }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Workspace could not load");
    setTenant(body.tenant.name); setCompanies((body.companies || []).filter((item: Company) => item.loginEnabled));
    const requested = new URLSearchParams(window.location.search).get("company");
    setCompany((body.companies || []).find((item: Company) => item.slug === requested && item.loginEnabled) || null);
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Workspace could not load")); }, []);
  async function login() {
    if (!company) return;
    setBusy(true); setError("");
    const response = await fetch("/api/client/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, companySlug: company.slug }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error || "Could not sign in");
    router.replace("/client"); router.refresh();
  }
  return <main className="client-login-page"><section className="client-login-card"><div className="client-login-brand"><img src="/hamro-afno-logo.jpeg" alt="Kritech customer portal"/><span><strong>{tenant}</strong><small>Secure customer account</small></span></div>{!company?<><div className="client-login-copy"><small>CUSTOMER PORTAL</small><h1>Choose your company</h1><p>Your ledger and orders are isolated inside the selected company.</p></div><div className="company-picker">{companies.map((item)=><button className="company-option" type="button" key={item.id} onClick={()=>{setCompany(item);setError("")}}><span className="company-option-mark">{item.name[0]}</span><span className="company-option-copy"><strong>{item.name}</strong><small>Open customer login</small></span><span>→</span></button>)}</div></>:<><button className="company-back" type="button" onClick={()=>setCompany(null)}>← Change company</button><div className="client-login-copy"><small>CUSTOMER PORTAL</small><h1>{company.name}</h1><p>View your ledger, orders and delivery status.</p></div><label>Email address<input autoFocus type="email" value={email} onChange={(event)=>setEmail(event.target.value)} autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&void login()} autoComplete="current-password"/></label><a className="client-forgot-link" href={`/client-forgot-password?company=${encodeURIComponent(company.slug)}`}>Forgot password?</a><button className="client-login-button" disabled={busy||!email||!password} onClick={()=>void login()}>{busy?"Signing in…":"Open customer portal"}</button></>}{error&&<div className="login-error">{error}</div>}<footer>Private access for registered customers only</footer></section></main>;
}
