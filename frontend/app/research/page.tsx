"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Globe, Loader2, Lock, MessageSquareText, Square, Trash2, Upload, X } from "lucide-react";
import { Empty, ErrorNote, Markdown, PageHeader, Thinking, copy } from "@/components/ui";
import WebResearch from "@/components/WebResearch";
import { api, friendly, useAI, type Doc, type Source } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };
const SUGGEST = ["Summarize my country's official position on this topic", "What past UN resolutions address this issue?", "List key statistics I can cite in my opening speech"];

export default function Research() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [scope, setScope] = useState<number[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadErr, setUploadErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<{ title: string; body: string } | null>(null);
  const [tab, setTab] = useState<"vault" | "web">("vault");
  const ai = useAI();
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = () => api<Doc[]>("/api/docs").then(setDocs).catch((e) => setUploadErr(String(e.message)));
  useEffect(() => { load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, ai.out]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploadErr(""); setUploading(list.map((f) => f.name));
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    try {
      const res = await api<{ name: string; error?: string }[]>("/api/docs", "POST", fd);
      const bad = res.filter((r) => r.error);
      if (bad.length) setUploadErr(bad.map((b) => `${b.name}: ${friendly(b.error!)}`).join("\n"));
      load();
    } catch (e) { setUploadErr(String((e as Error).message)); }
    setUploading([]);
  }

  async function ask(text = q) {
    if (!text.trim() || ai.busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ("");
    const r = await ai.run("chat", { text, doc_ids: scope.length ? scope : null, history });
    setMsgs((m) => [...m, { role: "assistant", content: r.text, sources: r.sources }]);
    ai.clear();
  }

  const openSource = (sources: Source[] | undefined, n: number) => {
    const src = sources?.find((x) => x.n === n);
    if (src) setPanel({ title: `[${n}] ${src.name} · part ${src.chunk + 1}`, body: src.text });
  };
  const openDoc = async (d: Doc) => setPanel({ title: d.name, body: (await api<{ markdown: string }>(`/api/docs/${d.id}`)).markdown });

  return (
    <>
      <PageHeader title="Research Hub" sub={tab === "web" ? "Systematic research on a motion or topic, from trusted sources only." : "Everything is parsed, embedded, and searched on this machine. Nothing leaves it when using a local model."}>
        <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Research mode">
          {([["vault", "Private vault", Lock], ["web", "Web research", Globe]] as const).map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${tab === k ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}><Icon className="size-3.5" /> {l}</button>
          ))}
        </div>
      </PageHeader>

      {tab === "web" ? <WebResearch /> : <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
            className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? "border-accent bg-accent/5" : "border-line hover:border-muted"}`}
          >
            {uploading.length ? <Loader2 className="size-6 animate-spin text-accent" /> : <Upload className="size-6 text-muted" />}
            <span className="text-sm font-medium">{uploading.length ? `Parsing & embedding ${uploading.length} file(s)…` : "Drop documents here"}</span>
            <span className="text-xs text-muted">PDF, DOCX, PPTX, XLSX, HTML, TXT, MD · up to 50 MB</span>
          </button>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.pptx,.xlsx,.html,.htm,.txt,.md,.csv,.json" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
          {uploadErr && <ErrorNote msg={uploadErr} />}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="label">Vault · {docs.length}</span>
              {scope.length > 0 && <button onClick={() => setScope([])} className="text-xs text-accent">Search all</button>}
            </div>
            {docs.length === 0 ? (
              <Empty icon={FileText} title="No documents yet">Add background guides, country policy, UN reports, and news articles.</Empty>
            ) : (
              <ul className="max-h-[55vh] divide-y divide-line overflow-auto">
                {docs.map((d) => (
                  <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" checked={scope.includes(d.id)} onChange={(e) => setScope((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))} className="accent-[var(--accent)]" aria-label={`Limit chat to ${d.name}`} />
                    <button onClick={() => openDoc(d)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm">{d.name}</div>
                      <div className="text-xs text-muted">{d.chunks} chunks · {(d.chars / 1000).toFixed(1)}k chars</div>
                    </button>
                    <button onClick={() => api(`/api/docs/${d.id}`, "DELETE").then(load)} className="text-muted opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${d.name}`}><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="px-1 text-xs text-muted">{scope.length ? `Chat limited to ${scope.length} selected document(s).` : "Tick documents to limit chat to them; otherwise all are searched."}</p>
        </section>

        <section className="card flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col">
          <div className="flex-1 overflow-auto px-5 py-5">
            {msgs.length === 0 && !ai.busy ? (
              <Empty icon={MessageSquareText} title="Ask across your documents">
                Answers cite the exact passages they come from. Click a citation to read the source.
                <div className="mt-4 flex flex-col gap-2">
                  {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)} disabled={!docs.length} className="btn-outline justify-start text-left">{s}</button>)}
                </div>
              </Empty>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-6">
                {msgs.map((m, i) => <Message key={i} m={m} onCite={(n) => openSource(m.sources, n)} />)}
                {ai.busy && <Message m={{ role: "assistant", content: ai.out, sources: ai.sources }} onCite={(n) => openSource(ai.sources, n)} pending />}
                <ErrorNote msg={ai.error} />
                <div ref={endRef} />
              </div>
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="border-t border-line p-3">
            <div className="flex items-end gap-2 rounded-xl border border-line bg-bg p-2 focus-within:border-accent">
              <textarea
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
                rows={1}
                placeholder={docs.length ? "Ask a question about your research…" : "Upload a document to start"}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content]"
              />
              {ai.busy ? (
                <button type="button" onClick={ai.stop} className="btn-outline" aria-label="Stop"><Square className="size-4" /></button>
              ) : (
                <button disabled={!q.trim()} className="btn-primary" aria-label="Send"><ArrowUp className="size-4" /></button>
              )}
            </div>
            {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="mt-1 text-xs text-muted hover:text-fg">New conversation</button>}
          </form>
        </section>
      </div>}

      {panel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onClick={() => setPanel(null)}>
          <aside className="rise flex h-full w-full max-w-xl flex-col border-l border-line bg-panel" onClick={(e) => e.stopPropagation()} aria-label="Source viewer">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <span className="flex-1 truncate font-medium">{panel.title}</span>
              <button onClick={() => copy(panel.body)} className="btn-ghost">Copy</button>
              <button onClick={() => setPanel(null)} className="btn-ghost" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-5"><Markdown text={panel.body} /></div>
          </aside>
        </div>
      )}
    </>
  );
}

function Message({ m, onCite, pending }: { m: Msg; onCite: (n: number) => void; pending?: boolean }) {
  if (m.role === "user") return <div className="rise ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg">{m.content}</div>;
  return (
    <div className="rise">
      {m.content ? <Markdown text={m.content} onCite={onCite} /> : pending && <Thinking />}
      {!!m.sources?.length && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.sources.map((s) => (
            <button key={s.n} onClick={() => onCite(s.n)} className="chip flex max-w-60 items-center gap-1" title={`Relevance ${Math.round(s.score * 100)}%`}>
              <span className="font-semibold text-accent">{s.n}</span> <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
