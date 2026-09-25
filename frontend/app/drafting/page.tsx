"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, FileDown, FileText, Languages, ListChecks, Plus, Sparkles, Square, Trash2, Wand2, X } from "lucide-react";
import Paper from "@/components/Paper";
import { ErrorNote, Markdown, PageHeader, Thinking, copy, toast } from "@/components/ui";
import { api, apiFetch, fmtTime, friendly, useAI, words, type AITask, type Draft } from "@/lib/api";
import { useSettings } from "@/lib/settings";

type Sel = { start: number; end: number } | null;

export default function Drafting() {
  const { s } = useSettings();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [cur, setCur] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(true);
  const [tab, setTab] = useState<"preview" | "ai">("preview");
  const [instr, setInstr] = useState("");
  const [target, setTarget] = useState<Sel>(null);
  const [lastTask, setLastTask] = useState<AITask | null>(null);
  const [exporting, setExporting] = useState(false);
  const [polishFirst, setPolishFirst] = useState(true);
  const ai = useAI();
  const ta = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the export menu on outside click or Escape.
  useEffect(() => {
    const close = (e: Event) => {
      const d = menu.current;
      if (d?.open && (e.type === "keydown" ? (e as KeyboardEvent).key === "Escape" : !d.contains(e.target as Node))) d.open = false;
    };
    addEventListener("mousedown", close); addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, []);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const booted = useRef(false); // dev StrictMode runs effects twice; don't create two starter drafts
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    api<Draft[]>("/api/drafts").then(async (d) => {
      if (!d.length) d = [await api<Draft>("/api/drafts", "POST", { title: "Position Paper", content: "" })];
      setDrafts(d); setCur(d[0]);
    }).catch(() => {});
  }, []);

  // Flush unsaved edits if the tab closes inside the autosave window (keepalive caps bodies at 64 KB).
  const unsaved = useRef<Draft | null>(null);
  unsaved.current = saved ? null : cur;
  useEffect(() => {
    const flush = () => {
      const d = unsaved.current;
      if (d) apiFetch(`/api/drafts/${d.id}`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: d.title, content: d.content }) });
    };
    addEventListener("pagehide", flush);
    return () => removeEventListener("pagehide", flush);
  }, []);

  const persist = useCallback(async (d: Draft) => {
    await api(`/api/drafts/${d.id}`, "PUT", { title: d.title, content: d.content });
    setDrafts((ds) => ds.map((x) => (x.id === d.id ? d : x)));
    setSaved(true);
  }, []);

  const edit = (p: Partial<Draft>) => {
    if (!cur) return;
    const d = { ...cur, ...p };
    setCur(d); setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(d), 700);
  };

  const switchTo = (id: number) => {
    if (cur && !saved) { clearTimeout(saveTimer.current); persist(cur); }
    setCur(drafts.find((d) => d.id === id) ?? null);
    ai.clear(); setTab("preview");
  };
  const create = async () => {
    const d = await api<Draft>("/api/drafts", "POST", { title: "Untitled draft" });
    setDrafts((ds) => [d, ...ds]); setCur(d);
  };
  const remove = async () => {
    if (!cur || !confirm(`Delete "${cur.title}"? This cannot be undone.`)) return;
    await api(`/api/drafts/${cur.id}`, "DELETE");
    const rest = drafts.filter((d) => d.id !== cur.id);
    setDrafts(rest); setCur(rest[0] ?? null);
  };

  async function run(task: AITask) {
    if (!cur) return;
    const el = ta.current!;
    const sel = el.selectionEnd > el.selectionStart ? { start: el.selectionStart, end: el.selectionEnd } : null;
    const text = sel ? cur.content.slice(sel.start, sel.end) : cur.content;
    if (!text.trim()) return toast("Write something first");
    setTarget(sel); setTab("ai"); setLastTask(task);
    await ai.run(task, { text, instruction: instr });
  }

  const apply = (mode: "replace" | "insert") => {
    if (!cur) return;
    const c = cur.content, o = ai.out.trim();
    const next = mode === "insert"
      ? (target ? c.slice(0, target.end) + "\n\n" + o + c.slice(target.end) : c + "\n\n" + o)
      : (target ? c.slice(0, target.start) + o + c.slice(target.end) : o);
    edit({ content: next }); ai.clear(); setTab("preview"); toast(mode === "insert" ? "Inserted" : "Replaced");
  };

  type Kind = "pdf" | "envoy" | "conference";
  async function exportPaper(kind: Kind) {
    if (!cur?.content.trim()) return toast("Nothing to export yet");
    setExporting(true);
    try {
      let markdown = cur.content;
      if (polishFirst) {
        // AI tidies structure first; the result also lands in the AI tab so it can be applied to the draft.
        setTarget(null); setTab("ai"); setLastTask("polish");
        const r = await ai.run("polish", { text: markdown });
        if (!r.text.trim()) return;
        markdown = r.text;
      } else setTab("preview");
      const name = cur.title.replace(/[^\w\- ]+/g, "").trim() || "Position Paper";
      let res: Response;
      if (kind === "pdf") {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let the paper render
        const el = document.querySelector<HTMLElement>("[data-paper]");
        if (!el) throw new Error("Open the preview first");
        const html = paperHtml(el);
        res = await apiFetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html, title: cur.title }) });
        if (res.status === 501) { printFallback(html); return; } // no Chrome on this machine: use the print dialog
      } else {
        res = await apiFetch("/api/export/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown, title: cur.title, style: kind }) });
      }
      if (!res.ok) throw new Error(await res.text());
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: `${name}.${kind === "pdf" ? "pdf" : "docx"}` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(kind === "pdf" ? "PDF exported" : "Word document exported");
    } catch (e) {
      toast(friendly(String((e as Error).message)).slice(0, 90));
    } finally {
      setExporting(false);
    }
  }

  const profile = { country: s.delegate_country, committee: s.committee, topic: s.topic };
  const isPaper = lastTask === "format" || lastTask === "polish";
  const n = words(cur?.content ?? "");

  return (
    <div
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s" && cur) { e.preventDefault(); clearTimeout(saveTimer.current); persist(cur).then(() => toast("Saved")); } }}
    >
      <PageHeader title="Drafting Studio" sub="Split-screen Markdown with AI tools that act on your selection — or the whole draft if nothing is selected.">
        <select value={cur?.id ?? ""} onChange={(e) => switchTo(Number(e.target.value))} className="input w-56" aria-label="Choose draft">
          {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <button onClick={create} className="btn-outline"><Plus className="size-4" /> New</button>
        <button onClick={remove} disabled={!cur} className="btn-ghost" aria-label="Delete draft"><Trash2 className="size-4" /></button>
        <details ref={menu} className="group relative">
          <summary className={`btn-primary cursor-pointer list-none ${exporting ? "pointer-events-none opacity-60" : ""}`}>
            <FileDown className="size-4" /> {exporting ? "Exporting…" : "Export"} <ChevronDown className="size-3.5 transition group-open:rotate-180" />
          </summary>
          <div className="card rise absolute right-0 z-30 mt-2 w-72 p-2" onClick={(e) => { if ((e.target as HTMLElement).closest("button") && menu.current) menu.current.open = false; }}>
            {([["pdf", "PDF", "Identical to the preview"], ["envoy", "Word document", "Editable .docx styled like the preview"],
              ["conference", "Word · conference format", "Times New Roman 12, justified, plain"]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => exportPaper(k)} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-subtle">
                <span className="text-sm font-medium">{t}</span><span className="text-xs text-muted">{d}</span>
              </button>
            ))}
            <label className="mt-1 flex cursor-pointer items-start gap-2 border-t border-line px-3 pb-1 pt-2.5 text-xs text-muted">
              <input type="checkbox" checked={polishFirst} onChange={(e) => setPolishFirst(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span><b className="text-fg">AI-polish layout first.</b> Fixes sections, proposals and the key quote without rewriting your content.</span>
            </label>
          </div>
        </details>
      </PageHeader>

      {cur && (
        <>
          <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
            <button onClick={() => run("tone")} disabled={ai.busy} className="btn-ghost"><Languages className="size-4" /> Diplomatic tone</button>
            <button onClick={() => run("polish")} disabled={ai.busy} className="btn-ghost" title="Restructure into the position paper layout without rewriting"><Wand2 className="size-4" /> Auto-format</button>
            <button onClick={() => run("format")} disabled={ai.busy} className="btn-ghost" title="Turn rough notes into a full, persuasive position paper"><ListChecks className="size-4" /> Write paper from notes</button>
            <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <form onSubmit={(e) => { e.preventDefault(); run("assist"); }} className="flex min-w-60 flex-1 items-center gap-2">
              <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Ask AI: “make this more persuasive”, “shorten to 60 seconds”…" className="input" />
              <button disabled={ai.busy || !instr.trim()} className="btn-primary"><Sparkles className="size-4" /> Run</button>
            </form>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col">
              <input value={cur.title} onChange={(e) => edit({ title: e.target.value })} className="border-b border-line bg-transparent px-5 py-3 font-display text-2xl outline-none" aria-label="Draft title" />
              <textarea
                ref={ta}
                value={cur.content}
                onChange={(e) => edit({ content: e.target.value })}
                placeholder={"Paste rough notes and press “Write paper from notes”,\nor write in Markdown and press “Auto-format”.\n\n**Committee:** UNEP\n**Topic:** …\n\n## Background\n…"}
                spellCheck
                className="flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13.5px] leading-relaxed outline-none"
              />
              <div className="flex items-center gap-3 border-t border-line px-5 py-2 text-xs text-muted">
                <span>{n} words</span>
                <span>≈ {fmtTime((n / s.wpm) * 60)} spoken at {s.wpm} wpm</span>
                <span className="ml-auto flex items-center gap-1">{saved ? <><Check className="size-3" /> Saved</> : "Saving…"}</span>
              </div>
            </div>

            <div className="card flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col">
              <div className="flex items-center gap-1 border-b border-line p-2">
                {(["preview", "ai"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? "bg-subtle font-medium" : "text-muted hover:text-fg"}`}>
                    {t === "preview" ? "Preview" : <span className="flex items-center gap-1.5">AI suggestion {ai.busy && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}</span>}
                  </button>
                ))}
                {tab === "ai" && (ai.out || ai.busy) && (
                  <div className="ml-auto flex gap-1">
                    {ai.busy ? (
                      <button onClick={ai.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>
                    ) : (
                      <>
                        <button onClick={() => apply("replace")} className="btn-primary">{target ? "Replace selection" : "Replace draft"}</button>
                        <button onClick={() => apply("insert")} className="btn-outline">Insert below</button>
                        <button onClick={() => copy(ai.out)} className="btn-ghost" aria-label="Copy"><Copy className="size-4" /></button>
                        <button onClick={ai.clear} className="btn-ghost" aria-label="Discard"><X className="size-4" /></button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto px-6 py-5">
                {tab === "preview" ? (
                  cur.content ? <Paper text={cur.content} wpm={s.wpm} profile={profile} /> : <p className="text-sm text-muted">Nothing to preview yet.</p>
                ) : (
                  <>
                    <ErrorNote msg={ai.error} />
                    {ai.out ? (isPaper ? <Paper text={ai.out} wpm={s.wpm} profile={profile} /> : <Markdown text={ai.out} />) : ai.busy ? <Thinking /> : (
                      <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
                        <FileText className="size-8 opacity-40" /> Select text in the editor and choose an AI action.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Standalone, print-ready HTML of the rendered paper: same CSS as the app, forced to the light theme. */
function paperHtml(el: HTMLElement) {
  const css = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const accent = document.documentElement.dataset.accent || "indigo";
  return `<!doctype html><html data-theme="light" data-dark="false" data-accent="${accent}"><head><meta charset="utf-8"><base href="${location.origin}/">
<style>${css}</style><style>@page{size:Letter;margin:18mm 20mm}html{font-size:14px;background:#fff}body{margin:0;background:#fff}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.paper{max-width:none!important}.paper-ui{display:none!important}
.paper-body blockquote,.paper-body ol>li{break-inside:avoid}.paper-body h2{break-after:avoid}</style></head><body>${el.outerHTML}</body></html>`;
}

function printFallback(html: string) {
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print the PDF");
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
}
