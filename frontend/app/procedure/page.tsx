"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Search, Shuffle, Trash2 } from "lucide-react";
import { Empty, PageHeader, copy } from "@/components/ui";
import { api, type Card, type Clause } from "@/lib/api";

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

function Flashcards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => { api<Card[]>("/api/flashcards").then((c) => { setCards(c); setOrder(c.map((x) => x.id)); }).catch(() => {}); }, []);

  const deck = useMemo(() => order.map((id) => cards.find((c) => c.id === id)!).filter((c) => c && (!onlyNew || !c.known)), [order, cards, onlyNew]);
  const card = deck[Math.min(i, deck.length - 1)];
  const known = cards.filter((c) => c.known).length;

  const go = (d: number) => { setFlipped(false); setI((x) => (x + d + deck.length) % Math.max(deck.length, 1)); };
  const mark = (k: number) => {
    if (!card) return;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, known: k } : c)));
    api(`/api/flashcards/${card.id}`, "PATCH", { known: k });
    setFlipped(false);
    if (!(onlyNew && k)) go(1); // when filtering, the card leaves the deck and the index already points at the next one
  };
  const shuffle = () => { setOrder((o) => [...o].sort(() => Math.random() - 0.5)); setI(0); setFlipped(false); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col items-center gap-4">
        <div className="flex w-full max-w-2xl items-center gap-3 text-sm text-muted">
          <span>{known}/{cards.length} mastered</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-ok transition-all" style={{ width: `${(known / Math.max(cards.length, 1)) * 100}%` }} /></div>
          <button data-on={onlyNew} onClick={() => { setOnlyNew(!onlyNew); setI(0); }} className="chip">Unmastered only</button>
        </div>
        {card ? (
          <>
            <button onClick={() => setFlipped(!flipped)} data-flipped={flipped} className="flip h-80 w-full max-w-2xl" aria-label="Flip card">
              <div className="flip-inner relative h-full w-full">
                <div className="flip-face card absolute inset-0 flex flex-col items-center justify-center p-8">
                  <span className="label mb-3">{card.deck}</span>
                  <span className="font-display text-3xl sm:text-4xl">{card.front}</span>
                  <span className="mt-6 text-xs text-muted">Space or click to reveal</span>
                </div>
                <div className="flip-face flip-back card absolute inset-0 flex items-center justify-center p-8">
                  <p className="text-lg leading-relaxed">{card.back}</p>
                </div>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => go(-1)} className="btn-outline" aria-label="Previous"><ChevronLeft className="size-4" /></button>
              <span className="w-16 text-center text-sm tabular-nums text-muted">{Math.min(i, deck.length - 1) + 1} / {deck.length}</span>
              <button onClick={() => go(1)} className="btn-outline" aria-label="Next"><ChevronRight className="size-4" /></button>
              <div className="mx-2 h-5 w-px bg-line" />
              <button onClick={() => mark(0)} className="btn-outline"><RotateCcw className="size-4" /> Review again</button>
              <button onClick={() => mark(1)} className="btn-primary">Got it</button>
              <button onClick={shuffle} className="btn-ghost" aria-label="Shuffle"><Shuffle className="size-4" /></button>
            </div>
          </>
        ) : (
          <Empty icon={RotateCcw} title={onlyNew ? "Everything mastered" : "No cards"}>{onlyNew && "Turn off “Unmastered only” to review the full deck."}</Empty>
        )}
      </section>
      <aside className="card h-fit p-5">
        <div className="mb-3 font-medium">Add a card</div>
        <div className="flex flex-col gap-2">
          <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front (term or question)" className="input" />
          <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={4} placeholder="Back (definition or answer)" className="input resize-y" />
          <button disabled={!front.trim() || !back.trim()} className="btn-primary" onClick={async () => {
            const c = await api<Card>("/api/flashcards", "POST", { front, back });
            setCards((x) => [...x, c]); setOrder((o) => [...o, c.id]); setFront(""); setBack("");
          }}><Plus className="size-4" /> Add card</button>
        </div>
      </aside>
    </div>
  );
}
