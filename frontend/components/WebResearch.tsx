"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FilePlus2, Globe, Library, Loader2, Search, ShieldCheck, Square, X } from "lucide-react";
import { Empty, ErrorNote, Markdown, copy, toast } from "@/components/ui";
import { api, apiFetch, friendly, session } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { useWorkspace } from "@/lib/workspace";

type WebSource = { n: number; url: string; domain: string; title: string; text: string; angle: string; score: number; snippet_only: boolean };
type Report = { text: string; mode: Mode; md: string; sources: WebSource[]; queries: string[] };
type Mode = "debate" | "mun";
const STEPS = [["plan", "Plan searches"], ["search", "Search trusted sources"], ["read", "Read sources"], ["rank", "Rank evidence"], ["write", "Write report"]] as const;
const KEY = () => `envoy-webreport-${session.code || session.ws || "0"}`;

export default function WebResearch() {
  const { s } = useSettings();
  const [mode, setMode] = useState<Mode>(useWorkspace().ws?.kind === "mun" ? "mun" : "debate");
  const [text, setText] = useState("");
  const [depth, setDepth] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState("");
  const [r, setR] = useState<Report | null>(null);
  const [panel, setPanel] = useState<WebSource | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // Keep the last report across navigation (per workspace, this browser only).
  useEffect(() => { try { const x = JSON.parse(localStorage.getItem(KEY()) || "null"); if (x) { setR(x); setMode(x.mode); setText(x.text); } } catch {} }, []);
  useEffect(() => { if (!text && s.topic) setText(s.topic); }, [s.topic]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    if (!text.trim() || busy) return;
    const ac = (ctrl.current = new AbortController());
    const rep: Report = { text, mode, md: "", sources: [], queries: [] };
    setBusy(true); setError(""); setSteps({}); setCurrent(""); setR({ ...rep });
    try {
      const res = await apiFetch("/api/research/web", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, mode, depth }), signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = (buf += value).split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.step) { setCurrent(m.step); setSteps((x) => ({ ...x, [m.step]: m.detail })); }
          if (m.queries) rep.queries = m.queries;
          if (m.sources) rep.sources = m.sources;
          if (m.t) rep.md += m.t;
          if (m.error) setError(friendly(m.error));
          if (m.queries || m.sources || m.t) setR({ ...rep });
        }
      }
      if (rep.md) try { localStorage.setItem(KEY(), JSON.stringify(rep)); } catch {}
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendly(String((e as Error).message)));
    } finally {
      if (ctrl.current === ac) setBusy(false);
    }
  }

  const title = r ? `${r.mode === "mun" ? "Research brief" : "Motion brief"}: ${r.text}`.slice(0, 120) : "";
  const saveDraft = async () => { await api("/api/drafts", "POST", { title, content: r!.md }); toast("Saved to Drafts"); };
  const toVault = async () => {
    const fd = new FormData();
    fd.append("files", new File([`# ${title}\n\n${r!.md}`], `${title.replace(/[^\w\- ]+/g, "").slice(0, 80) || "Web research"}.md`, { type: "text/markdown" }));
    const [res] = await api<{ error?: string }[]>("/api/docs", "POST", fd);
    if (res?.error) setError(friendly(res.error)); else toast("Added to your vault");
  };
  // Links in the report open in a new tab instead of leaving the app.
  const external = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='http']");
    if (a) { e.preventDefault(); window.open(a.href, "_blank", "noopener"); }
  };
  const idx = STEPS.findIndex(([k]) => k === current);

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="flex flex-col gap-3">
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="card flex flex-col gap-3 p-4">
          <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Research type">
            {([["debate", "Debate motion"], ["mun", "MUN topic"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`flex-1 rounded-lg py-1.5 text-sm transition ${mode === k ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">{mode === "mun" ? "Topic or caucus" : "Motion"}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="input resize-none"
              placeholder={mode === "mun" ? "e.g. Plastic pollution in marine environments" : "e.g. THBT social media does more harm than good"}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
          </label>
          {mode === "mun" && <p className="text-xs text-muted">{s.delegate_country ? `Researching for ${s.delegate_country}${s.committee ? ` in ${s.committee}` : ""}.` : "Set your country in Settings → Delegation to research its position."}</p>}
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="label">Depth</span>
            <select value={depth} onChange={(e) => setDepth(e.target.value)} className="input w-auto py-1">
              <option value="quick">Quick · ~8 sources</option>
              <option value="standard">Standard · ~14 sources</option>
              <option value="deep">Deep · ~24 sources</option>
            </select>
          </label>
          {busy ? (
            <button type="button" onClick={() => { ctrl.current?.abort(); setBusy(false); }} className="btn-outline"><Square className="size-4" /> Stop</button>
          ) : (
            <button disabled={text.trim().length < 3} className="btn-primary"><Search className="size-4" /> Research</button>
          )}
        </form>

        {(busy || Object.keys(steps).length > 0) && (
          <ol className="card flex flex-col gap-2.5 p-4" aria-live="polite">
            {STEPS.map(([k, l], i) => {
              const done = current === "done" || i < idx || (!busy && i <= idx && !error);
              const active = busy && k === current;
              return (
                <li key={k} className="flex gap-2.5 text-sm">
                  <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${done ? "bg-ok text-white" : active ? "text-accent" : "border border-line"}`}>
                    {done ? <Check className="size-3" /> : active ? <Loader2 className="size-4 animate-spin" /> : null}
                  </span>
                  <span className="min-w-0"><span className={done || active ? "" : "text-muted"}>{l}</span>
                    {steps[k] && (done || active) && <span className="block text-xs text-muted">{steps[k]}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {!!r?.sources.length && (
          <div className="card overflow-hidden">
            <div className="border-b border-line px-4 py-2.5"><span className="label">Evidence · {r.sources.length}</span></div>
            <ul className="max-h-[40vh] divide-y divide-line overflow-auto">
              {r.sources.map((x) => (
                <li key={x.n}><button onClick={() => setPanel(x)} className="flex w-full gap-2 px-4 py-2 text-left hover:bg-subtle">
                  <span className="font-semibold text-accent">{x.n}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{x.title}</span><span className="block truncate text-xs text-muted">{x.domain} · {x.angle}</span></span>
                </button></li>
              ))}
            </ul>
          </div>
        )}
        <p className="flex items-start gap-1.5 px-1 text-xs text-muted"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> Only trusted sources are read. Edit the list in Settings → Web Research. Searches go to the web; the report is written by your AI model.</p>
      </section>

      <section className="card flex min-h-[480px] flex-col">
        {r?.md || (busy && r) ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate font-medium">{r.text}</span>
              {!busy && r.md && <>
                <button onClick={() => copy(r.md)} className="btn-ghost"><Copy className="size-4" /> Copy</button>
                <button onClick={() => saveDraft().catch((e) => setError(String(e.message)))} className="btn-ghost"><FilePlus2 className="size-4" /> Save as draft</button>
                <button onClick={() => toVault().catch((e) => setError(String(e.message)))} className="btn-ghost"><Library className="size-4" /> Add to vault</button>
              </>}
            </div>
            <div className="flex-1 overflow-auto px-6 py-5" onClickCapture={external}>
              <ErrorNote msg={error} />
              {r.md ? <Markdown text={r.md} onCite={(n) => setPanel(r.sources.find((x) => x.n === n) ?? null)} /> : (
                <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> {steps[current] || "Starting…"}</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-center p-5">
            <ErrorNote msg={error} />
            <Empty icon={Globe} title="Research the web, systematically">
              Enter a motion or topic. Envoy plans balanced searches, reads only trusted sources, picks the strongest evidence for each side and writes a cited brief.
            </Empty>
          </div>
        )}
      </section>

      {panel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={() => setPanel(null)}>
          <aside className="rise flex h-full w-full max-w-xl flex-col border-l border-line bg-panel" onClick={(e) => e.stopPropagation()} aria-label="Source viewer">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <span className="flex-1 truncate font-medium">[{panel.n}] {panel.title}</span>
              <a href={panel.url} target="_blank" rel="noopener noreferrer" className="btn-ghost"><ExternalLink className="size-4" /> Open</a>
              <button onClick={() => setPanel(null)} className="btn-ghost" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-5">
              <p className="mb-3 text-xs text-muted">{panel.domain} · retrieved for {panel.angle}{panel.snippet_only ? " · search summary only (page couldn't be read)" : ""}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{panel.text}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
