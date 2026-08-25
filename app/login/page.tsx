"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type CompanyOption = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "pending" | "disabled";
  loginEnabled: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("Hamro Business Group");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/platform/companies", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Workspace could not be loaded");
        setTenantName(data.tenant.name);
        setCompanies(data.companies || []);
        const requested = new URLSearchParams(window.location.search).get("company");
        const requestedCompany = (data.companies || []).find((company: CompanyOption) => company.slug === requested && company.loginEnabled);
        if (requestedCompany) setSelected(requestedCompany);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Workspace could not be loaded");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, companySlug: selected.slug }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Could not sign in");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  function choose(company: CompanyOption) {
    if (!company.loginEnabled) return;
    setSelected(company);
    setEmail("");
    setPassword("");
    setError("");
  }

  return (
    <main className="login-page">
      <section className="login-card company-login-card">
        <div className="login-brand">
          <Image src="/hamro-afno-logo.jpeg" width={52} height={52} alt="Kritech Global" />
          <div><strong>{tenantName}</strong><span>Secure multi-company workspace</span></div>
        </div>

        {!selected ? (
          <>
            <div className="login-copy">
              <small>COMPANY ACCESS</small>
              <h1>Choose your company</h1>
              <p>Select the company first. Your username and password will only be checked against that company.</p>
            </div>
            <div className="company-picker" aria-busy={loading}>
              {loading && <div className="company-picker-loading">Loading companies…</div>}
              {!loading && companies.map((company) => (
                <button key={company.id} type="button" className={`company-option ${company.loginEnabled ? "" : "pending"}`} disabled={!company.loginEnabled} onClick={() => choose(company)}>
                  <span className="company-option-mark">{company.name.charAt(0)}</span>
                  <span className="company-option-copy"><strong>{company.name}</strong><small>{company.loginEnabled ? "Continue to staff login" : "Setup pending · available later"}</small></span>
                  <span className="company-option-arrow" aria-hidden="true">{company.loginEnabled ? "→" : "⌛"}</span>
                </button>
              ))}
            </div>
            {error && <div className="login-error">{error}</div>}
          </>
        ) : (
          <>
            <button type="button" className="company-back" onClick={() => { setSelected(null); setError(""); }}>← Change company</button>
            <div className="login-copy company-login-copy">
              <small>STAFF SIGN IN</small>
              <h1>{selected.name}</h1>
              <p>Use the staff account assigned by this company.</p>
            </div>
            <label>Email address<input autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} autoComplete="current-password" /></label>
            {error && <div className="login-error">{error}</div>}
            <button className="primary" disabled={busy || !email || !password} onClick={login}>{busy ? "Signing in…" : "Sign in to company"}</button>
            <a href={`/forgot-password?company=${encodeURIComponent(selected.slug)}`}>Forgot or reset password?</a>
          </>
        )}
        <footer>Protected company data · Authorized users only</footer>
      </section>
    </main>
  );
}
