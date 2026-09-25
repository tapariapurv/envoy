"use client";
import { useEffect, useState } from "react";
import { MessageSquareWarning, ShieldCheck, Square, Swords } from "lucide-react";
import { AIOutput, PageHeader, SourcePopup } from "@/components/ui";
import { api, useAI, type Draft, type Source } from "@/lib/api";
import { opponents } from "@/lib/debate";
import { useSettings } from "@/lib/settings";

export default function Sparring() {
  const { s } = useSettings();
  const others = opponents(s.format, s.side);
  const [against, setAgainst] = useState("");
  const [ours, setOurs] = useState("");
  const [theirs, setTheirs] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [src, setSrc] = useState<Source | null>(null);
  const spar = useAI();
  const reply = useAI();

  useEffect(() => { api<Draft[]>("/api/drafts").then(setDrafts).catch(() => {}); }, []);
  const bench = against || others[0];

  return (
    <>
      <PageHeader title="Sparring" sub="The AI plays the other bench and attacks your case. Then answer it: POIs to throw back, and rebuttals backed by your own research." />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 font-medium"><Swords className="size-4 text-accent" /> Spar against your case</div>
            <label className="flex flex-col gap-1"><span className="label">Opposing bench</span>
              <select value={bench} onChange={(e) => setAgainst(e.target.value)} className="input">
                {others.map((x) => <option key={x}>{x}</option>)}
              </select></label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between"><span className="label">Our case{s.side && ` (${s.side})`}</span>
                {drafts.length > 0 && (
                  <select onChange={(e) => { const d = drafts.find((x) => x.id === Number(e.target.value)); if (d) setOurs(d.content); e.target.value = ""; }} defaultValue="" className="bg-transparent text-xs text-accent outline-none">
                    <option value="" disabled>Load from Case Builder…</option>
                    {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                )}
              </span>
              <textarea value={ours} onChange={(e) => setOurs(e.target.value)} rows={7} placeholder="Your arguments, model and weighing." className="input resize-y" /></label>
            <div className="flex gap-2">
              <button disabled={!ours.trim() || spar.busy} onClick={() => spar.run("spar", { text: `Our case:\n${ours}`, target: bench })} className="btn-primary">Hear their speech</button>
              {spar.busy && <button onClick={spar.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
            </div>
          </div>
          <AIOutput ai={spar} icon={Swords} empty="A full opposing speech: rebuttal of each of your arguments, one of their own, and where you were weakest."
            action={spar.out && !spar.busy ? <button onClick={() => setTheirs(spar.out)} className="btn-outline">Answer this →</button> : null} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-accent" /> Answer their case</div>
            <label className="flex flex-col gap-1"><span className="label">Their speech or argument</span>
              <textarea value={theirs} onChange={(e) => setTheirs(e.target.value)} rows={7} placeholder="Paste what the other side said, or send the sparring speech here." className="input resize-y" /></label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!theirs.trim() || reply.busy} onClick={() => reply.run("poi", { text: theirs })} className="btn-primary"><MessageSquareWarning className="size-4" /> POIs &amp; CX questions</button>
              <button disabled={!theirs.trim() || reply.busy} onClick={() => reply.run("rebut", { text: theirs, target: bench })} className="btn-outline">Rebut from my research</button>
              {reply.busy && <button onClick={reply.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
            </div>
          </div>
          <AIOutput ai={reply} icon={ShieldCheck} onCite={(n) => setSrc(reply.sources.find((x) => x.n === n) ?? null)}
            empty="Sharp points of information to throw at them, or rebuttals checked against the documents in your Research Hub." />
        </section>
      </div>
      <SourcePopup src={src} onClose={() => setSrc(null)} />
    </>
  );
}
