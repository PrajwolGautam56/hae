"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

export default function ResetPasswordPage() {
  const supabase = useMemo(
    () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "https://unconfigured.supabase.co",
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "unconfigured",
      ),
    [],
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("Verifying secure link…");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [companySlug, setCompanySlug] = useState("hamro-afno");
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const selectedCompany = params.get("company") || "hamro-afno";
      setCompanySlug(selectedCompany);
      const tokenHash = params.get("token_hash");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        setReady(true);
        setMessage("Link verified. Choose your new password.");
        window.history.replaceState(
          {},
          "",
          `/reset-password?company=${encodeURIComponent(selectedCompany)}`,
        );
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
        setMessage("Link verified. Choose your new password.");
      } else
        setMessage(
          "This password link is invalid or expired. Ask your administrator for a new link.",
        );
    })();
  }, [supabase]);
  async function save() {
    if (!ready) return setMessage("Verify a fresh password-reset link first.");
    if (password.length < 8) return setMessage("Use at least 8 characters.");
    if (password !== confirm) return setMessage("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(error.message);
    await supabase.auth.signOut();
    setReady(false);
    setMessage(
      "Password saved successfully. Return to the dashboard and sign in.",
    );
  }
  return (
    <main className="reset-page">
      <section>
        <Image
          src="/hamro-afno-logo.jpeg"
          width={96}
          height={96}
          alt="Hamro Afno Enterprises"
        />
        <h1>Set your password</h1>
        <p>Choose a secure password for your Hamro Afno Enterprises account.</p>
        <label>
          New password
          <input
            type="password"
            disabled={!ready}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            disabled={!ready}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
        <button className="primary" onClick={save} disabled={busy || !ready}>
          {busy ? "Saving…" : ready ? "Save password" : "Verifying link…"}
        </button>
        {message && <div className="reset-message">{message}</div>}
        <a href={`/login?company=${encodeURIComponent(companySlug)}`}>
          Return to company sign in
        </a>
      </section>
    </main>
  );
}
