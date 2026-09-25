"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import Flashcards from "@/components/Flashcards";
import { Empty, PageHeader, copy } from "@/components/ui";
import { api, type Clause } from "@/lib/api";

export default function Procedure() {
  const [tab, setTab] = useState<"clauses" | "cards">("clauses");
  return (
    <>
      <PageHeader title="Procedural Prep" sub="Resolution language at your fingertips, and Rules of Procedure drilled until they're automatic.">
        <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist">
          {([["clauses", "Clause Bank"], ["cards", "Flashcards"]] as const).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`rounded-lg px-4 py-1.5 text-sm ${tab === id ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      </PageHeader>
      {tab === "clauses" ? <ClauseBank /> : <Flashcards />}
    </>
  );
}

function ClauseBank() {
  const [items, setItems] = useState<Clause[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Clause["kind"]>("all");
  const [phrase, setPhrase] = useState("");
  const [example, setExample] = useState("");

  useEffect(() => { api<Clause[]>("/api/clauses").then(setItems).catch(() => {}); }, []);
  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return items.filter((c) => (kind === "all" || c.kind === kind) && (!needle || `${c.phrase} ${c.example} ${c.topic}`.toLowerCase().includes(needle)));
  }, [items, q, kind]);

  const add = async () => {
    if (!phrase.trim()) return;
    const c = await api<Clause>("/api/clauses", "POST", { kind: "custom", phrase, example });
    setItems((x) => [...x, c]); setPhrase(""); setExample("");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clauses…" className="input pl-9" autoFocus />
          </div>
          {(["all", "preambulatory", "operative", "custom"] as const).map((k) => (
            <button key={k} data-on={kind === k} onClick={() => setKind(k)} className="chip capitalize">{k}</button>
          ))}
        </div>
        {shown.length === 0 ? <Empty icon={Search} title="No matching clauses" /> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => (
              <div key={c.id} className="card group flex items-start gap-2 p-3">
                <button onClick={() => copy(`${c.phrase} `, `Copied “${c.phrase}”`)} className="min-w-0 flex-1 text-left" title="Click to copy">
                  <div className={`text-sm ${c.kind === "preambulatory" ? "italic" : c.kind === "operative" ? "font-medium underline decoration-accent/40 underline-offset-4" : ""}`}>{c.phrase}</div>
                  {c.example && <div className="mt-1 line-clamp-3 text-xs text-muted">{c.example}</div>}
                  <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted">{c.kind}</div>
                </button>
                {c.kind === "custom" && (
                  <button onClick={() => { api(`/api/clauses/${c.id}`, "DELETE"); setItems((x) => x.filter((y) => y.id !== c.id)); }} className="text-muted opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Delete clause"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <aside className="card h-fit p-5">
        <div className="mb-3 font-medium">Save your own clause</div>
        <div className="flex flex-col gap-2">
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Opening phrase, e.g. “Urges all Member States”" className="input" />
          <textarea value={example} onChange={(e) => setExample(e.target.value)} rows={4} placeholder="Full clause text or example usage (optional)" className="input resize-y" />
          <button onClick={add} disabled={!phrase.trim()} className="btn-primary"><Plus className="size-4" /> Add to bank</button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          <b>Preambulatory</b> clauses (italic) state context and end with a comma. <b>Operative</b> clauses (underlined) are numbered actions and end with a semicolon; the last ends with a period.
        </p>
      </aside>
    </div>
  );
}
