"use client";

import { useEffect, useState } from "react";

export default function PlatformResetPassword() {
  const [tokenHash,setTokenHash]=useState(""); const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [message,setMessage]=useState("Open the secure link from your email."); const [busy,setBusy]=useState(false); const [done,setDone]=useState(false);
  useEffect(()=>{const timer=window.setTimeout(()=>setTokenHash(new URLSearchParams(window.location.search).get("token_hash")||""),0);return()=>window.clearTimeout(timer)},[]);
  async function save(){if(password.length<8)return setMessage("Use at least 8 characters.");if(password!==confirm)return setMessage("Passwords do not match.");setBusy(true);const response=await fetch("/api/platform/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tokenHash,password})});const data=await response.json();setBusy(false);setMessage(data.message||data.error);if(response.ok)setDone(true);}
  return <main className="pc-auth-page"><section className="pc-auth-card"><div className="pc-auth-brand"><span>K</span><div><strong>Kritech Control</strong><small>Administrator password</small></div></div><div className="pc-auth-copy"><span>SECURE SETUP</span><h1>Choose your password.</h1><p>Use a unique password with at least eight characters.</p></div><label>New password<input type="password" disabled={done||!tokenHash} value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirm password<input type="password" disabled={done||!tokenHash} value={confirm} onChange={event=>setConfirm(event.target.value)} onKeyDown={event=>event.key==="Enter"&&save()}/></label>{message&&<div className="pc-alert">{message}</div>}<button className="pc-button primary" disabled={busy||done||!tokenHash} onClick={save}>{busy?"Saving…":"Save password"}</button><a href="/platform-admin/login">Return to administrator sign in</a></section></main>;
}
