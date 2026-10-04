"use client";
import { auth } from "./firebase";

/** Invite emails go through a Google Apps Script web app (apps-script/Code.gs), sent from the deployer's Gmail. */
const URL_ = process.env.NEXT_PUBLIC_MAIL_URL;
export const canEmail = !!URL_;

export async function sendInvite(to: string, workspace: string, code: string, link: string) {
  const idToken = await auth.currentUser?.getIdToken();
  // text/plain keeps this a "simple" request: Apps Script can't answer CORS preflights.
  const r = await fetch(URL_!, { method: "POST", body: JSON.stringify({ idToken, to, workspace, code, link }) });
  const res = await r.json().catch(() => ({ ok: false, error: "The mail service didn't answer" }));
  if (!res.ok) throw new Error(res.error || "Couldn't send the invite");
}
