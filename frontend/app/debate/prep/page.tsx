"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Hourglass, Shuffle, Square } from "lucide-react";
import Timer from "@/components/Timer";
import { AIOutput, PageHeader, toast } from "@/components/ui";
import { api, useAI, type Draft, type Motion } from "@/lib/api";
import { FORMATS, fmt } from "@/lib/debate";
import { useSettings } from "@/lib/settings";

export default function PrepRoom() {
  const { s, set } = useSettings();
  const [motions, setMotions] = useState<Motion[]>([]);
  const ai = useAI();
  const router = useRouter();
  const F = fmt(s.format);

  useEffect(() => { api<Motion[]>("/api/motions").then(setMotions).catch(() => {}); }, []);

  const toCase = async () => {
    await api<Draft>("/api/drafts", "POST", { title: `Prep: ${s.topic}`.slice(0, 120), content: ai.out });
    toast("Saved to Case Builder"); router.push("/drafting");
  };

  return (
    <>
      <PageHeader title="Prep Room" sub="Break the motion down fast. Changes here are shared with everyone in this workspace, so partners can prep together." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex flex-col gap-3">
          <div className="card flex flex-col gap-3 p-5">
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between"><span className="label">Motion</span>
                {motions.length > 0 && <button onClick={() => set({ topic: motions[Math.floor(Math.random() * motions.length)].text })} className="flex items-center gap-1 text-xs text-accent"><Shuffle className="size-3" /> Random from motion bank</button>}
              </span>
              <textarea value={s.topic} onChange={(e) => set({ topic: e.target.value })} rows={2} placeholder="This House would…" className="input resize-y font-medium" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="label">Format</span>
                <select value={s.format || "bp"} onChange={(e) => set({ format: e.target.value, side: "" })} className="input">
                  {Object.entries(FORMATS).map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className="label">Our side</span>
                <select value={s.side} onChange={(e) => set({ side: e.target.value })} className="input">
                  <option value="">Not drawn yet</option>{F.sides.map((x) => <option key={x}>{x}</option>)}
                </select></label>
            </div>
            <div className="flex gap-2">
              <button disabled={!s.topic.trim() || ai.busy} onClick={() => ai.run("breakdown", { text: s.topic, topic: s.topic })} className="btn-primary">Break down the motion</button>
              {ai.busy && <button onClick={ai.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
            </div>
          </div>
          <AIOutput ai={ai} icon={Hourglass} empty="Definitions and model, burdens, stakeholders, the main clashes, the best arguments for both sides, and how to beat theirs."
            action={ai.out && !ai.busy ? <button onClick={toCase} className="btn-outline">Send to Case Builder →</button> : null} />
        </section>
        <aside className="flex flex-col gap-4">
          <Timer big label={`Prep time · ${F.name}`} seconds={F.prep} warning={120} sound={s.timer_sound} />
          <div className="card p-4 text-sm text-muted">
            <div className="label mb-2">Prep checklist</div>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Agree on definitions and the model (or counter-model).</li>
              <li>Find the 2–3 clashes the debate will turn on.</li>
              <li>Pick your best arguments and split them between speakers.</li>
              <li>Predict their best case and prepare the answers.</li>
              <li>Write your opening line and your weighing.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
