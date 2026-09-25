"use client";
import { useEffect, useState } from "react";
import { Check, Cloud, Cpu, Loader2, RefreshCw } from "lucide-react";
import { ErrorNote, PageHeader, toast } from "@/components/ui";
import { api, download, useAI } from "@/lib/api";
import { FORMATS, fmt } from "@/lib/debate";
import { useSettings, type Settings } from "@/lib/settings";
import { useWorkspace } from "@/lib/workspace";

const SECTIONS = [["profile", "Profile"], ["appearance", "Appearance"], ["timers", "Timers"], ["prompter", "Teleprompter"], ["ai", "AI Engine"], ["rag", "Research & RAG"], ["web", "Web Research"], ["data", "Data"]];
const THEMES = [["system", "System", "#f7f6f3", "#111110"], ["light", "Light", "#f7f6f3", "#ffffff"], ["dark", "Dark", "#111110", "#191918"], ["midnight", "Midnight", "#0b1020", "#111830"], ["sepia", "Sepia", "#f3ecdf", "#fbf6ec"]];
const ACCENTS = { indigo: "#4f46e5", violet: "#7c3aed", sky: "#0284c7", emerald: "#059669", amber: "#d97706", rose: "#e11d48", slate: "#475569" };
const PROVIDERS: Record<string, { label: string; model: string; base: string; key: boolean }> = {
  ollama: { label: "Ollama (local)", model: "ollama/llama3.2", base: "http://localhost:11434", key: false },
  openai: { label: "OpenAI", model: "openai/gpt-4.1-mini", base: "", key: true },
  anthropic: { label: "Anthropic", model: "anthropic/claude-sonnet-5", base: "", key: true },
  gemini: { label: "Google Gemini", model: "gemini/gemini-2.5-flash", base: "", key: true },
  openai_compatible: { label: "OpenAI-compatible (LM Studio, vLLM…)", model: "openai/local-model", base: "http://localhost:1234/v1", key: false },
};

export default function SettingsPage() {
  const { s, set, replace, status, offline } = useSettings();
  const debate = useWorkspace().ws?.kind === "debate";
  const [models, setModels] = useState<string[] | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const test = useAI();

  const [builtin, setBuiltin] = useState<string[] | null>(null);
  const detect = () => api<{ models: string[] }>("/api/health").then((h) => setModels(h.models)).catch(() => setModels([]));
  useEffect(() => { detect(); api<{ domains: string[] }>("/api/research/sources").then((r) => setBuiltin(r.domains)).catch(() => {}); }, []);

  const local = s.llm_provider === "ollama";
  const chatModels = (models ?? []).filter((m) => !m.includes("embed"));
  const embedModels = (models ?? []).filter((m) => m.includes("embed"));

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored locally in data/envoy.db.">
        <span className="flex items-center gap-1.5 text-sm text-muted" aria-live="polite">
          {status === "saving" ? <><Loader2 className="size-3.5 animate-spin" /> Saving</> : status === "saved" ? <><Check className="size-3.5 text-ok" /> All changes saved</> : status === "error" ? <span className="text-danger">Couldn&apos;t save — is the backend running?</span> : null}
        </span>
      </PageHeader>
      {offline && <div className="mb-4"><ErrorNote msg="The backend is offline, so settings can't be loaded or saved. Start everything with `npm run dev` from the project root." /></div>}

      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="sticky top-8 hidden h-fit flex-col gap-0.5 lg:flex">
          {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">{l}</a>)}
        </nav>

        <div className="flex max-w-3xl flex-col gap-6">
          {debate ? (
            <Section id="profile" title="Team" desc="Saved to the current workspace and used as context by every AI tool. Each tournament workspace keeps its own.">
              <Field label="Format">
                <select value={s.format || "bp"} onChange={(e) => set({ format: e.target.value, side: "" })} className="input">
                  {Object.entries(FORMATS).map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}
                </select>
              </Field>
              <Field label="Team"><Text k="team" placeholder="e.g. Team Canada A" /></Field>
              <Field label="Side">
                <select value={s.side} onChange={(e) => set({ side: e.target.value })} className="input">
                  <option value="">Not decided yet</option>
                  {fmt(s.format).sides.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Motion"><Text k="topic" placeholder="e.g. This House would ban zoos" /></Field>
            </Section>
          ) : (
            <Section id="profile" title="Delegation" desc="Saved to the current workspace and used as context by every AI tool. Each conference workspace keeps its own.">
              <Field label="Country / delegation"><Text k="delegate_country" placeholder="e.g. Republic of Kenya" /></Field>
              <Field label="Committee"><Text k="committee" placeholder="e.g. UNEP, DISEC, Security Council" /></Field>
              <Field label="Topic"><Text k="topic" placeholder="e.g. Plastic pollution in marine environments" /></Field>
            </Section>
          )}

          <Section id="appearance" title="Appearance">
            <Field label="Theme">
              <div className="flex flex-wrap gap-2">
                {THEMES.map(([id, l, a, b]) => (
                  <button key={id} onClick={() => set({ theme: id })} className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs ${s.theme === id ? "border-accent ring-2 ring-accent/20" : "border-line"}`}>
                    <span className="flex h-10 w-16 overflow-hidden rounded-md border border-line">
                      {id === "system" ? <><span className="flex-1" style={{ background: a }} /><span className="flex-1" style={{ background: b }} /></> : <span className="m-1.5 flex-1 rounded" style={{ background: b, outline: `6px solid ${a}` }} />}
                    </span>{l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Accent colour">
              <div className="flex flex-wrap gap-2">
                {Object.entries(ACCENTS).map(([k, c]) => (
                  <button key={k} onClick={() => set({ accent: k })} aria-label={k} title={k} className={`size-8 rounded-full transition ${s.accent === k ? "ring-2 ring-offset-2 ring-offset-bg" : "hover:scale-110"}`} style={{ background: c, ["--tw-ring-color" as string]: c }} />
                ))}
              </div>
            </Field>
            <Field label="Text size" hint={`${Math.round(s.font_scale * 100)}%`}><Range k="font_scale" min={0.85} max={1.25} step={0.05} /></Field>
          </Section>

          <Section id="timers" title="Timers" desc="Defaults for the War Room. You can still adjust any running timer on the fly.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Speaking time"><Secs k="timer_speaker" /></Field>
              <Field label="Moderated caucus (total)"><Secs k="timer_mod_total" /></Field>
              <Field label="Moderated caucus (per speaker)"><Secs k="timer_mod_speaker" /></Field>
              <Field label="Unmoderated caucus"><Secs k="timer_unmod" /></Field>
              <Field label="Warning when remaining (s)"><Num k="timer_warning" min={0} max={120} /></Field>
              <Field label="Sound"><Toggle k="timer_sound" label="Chime when time expires" /></Field>
            </div>
          </Section>

          <Section id="prompter" title="Teleprompter">
            <Field label="Default pace" hint={`${s.wpm} words per minute`}><Range k="wpm" min={60} max={250} step={5} /></Field>
            <Field label="Font size" hint={`${s.prompter_font}px`}><Range k="prompter_font" min={24} max={96} step={2} /></Field>
            <Field label="Mirror"><Toggle k="prompter_mirror" label="Mirror text by default (for beam-splitter glass)" /></Field>
          </Section>

          <Section id="ai" title="AI Engine" desc="All requests are routed through LiteLLM. With Ollama nothing leaves your Mac; cloud providers receive the text you send them.">
            <Field label="Provider">
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(PROVIDERS).map(([id, p]) => (
                  <button key={id} onClick={() => set({ llm_provider: id, llm_model: id === "ollama" && chatModels[0] ? `ollama/${chatModels[0]}` : p.model, llm_api_base: p.base })}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${s.llm_provider === id ? "border-accent bg-accent/5" : "border-line hover:bg-subtle"}`}>
                    {id === "ollama" || id === "openai_compatible" ? <Cpu className="size-4 text-muted" /> : <Cloud className="size-4 text-muted" />}{p.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Model" hint="LiteLLM model string, e.g. ollama/llama3.2 or anthropic/claude-sonnet-5">
              <Text k="llm_model" list="chat-models" />
              <datalist id="chat-models">{chatModels.map((m) => <option key={m} value={`ollama/${m}`} />)}</datalist>
              {local && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {models === null ? <span className="text-xs text-muted">Detecting…</span> : chatModels.length ? chatModels.map((m) => (
                    <button key={m} data-on={s.llm_model === `ollama/${m}`} onClick={() => set({ llm_model: `ollama/${m}` })} className="chip">{m}</button>
                  )) : <span className="text-xs text-danger">No Ollama models found. Run <code>ollama pull llama3.2</code>.</span>}
                  <button onClick={detect} className="btn-ghost px-2 py-0.5 text-xs"><RefreshCw className="size-3" /> Refresh</button>
                </div>
              )}
            </Field>
            {(local || s.llm_provider === "openai_compatible") && <Field label="API base URL"><Text k="llm_api_base" /></Field>}
            {PROVIDERS[s.llm_provider]?.key !== false || s.llm_provider === "openai_compatible" ? (
              <Field label="API key" hint="Stored only in your local database; never shown again in full."><Text k="llm_api_key" type="password" placeholder="sk-…" /></Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Creativity (temperature)" hint={String(s.llm_temperature)}><Range k="llm_temperature" min={0} max={1.2} step={0.1} /></Field>
              <Field label="Max response length (tokens)"><Num k="llm_max_tokens" min={100} max={8000} step={100} /></Field>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => test.run("assist", { text: "ready", instruction: "Reply with exactly: Connection OK" })} disabled={test.busy} className="btn-outline">
                {test.busy ? <Loader2 className="size-4 animate-spin" /> : null} Test connection
              </button>
              {test.out && !test.error && <span className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {test.out.slice(0, 60)}</span>}
            </div>
            <ErrorNote msg={test.error} />
          </Section>

          <Section id="rag" title="Research & RAG" desc="How documents are split and retrieved. Re-index after changing these so existing documents use the new parameters.">
            <Field label="Embedding model" hint="Must stay the same between indexing and searching. Local: ollama/nomic-embed-text">
              <Text k="embed_model" list="embed-models" />
              <datalist id="embed-models">{embedModels.map((m) => <option key={m} value={`ollama/${m.replace(/:latest$/, "")}`} />)}</datalist>
            </Field>
            {s.embed_model.startsWith("ollama") && <Field label="Embedding API base"><Text k="embed_api_base" /></Field>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Chunk size (chars)"><Num k="rag_chunk_size" min={300} max={6000} step={100} /></Field>
              <Field label="Chunk overlap (chars)"><Num k="rag_chunk_overlap" min={0} max={1500} step={50} /></Field>
              <Field label="Passages per answer"><Num k="rag_top_k" min={1} max={20} /></Field>
            </div>
            <p className="text-xs text-muted">Smaller chunks = more precise citations; larger chunks = more context per passage. 800–1500 suits most UN documents.</p>
            <button onClick={async () => { setReindexing(true); try { await api("/api/docs/reindex", "POST"); toast("Re-indexed all documents"); } catch (e) { toast(String((e as Error).message).slice(0, 80)); } setReindexing(false); }} disabled={reindexing} className="btn-outline w-fit">
              {reindexing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-index all documents
            </button>
          </Section>

          <Section id="web" title="Web Research" desc="Used by Research Hub → Web research. Only pages from trusted sources are read; everything else is discarded.">
            <Field label="Search engine">
              <select value={s.web_search_provider} onChange={(e) => set({ web_search_provider: e.target.value })} className="input">
                <option value="duckduckgo">DuckDuckGo (free, no key)</option>
                <option value="brave">Brave Search API (more reliable; free key at brave.com/search/api)</option>
              </select>
            </Field>
            {s.web_search_provider === "brave" && <Field label="Brave Search API key" hint="Stored only in your local database."><Text k="web_search_key" type="password" placeholder="BSA…" /></Field>}
            <Field label="Built-in trusted sources" hint={builtin ? `${builtin.length} domains & rules` : ""}>
              <Toggle k="trusted_use_default" label="Use Envoy's list: UN system, governments (.gov, .int…), universities, journals, think tanks, NGOs and major news outlets" />
              {builtin && <details className="text-xs text-muted"><summary className="cursor-pointer">View the list</summary><p className="mt-2 max-h-48 overflow-auto font-mono leading-relaxed">{builtin.join(" · ")}</p></details>}
            </Field>
            <Field label="Your sources" hint="One domain per line · prefix with - to block">
              <textarea value={s.trusted_custom} onChange={(e) => set({ trusted_custom: e.target.value })} rows={5} className="input font-mono text-xs" placeholder={"myschool.edu\nlocalnewspaper.com\n-example-blocked.com"} />
            </Field>
          </Section>

          <Section id="data" title="Data">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => download("/api/export")} className="btn-outline">Export offline binder</button>
              <button onClick={async () => { if (confirm("Reset all settings to defaults? Your documents, drafts and tasks are kept.")) { replace(await api<Settings>("/api/settings/reset", "POST")); toast("Settings reset"); } }} className="btn-ghost text-danger">Reset settings</button>
            </div>
            <p className="text-xs text-muted">All data lives in the <code>data/</code> folder of the project. Back it up by copying that folder.</p>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-8 p-6">
      <h2 className="font-display text-2xl">{title}</h2>
      {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium">{label}</span>{hint && <span className="text-xs text-muted">{hint}</span>}</div>
      {children}
    </div>
  );
}

type K<T> = { [P in keyof Settings]: Settings[P] extends T ? P : never }[keyof Settings];

function Text({ k, ...rest }: { k: K<string> } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { s, set } = useSettings();
  return <input value={s[k]} onChange={(e) => set({ [k]: e.target.value })} className="input" {...rest} />;
}
function Num({ k, min, max, step = 1 }: { k: K<number>; min: number; max: number; step?: number }) {
  const { s, set } = useSettings();
  return <input type="number" value={s[k]} min={min} max={max} step={step} onChange={(e) => e.target.value && set({ [k]: Math.min(max, Math.max(min, Number(e.target.value))) })} className="input" />;
}
function Secs({ k }: { k: K<number> }) {
  const { s, set } = useSettings();
  const v = s[k];
  return (
    <div className="flex items-center gap-2">
      <input type="number" min={0} max={120} value={Math.floor(v / 60)} onChange={(e) => set({ [k]: Math.max(5, Number(e.target.value) * 60 + (v % 60)) })} className="input" aria-label="Minutes" />
      <span className="text-sm text-muted">min</span>
      <input type="number" min={0} max={59} step={5} value={v % 60} onChange={(e) => set({ [k]: Math.max(5, Math.floor(v / 60) * 60 + Math.min(59, Number(e.target.value))) })} className="input" aria-label="Seconds" />
      <span className="text-sm text-muted">sec</span>
    </div>
  );
}
function Range({ k, min, max, step }: { k: K<number>; min: number; max: number; step: number }) {
  const { s, set } = useSettings();
  return <input type="range" min={min} max={max} step={step} value={s[k]} onChange={(e) => set({ [k]: Number(e.target.value) })} className="accent-[var(--accent)]" />;
}
function Toggle({ k, label }: { k: K<boolean>; label: string }) {
  const { s, set } = useSettings();
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <button role="switch" aria-checked={s[k]} onClick={() => set({ [k]: !s[k] })} className={`relative h-6 w-10 rounded-full transition ${s[k] ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${s[k] ? "left-[18px]" : "left-0.5"}`} />
      </button>
      {label}
    </label>
  );
}
