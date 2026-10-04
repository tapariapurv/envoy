import { signedIn } from "@/lib/verify";

// Streams a chat completion from a cloud provider with the user's own key (all speak the OpenAI format).
// Only these hosts are reachable, so the route can't be used to fetch arbitrary URLs.
const BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await signedIn(req))) return new Response("Please sign in", { status: 401 });
  const { provider, key, body } = await req.json().catch(() => ({}));
  const base = BASES[provider];
  if (!base || !key || !body?.model) return new Response("Unknown provider, model or missing API key", { status: 400 });
  // ponytail: no per-user rate limit; add one (e.g. Upstash) if a signed-in account abuses the relay
  const up = await fetch(`${base}/chat/completions`, {
    method: "POST", signal: req.signal, body: JSON.stringify({ ...body, stream: true }),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  });
  return new Response(up.body, { status: up.status, headers: { "Content-Type": up.headers.get("content-type") ?? "text/event-stream", "Cache-Control": "no-store" } });
}
