"use client";
/** AI tasks in the browser: prompt building, retrieval over the vault, and streaming from the chosen model. */
import P from "./prompts.json";
import { workspaceDocs } from "./backend";
import { chunk, rank } from "./text";
import type { Settings } from "./settings";

type Msg = { role: "system" | "user" | "assistant"; content: string };
export type Event = { sources?: unknown[]; t?: string; error?: string; step?: string; detail?: string; queries?: string[] };
const RAG_TASKS = new Set(["chat", "rebut", "card"]);
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

/** Local engines (Ollama, LM Studio…) are called straight from the browser, so localhost works even on the hosted site. */
export const isLocal = (s: Settings) => s.llm_provider === "ollama" || s.llm_provider === "openai_compatible";

export async function* chat(messages: Msg[], s: Settings, opts: { signal?: AbortSignal; max_tokens?: number; temperature?: number } = {}) {
  const [prefix, ...rest] = s.llm_model.split("/");
  const body = { model: rest.join("/") || prefix, messages, stream: true, temperature: opts.temperature ?? Number(s.llm_temperature), max_tokens: opts.max_tokens ?? Number(s.llm_max_tokens) };
  let res: Response;
  if (isLocal(s)) {
    const base = s.llm_api_base.replace(/\/+$/, "");
    const url = s.llm_provider === "ollama" ? `${base.replace(/\/v1$/, "")}/v1/chat/completions` : `${base}/chat/completions`;
    res = await fetch(url, { method: "POST", signal: opts.signal, body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...(s.llm_api_key ? { Authorization: `Bearer ${s.llm_api_key}` } : {}) } });
  } else {
    if (!s.llm_api_key) throw new Error("Add your API key in Settings → AI Engine.");
    res = await fetch("/api/llm", { method: "POST", signal: opts.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: s.llm_provider, key: s.llm_api_key, body }) });
  }
  if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 400)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const lines = (buf += value).split("\n");
    buf = lines.pop()!;
    for (const l of lines) {
      if (!l.startsWith("data:") || l.includes("[DONE]")) continue;
      const m = JSON.parse(l.slice(5));
      if (m.error) throw new Error(m.error.message ?? JSON.stringify(m.error));
      const t = m.choices?.[0]?.delta?.content;
      if (t) yield t as string;
    }
  }
}

export function systemPrompt(task: string, s: Settings & { kind?: string }, context = "", target = "", topic = "") {
  const country = s.delegate_country, committee = s.committee, debate = s.kind === "debate";
  topic ||= s.topic;
  const fmt = (P.FORMAT_NAMES as Record<string, string>)[s.format] ?? "competitive debate";
  let role: string, who: string, profile: string;
  if (debate) {
    role = `${fmt} debater`; who = s.side ? ` on ${s.side}` : "";
    profile = [["Format", fmt], ["Motion", topic], ["Side", s.side]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}.`).join(" ");
    profile = profile && ` Team profile - ${profile}`;
  } else {
    role = "Model UN delegate"; who = (country ? ` representing ${country}` : "") + (committee ? ` in ${committee}` : "");
    profile = [["Country", country], ["Committee", committee], ["Topic", topic]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}.`).join(" ");
    profile = profile && ` Delegate profile - ${profile}`;
  }
  return fill((P.PROMPTS as Record<string, string>)[task], {
    who, context, profile, role, fmt, target: target || (debate ? "the opposing side" : "the opposing delegation"),
    country: country || "the user's country", on: topic ? ` on '${topic}'` : "", motion_on: topic ? ` The motion: '${topic}'.` : "",
    extension: s.format === "bp" ? " Finish with ## Closing-half extensions (2-3 distinct ideas)." : "",
  });
}

// ---------- retrieval (BM25 over paragraph-aware chunks) ----------
// ponytail: keyword (BM25) retrieval, no embeddings; add an embeddings API if users need semantic matches
export async function search(q: string, s: Settings, docIds?: string[] | null) {
  const docs = (await workspaceDocs()).filter((d) => !docIds?.length || docIds.includes(d.id));
  const chunks = docs.flatMap((d) => chunk(String(d.markdown ?? ""), Number(s.rag_chunk_size), Number(s.rag_chunk_overlap))
    .map((text, i) => ({ doc_id: d.id, name: String(d.name), chunk: i, text })));
  const scored = rank(q, chunks, Number(s.rag_top_k));
  return scored.map(({ score, ...c }, i) => ({ n: i + 1, ...c, score: Math.round(score * 100) / 100 }));
}

// ---------- tasks ----------
export async function* aiTask(task: string, r: { text: string; instruction?: string; target?: string; topic?: string; doc_ids?: string[] | null; history?: { role: string; content: string }[] }, s: Settings, signal?: AbortSignal): AsyncGenerator<Event> {
  let context = "";
  if (RAG_TASKS.has(task)) {
    const sources = await search(r.text, s, r.doc_ids);
    context = sources.map((x) => `[${x.n}] (${x.name}, part ${x.chunk + 1})\n${x.text}`).join("\n\n") || "(no matching passages in the vault)";
    yield { sources };
  }
  const topic = r.topic || s.topic || "unspecified";
  const user = task === "assist" ? `Instruction: ${r.instruction || "Improve clarity and persuasiveness."}\n\nText:\n${r.text}`
    : task === "counter" ? `Topic: ${topic}\n\nMy position:\n${r.text}`
    : task === "rebut" ? `Opponent's argument (${r.target || "unspecified"}):\n${r.text}`
    : ["spar", "flowcheck", "poi", "weigh", "case", "card"].includes(task) ? `Motion: ${topic}\n\n${r.text}` : r.text;
  const history = (r.history ?? []).slice(-8).filter((m) => m.role === "user" || m.role === "assistant") as Msg[];
  const messages: Msg[] = [{ role: "system", content: systemPrompt(task, s, context, r.target, r.topic) }, ...history, { role: "user", content: user }];
  for await (const t of chat(messages, s, { signal })) yield { t };
}

// ---------- web research: plan + write here, search/read/rank on the server (/api/web) ----------
const MOTION_PREFIX = /^\s*(?:this house(?: would| believes that| believes| regrets| supports| opposes| prefers)?|th(?:bt|w|r|s|o|p))\b[:,\s]*/i;
const subject = (t: string) => t.replace(MOTION_PREFIX, "").trim().replace(/\.$/, "") || t.trim();

function fallbackQueries(text: string, mode: string, s: Settings) {
  const t = subject(text), y = new Date().getFullYear(), c = s.delegate_country || "";
  return mode === "mun"
    ? [t, `UN resolution ${t}`, `${c} position ${t}`.trim(), `${t} statistics`, `${t} treaty international agreement`, `${t} solutions`, `${t} criticism challenges`, `${t} developing countries`, `${t} ${y}`, `${t} report`]
    : [t, `${t} evidence`, `benefits of ${t}`, `problems with ${t}`, `${t} statistics`, `${t} case study`, `${t} criticism`, `${t} research study`, `${t} ${y}`, `${t} expert analysis`];
}
function parseQueries(raw: string) {
  let items: unknown[] = [];
  try { const m = raw.match(/\[[\s\S]*\]/); items = m ? JSON.parse(m[0]) : []; } catch {}
  if (!items.length) items = raw.split("\n").map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, ""));
  return items.filter((i): i is string => typeof i === "string").map((i) => i.trim().replace(/^["']|["']$/g, "").replaceAll('"', "")).filter((q) => q.length >= 2 && q.length <= 120);
}
const DEPTH: Record<string, number> = { quick: 3, standard: 6, deep: 10 };
const month = () => new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export async function* webResearch(text: string, mode: "debate" | "mun", depth: string, s: Settings, signal?: AbortSignal): AsyncGenerator<Event> {
  yield { step: "plan", detail: "Planning searches" };
  const n = DEPTH[depth] ?? 6, who = s.delegate_country || "a delegation";
  const cover = mode === "mun"
    ? `background and statistics, past UN resolutions and treaties, ${who}'s official position, the positions of major blocs, proposed solutions and their criticisms, recent developments`
    : "core facts and statistics, the strongest evidence FOR the motion, the strongest evidence AGAINST it, real-world examples and case studies, academic research, recent developments";
  const prompt = `Today is ${month()}. Write ${n} distinct web search queries to research this ${mode === "mun" ? "Model UN topic" : "debate motion"}: "${text}". Cover: ${cover}. Keep both sides balanced. Each query 3-9 words, plain keywords, no quotes or operators. Return ONLY a JSON array of strings.`;
  let planned: string[] = [];
  try { let raw = ""; for await (const t of chat([{ role: "user", content: prompt }], s, { signal, temperature: 0.2, max_tokens: 800 })) raw += t; planned = parseQueries(raw); } catch (e) { if ((e as Error).name === "AbortError") throw e; }
  const seen = new Set<string>();
  const queries = [...planned, ...fallbackQueries(text, mode, s)].filter((q) => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase())).slice(0, n);
  yield { queries };

  const res = await fetch("/api/web", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    text, mode, depth, queries, country: s.delegate_country, provider: s.web_search_provider, brave_key: s.web_search_key, serper_key: s.serper_key,
    use_default: s.trusted_use_default, custom: s.trusted_custom }) });
  if (!res.ok || !res.body) throw new Error(await res.text());
  type Src = { n: number; title: string; domain: string; angle: string; text: string; url: string; snippet_only?: boolean };
  let picked: Src[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (buf += value).split("\n"); buf = lines.pop()!;
    for (const l of lines) {
      if (!l) continue;
      const m = JSON.parse(l);
      if (m.error) throw new Error(m.error);
      if (m.sources) picked = m.sources;
      yield m;
    }
  }
  if (!picked.length) return;

  yield { step: "write", detail: `Writing the report from ${picked.length} passages` };
  const evidence = picked.map((p) => `[${p.n}] ${p.title} (${p.domain}) - retrieved for: ${p.angle}\n${p.text}`).join("\n\n");
  const country = s.delegate_country || "the delegation";
  const role = mode === "mun" ? `a senior Model UN research director briefing a delegate representing ${country}${s.committee ? " in " + s.committee : ""}` : "a championship debate coach and research analyst preparing a team for a competitive round";
  const template = mode === "mun" ? P.MUN_REPORT.replaceAll("{country}", country) : P.DEBATE_REPORT;
  const system = `You are ${role}. Today is ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}. Write a comprehensive, rigorous research brief using ONLY the numbered evidence below, which comes from vetted trusted sources. ${P.CITE} Cite as many different sources as are relevant. If the evidence does not support a point, present it as analysis ('Analysis:') without a citation rather than inventing support. Be specific: names, numbers, dates, places. Be even-handed between sides.\n\nOutput Markdown in exactly this structure, no preamble, no H1, no sources list (it is appended automatically):\n\n${template}\n\nEVIDENCE:\n${evidence}`;
  const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: `${mode === "mun" ? "Model UN topic" : "Motion"}: ${text}` }];
  for await (const t of chat(messages, s, { signal, max_tokens: Math.max(Number(s.llm_max_tokens), 4000) })) yield { t };
  yield { t: "\n\n## Sources\n\n" + picked.map((p) => `${p.n}. [${p.title.replace(/[[\]]/g, "")}](${p.url}) - ${p.domain}${p.snippet_only ? " (search summary only)" : ""}`).join("\n") + "\n" };
  yield { step: "done", detail: `${picked.length} passages from ${new Set(picked.map((p) => p.url)).size} trusted sources` };
}
