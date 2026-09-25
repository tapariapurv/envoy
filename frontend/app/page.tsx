"use client";
import { useEffect, useState } from "react";
import { ChevronRight, Mic, X } from "lucide-react";
import Kanban from "@/components/Kanban";
import Timer from "@/components/Timer";
import { PageHeader } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { useWorkspace } from "@/lib/workspace";

export default function WarRoom() {
  const { s } = useSettings();
  const [tab, setTab] = useState<"speaker" | "mod" | "unmod">("speaker");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <PageHeader title="War Room" sub={[s.delegate_country && `Delegation of ${s.delegate_country}`, s.topic, today].filter(Boolean).join(" · ")} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Kanban />
        <aside className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist">
            {([["speaker", "Speaker"], ["mod", "Mod. caucus"], ["unmod", "Unmod."]] as const).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex-1 rounded-lg py-1.5 text-sm transition ${tab === id ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
            ))}
          </div>
          {/* Timers stay mounted so switching tabs never loses a running clock. */}
          <div className={tab === "speaker" ? "contents" : "hidden"}>
            <Timer big label="Speaking time" seconds={s.timer_speaker} warning={s.timer_warning} sound={s.timer_sound} />
          </div>
          <div className={tab === "mod" ? "flex flex-col gap-4" : "hidden"}>
            <Timer label="Caucus total" seconds={s.timer_mod_total} warning={60} sound={s.timer_sound} />
            <Timer big label="Per speaker" seconds={s.timer_mod_speaker} warning={s.timer_warning} sound={s.timer_sound} />
          </div>
          <div className={tab === "unmod" ? "contents" : "hidden"}>
            <Timer big label="Unmoderated caucus" seconds={s.timer_unmod} warning={60} sound={s.timer_sound} />
          </div>
          <Timer label="Stopwatch" seconds={0} />
          <SpeakersList />
          <p className="text-center text-xs text-muted">Focus a timer and press <kbd className="rounded border border-line px-1">Space</kbd> to start/pause, <kbd className="rounded border border-line px-1">R</kbd> to reset.</p>
        </aside>
      </div>
    </>
  );
}

function SpeakersList() {
  const key = `envoy-speakers-${useWorkspace().ws?.id ?? 0}`;
  const [list, setList] = useState<string[]>([]);
  const [spoken, setSpoken] = useState(0);
  const [v, setV] = useState("");

  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(key) || "{}"); setList(d.list ?? []); setSpoken(d.spoken ?? 0); } catch {}
  }, [key]);
  const save = (l: string[], sp = spoken) => { setList(l); setSpoken(sp); try { localStorage.setItem(key, JSON.stringify({ list: l, spoken: sp })); } catch {} };

  return (
    <section className="card p-4" aria-label="Speakers list">
      <div className="mb-2 flex items-center justify-between">
        <span className="label flex items-center gap-1.5"><Mic className="size-3.5" /> Speakers list</span>
        <span className="text-xs text-muted">{spoken} spoken</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { save([...list, v.trim()]); setV(""); } }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add delegation, press Enter" className="input" />
      </form>
      <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-auto">
        {list.map((c, i) => (
          <li key={i} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${i === 0 ? "bg-accent/10 font-medium text-accent" : ""}`}>
            <span className="w-5 text-xs text-muted">{i + 1}</span>
            <span className="flex-1 truncate">{c}</span>
            <button onClick={() => save(list.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${c}`}><X className="size-3.5" /></button>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex gap-2">
        <button disabled={!list.length} onClick={() => save(list.slice(1), spoken + 1)} className="btn-outline flex-1">Next speaker <ChevronRight className="size-4" /></button>
        <button disabled={!list.length && !spoken} onClick={() => save([], 0)} className="btn-ghost">Clear</button>
      </div>
    </section>
  );
}
