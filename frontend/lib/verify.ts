// Server-side: is this request from a signed-in Envoy user? Checks the Firebase ID token with Google (no admin SDK needed).
const seen = new Map<string, number>(); // token -> expiry; skips the lookup for repeat calls from the same session

export async function signedIn(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (token.length < 100) return false;
  if ((seen.get(token) ?? 0) > Date.now()) return true;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }),
  }).catch(() => null);
  if (!r?.ok) return false;
  if (seen.size > 5000) seen.clear();
  seen.set(token, Date.now() + 10 * 60_000);
  return true;
}
