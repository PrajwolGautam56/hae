"use client";

import { useState } from "react";

export default function PlatformForgotPassword() {
  const [email,setEmail]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function send(){setBusy(true);setMessage("");const response=await fetch("/api/platform/auth/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const data=await response.json();setBusy(false);setMessage(data.message||data.error||"Request could not be completed");}
  return <main className="pc-auth-page"><section className="pc-auth-card"><div className="pc-auth-brand"><span>K</span><div><strong>Kritech Control</strong><small>Secure account recovery</small></div></div><div className="pc-auth-copy"><span>ADMIN ACCESS</span><h1>Activate or reset access.</h1><p>We will send a one-time secure link only when this email has been pre-authorized in Kritech Control.</p></div><label>Email address<input autoFocus type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} onKeyDown={event=>event.key==="Enter"&&send()}/></label>{message&&<div className="pc-alert">{message}</div>}<button className="pc-button primary" disabled={busy||!email} onClick={send}>{busy?"Sending…":"Send secure link"}</button><a href="/platform-admin/login">← Return to administrator sign in</a><footer>Reset links expire and can only be used once.</footer></section></main>;
}
