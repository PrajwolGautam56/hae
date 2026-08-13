import { NextResponse } from "next/server";
export async function POST() { const response=NextResponse.json({success:true}); response.cookies.set("hae_access_token","",{httpOnly:true,path:"/",maxAge:0}); response.cookies.set("hae_refresh_token","",{httpOnly:true,path:"/",maxAge:0}); return response; }
