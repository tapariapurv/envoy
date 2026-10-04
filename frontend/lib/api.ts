"use client";
import { useCallback, useRef, useState } from "react";

import { ApiError, handle, session, workspaceDocs } from "./backend";
import { aiTask } from "./ai";
import { binder, saveBlob } from "./exporters";
import { useSettings } from "./settings";

export { ApiError, session };
/** Download the offline binder (built in the browser). */
export async function download(_path = "/api/export") {
  const [s, tasks, drafts, clauses, cards] = await Promise.all(["settings", "tasks", "drafts", "clauses", "flashcards"].map((r) => api<never>(`/api/${r}`)));
  const full = (await workspaceDocs()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  saveBlob(new Blob([binder(s, tasks, drafts, full as never, clauses, cards)], { type: "text/html" }), `envoy-binder-${new Date().toISOString().slice(0, 10)}.html`);
}

export type Source = { n: number; doc_id: string; name: string; chunk: number; text: string; score: number };
export type Task = { id: string; title: string; notes: string; status: "todo" | "doing" | "done"; priority: "low" | "med" | "high"; position: number };
export type Doc = { id: string; name: string; chunks: number; chars: number; created: string };
export type Draft = { id: string; title: string; content: string; updated: string };
export type Clause = { id: string; kind: "preambulatory" | "operative" | "custom"; phrase: string; example: string; topic: string };
export type Card = { id: string; front: string; back: string; deck: string; known: number };
export type AITask = "chat" | "tone" | "format" | "polish" | "assist" | "counter" | "rebut"
  | "breakdown" | "case" | "weigh" | "spar" | "poi" | "flowcheck" | "drill" | "card";
export type Round = { id: string; name: string; side: string; opponent: string; result: string; speaks: number | null; judge: string; motion: string; feedback: string; created: string };
export type Flow = { id: string; title: string; format: string; data: string };
export type Motion = { id: string; text: string; theme: string; info: string };

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  return handle(path, method, body) as Promise<T>;
}

/** Streams an AI task: {sources} | {t} events from the model chosen in Settings. */
export function useAI() {
  const { s } = useSettings();
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
      for await (const m of aiTask(task, body as Parameters<typeof aiTask>[1], s, ac.signal)) {
        if (m.sources) setSources((srcs = m.sources as Source[]));
        if (m.t) setOut((text += m.t));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendly(String((e as Error).message)));
    } finally {
      if (ctrl.current === ac) setBusy(false);
    }
    return { text, sources: srcs };
  }, [s]);

  const stop = useCallback(() => { ctrl.current?.abort(); setBusy(false); }, []);
  const clear = useCallback(() => { setOut(""); setSources([]); setError(""); }, []);
  return { out, sources, busy, error, run, stop, clear };
}

export function friendly(msg: string) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach the AI engine. For Ollama, start it with OLLAMA_ORIGINS set to this site (see Settings → AI Engine); otherwise check your connection.";
  if (/permission|insufficient/i.test(msg)) return "You don't have access to this workspace any more. Ask its owner for a new code.";
  if (/not found|pull/i.test(msg) && /model/i.test(msg)) return `Model not installed. ${msg.slice(0, 160)} — run \`ollama pull <model>\` or pick another in Settings.`;
  if (/^Add your API key/.test(msg)) return msg;
  if (/api[_ ]?key|auth|401/i.test(msg)) return "The cloud provider rejected the API key. Check Settings → AI Engine.";
  return msg;
}

export const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
