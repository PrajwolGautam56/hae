"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

export default function ResetPasswordPage(){
  const supabase=useMemo(()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!),[]);
  const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function save(){if(password.length<8)return setMessage("Use at least 8 characters.");if(password!==confirm)return setMessage("Passwords do not match.");setBusy(true);const {error}=await supabase.auth.updateUser({password});setBusy(false);setMessage(error?error.message:"Password saved. You can return to Hamro Afno and sign in.")}
  return <main className="reset-page"><section><img src="/hamro-afno-logo.jpeg" alt="Hamro Afno Enterprises"/><h1>Set your password</h1><p>Choose a secure password for your Hamro Afno Enterprises account.</p><label>New password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/></label><button className="primary" onClick={save} disabled={busy}>{busy?"Saving…":"Save password"}</button>{message&&<div className="reset-message">{message}</div>}<a href="/">Return to dashboard</a></section></main>
}
