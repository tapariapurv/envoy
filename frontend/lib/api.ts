"use client";
import { useCallback, useRef, useState } from "react";

/** API lives on the same host the app was opened from (localhost, or the owner's LAN IP for teammates). */
export const apiBase = () =>
  process.env.NEXT_PUBLIC_API ?? (typeof window === "undefined" ? "" : `${location.protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_API_PORT ?? 8000}`);

// Active workspace (owner) or access code (guest), remembered per browser.
const store = (k: string, v?: string | null) => {
  try {
    if (v === undefined) return localStorage.getItem(k) ?? "";
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch {}
  return "";
};
export const session = {
  get ws() { return store("envoy-ws"); },
  get code() { return store("envoy-code"); },
  setWs: (id: number) => store("envoy-ws", String(id)),
  setCode: (code: string | null) => store("envoy-code", code),
};
export const authHeaders = (): Record<string, string> =>
  session.code ? { "X-Access-Code": session.code } : session.ws ? { "X-Workspace": session.ws } : {};
export const apiUrl = (path: string) => {
  const q = new URLSearchParams(session.code ? { code: session.code } : session.ws ? { ws: session.ws } : {});
  return `${apiBase()}${path}${q.size ? `?${q}` : ""}`;
};
/** Navigate to a file-download endpoint (headers can't ride along, so auth goes in the query). */
export const download = (path: string) => location.assign(apiUrl(path));
export const apiFetch = (path: string, init: RequestInit = {}) =>
  fetch(apiBase() + path, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string>) } });

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export type Source = { n: number; doc_id: number; name: string; chunk: number; text: string; score: number };
export type Task = { id: number; title: string; notes: string; status: "todo" | "doing" | "done"; priority: "low" | "med" | "high"; position: number };
export type Doc = { id: number; name: string; chunks: number; chars: number; created: string };
export type Draft = { id: number; title: string; content: string; updated: string };
export type Clause = { id: number; kind: "preambulatory" | "operative" | "custom"; phrase: string; example: string; topic: string };
export type Card = { id: number; front: string; back: string; deck: string; known: number };
export type AITask = "chat" | "tone" | "format" | "polish" | "assist" | "counter" | "rebut";

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const r = await apiFetch(path, {
    method,
    headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new ApiError(r.status, (await r.text()) || r.statusText);
  return r.json();
}

/** Streams an AI task. Server sends NDJSON lines: {sources} | {t} | {error}. */
export function useAI() {
  const [out, setOut] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async (task: AITask, body: Record<string, unknown>): Promise<{ text: string; sources: Source[] }> => {
    ctrl.current?.abort();
    const ac = (ctrl.current = new AbortController());
    let text = "", srcs: Source[] = [];
    setOut(""); setSources([]); setError(""); setBusy(true);
    try {
      const r = await apiFetch(`/api/ai/${task}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal,
      });
      if (!r.ok || !r.body) throw new Error(await r.text());
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.sources) setSources((srcs = m.sources));
          if (m.t) setOut((text += m.t));
          if (m.error) setError(friendly(m.error));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendly(String((e as Error).message)));
    } finally {
      if (ctrl.current === ac) setBusy(false);
    }
    return { text, sources: srcs };
  }, []);

  const stop = useCallback(() => { ctrl.current?.abort(); setBusy(false); }, []);
  const clear = useCallback(() => { setOut(""); setSources([]); setError(""); }, []);
  return { out, sources, busy, error, run, stop, clear };
}

export function friendly(msg: string) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach the Envoy backend. Is it running on port 8000?";
  if (/Connection ?refused|ConnectError|11434/i.test(msg)) return "Can't reach Ollama. Start it with `ollama serve` (or open the Ollama app).";
  if (/not found|pull/i.test(msg) && /model/i.test(msg)) return `Model not installed. ${msg.slice(0, 160)} — run \`ollama pull <model>\` or pick another in Settings.`;
  if (/api[_ ]?key|auth|401/i.test(msg)) return "The cloud provider rejected the API key. Check Settings → AI Engine.";
  return msg;
}

export const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
