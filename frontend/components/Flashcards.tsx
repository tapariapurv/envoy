"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Shuffle } from "lucide-react";
import { Empty } from "./ui";
import { api, type Card } from "@/lib/api";

/** Flip-card drill. `deck` limits it to one deck (new cards go there too); without it every deck except Debate shows. */
export default function Flashcards({ deck: only }: { deck?: string }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => { api<Card[]>("/api/flashcards").then((all) => { const c = all.filter((x) => only ? x.deck === only : x.deck !== "Debate"); setCards(c); setOrder(c.map((x) => x.id)); }).catch(() => {}); }, []);

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
            const c = await api<Card>("/api/flashcards", "POST", { front, back, deck: only });
            setCards((x) => [...x, c]); setOrder((o) => [...o, c.id]); setFront(""); setBack("");
          }}><Plus className="size-4" /> Add card</button>
        </div>
      </aside>
    </div>
  );
}
