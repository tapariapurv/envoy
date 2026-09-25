"use client";
import { useEffect, useState } from "react";
import { Copy, ShieldCheck, Square, Swords, X } from "lucide-react";
import { Empty, ErrorNote, Markdown, PageHeader, Thinking, copy } from "@/components/ui";
import { api, useAI, type Draft, type Source } from "@/lib/api";
import { useSettings } from "@/lib/settings";

export default function Opponent() {
  const { s } = useSettings();
  const [target, setTarget] = useState("");
  const [topic, setTopic] = useState("");
  const [position, setPosition] = useState("");
  const [claim, setClaim] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [src, setSrc] = useState<Source | null>(null);
  const sim = useAI();
  const reb = useAI();

  useEffect(() => { api<Draft[]>("/api/drafts").then(setDrafts).catch(() => {}); }, []);
  useEffect(() => { if (!topic) setTopic(s.topic); }, [s.topic]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Opponent Simulator" sub="Stress-test your position against a specific delegation, then pull factual rebuttals from your own research vault." />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 font-medium"><Swords className="size-4 text-accent" /> Simulate an opponent</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="label">Target delegation</span>
                <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. Russian Federation" className="input" /></label>
              <label className="flex flex-col gap-1"><span className="label">Topic</span>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Agenda topic" className="input" /></label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between"><span className="label">Your position{s.delegate_country && ` (${s.delegate_country})`}</span>
                {drafts.length > 0 && (
                  <select onChange={(e) => { const d = drafts.find((x) => x.id === Number(e.target.value)); if (d) setPosition(d.content); e.target.value = ""; }} defaultValue="" className="bg-transparent text-xs text-accent outline-none">
                    <option value="" disabled>Load from draft…</option>
                    {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                )}
              </span>
              <textarea value={position} onChange={(e) => setPosition(e.target.value)} rows={6} placeholder="Summarize your stance, key proposals, and red lines." className="input resize-y" />
            </label>
            <div className="flex gap-2">
              <button disabled={!target.trim() || !position.trim() || sim.busy} onClick={() => sim.run("counter", { text: position, target, topic })} className="btn-primary">Generate counter-arguments</button>
              {sim.busy && <button onClick={sim.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
            </div>
          </div>
          <Output ai={sim} empty="The 5 strongest arguments against you, the interest behind each, and how to respond." action={sim.out && !sim.busy ? <button onClick={() => setClaim(sim.out)} className="btn-outline">Rebut these →</button> : null} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-accent" /> Rebuttal engine</div>
            <label className="flex flex-col gap-1"><span className="label">Opponent&apos;s argument</span>
              <textarea value={claim} onChange={(e) => setClaim(e.target.value)} rows={6} placeholder="Paste a claim made on the floor, or send the simulated arguments here." className="input resize-y" /></label>
            <div className="flex gap-2">
              <button disabled={!claim.trim() || reb.busy} onClick={() => reb.run("rebut", { text: claim, target })} className="btn-primary">Scan vault for rebuttals</button>
              {reb.busy && <button onClick={reb.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
            </div>
          </div>
          <Output ai={reb} onCite={(n) => setSrc(reb.sources.find((x) => x.n === n) ?? null)} empty="Each claim is checked against your uploaded documents, with citations you can click to verify." />
        </section>
      </div>

      {src && (
        <div role="dialog" aria-label="Source" className="rise fixed bottom-5 right-5 z-40 w-[min(480px,calc(100vw-2.5rem))] card p-4">
          <div className="mb-2 flex items-center gap-2"><span className="flex-1 truncate text-sm font-medium">[{src.n}] {src.name}</span>
            <button onClick={() => setSrc(null)} className="btn-ghost p-1" aria-label="Close"><X className="size-4" /></button></div>
          <div className="max-h-72 overflow-auto text-sm"><Markdown text={src.text} /></div>
        </div>
      )}
    </>
  );
}

function Output({ ai, empty, action, onCite }: { ai: ReturnType<typeof useAI>; empty: string; action?: React.ReactNode; onCite?: (n: number) => void }) {
  return (
    <div className="card min-h-64 p-5">
      <ErrorNote msg={ai.error} />
      {ai.out ? (
        <>
          <div className="mb-2 flex justify-end gap-1">{action}<button onClick={() => copy(ai.out)} className="btn-ghost" aria-label="Copy"><Copy className="size-4" /></button></div>
          <Markdown text={ai.out} onCite={onCite} />
        </>
      ) : ai.busy ? <Thinking /> : !ai.error && <Empty icon={Swords} title="No output yet">{empty}</Empty>}
    </div>
  );
}
