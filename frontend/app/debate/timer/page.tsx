"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Dices, Gavel, Plus, Search, Square, Trash2 } from "lucide-react";
import Flashcards from "@/components/Flashcards";
import Timer from "@/components/Timer";
import { AIOutput, Empty, Markdown, PageHeader, Thinking } from "@/components/ui";
import { api, fmtTime, useAI, type Motion } from "@/lib/api";
import { FORMATS, fmt } from "@/lib/debate";
import { useSettings } from "@/lib/settings";
import { useWorkspace } from "@/lib/workspace";

const TABS = [["timer", "Speech timer"], ["motions", "Motion bank"], ["drill", "Rebuttal drill"], ["cards", "Flashcards"]] as const;

export default function TimerDrills() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("timer");
  return (
    <>
      <PageHeader title="Timer & Drills" sub="Time every speech with protected-time bells, and drill until rebuttal is reflex.">
        <div className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1" role="tablist">
          {TABS.map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`rounded-lg px-4 py-1.5 text-sm ${tab === id ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      </PageHeader>
      {/* The timer stays mounted so switching tabs never loses a running clock. */}
      <div className={tab === "timer" ? "" : "hidden"}><SpeechTimer /></div>
      {tab === "motions" && <MotionBank />}
      {tab === "drill" && <Drill />}
      {tab === "cards" && <Flashcards deck="Debate" />}
    </>
  );
}

function SpeechTimer() {
  const { s } = useSettings();
  const [f, setF] = useState(s.format || "bp");
  const [i, setI] = useState(0);
  useEffect(() => { if (s.format) setF(s.format); }, [s.format]);
  const F = fmt(f), sp = F.speeches[Math.min(i, F.speeches.length - 1)];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex flex-col gap-4">
        <Timer key={`${f}-${i}`} big label={sp.name} seconds={sp.sec} poi={sp.poi} warning={30} sound={s.timer_sound} />
        <div className="flex items-center gap-2">
          <button disabled={i >= F.speeches.length - 1} onClick={() => setI(i + 1)} className="btn-primary">Next speech <ChevronRight className="size-4" /></button>
          {sp.poi && <span className="text-xs text-muted">Single knock at {fmtTime(sp.poi[0])} and {fmtTime(sp.poi[1])} (POI window), double at time.</span>}
        </div>
      </section>
      <aside className="flex flex-col gap-4">
        <select value={f} onChange={(e) => { setF(e.target.value); setI(0); }} className="input" aria-label="Format">
          {Object.entries(FORMATS).map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}
        </select>
        <ol className="card flex flex-col gap-0.5 p-2">
          {F.speeches.map((x, j) => (
            <li key={j}><button onClick={() => setI(j)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${j === i ? "bg-accent/10 font-medium text-accent" : "hover:bg-subtle"}`}>
              <span className="flex-1">{x.name}</span><span className="font-mono text-xs text-muted">{fmtTime(x.sec)}</span></button></li>
          ))}
        </ol>
        <Timer label="Prep time" seconds={F.prep} warning={60} sound={s.timer_sound} />
      </aside>
    </div>
  );
}

function MotionBank() {
  const { set } = useSettings();
  const { guest } = useWorkspace();
  const router = useRouter();
  const [items, setItems] = useState<Motion[]>([]);
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState("");
  const [text, setText] = useState("");
  const [newTheme, setNewTheme] = useState("");

  useEffect(() => { api<Motion[]>("/api/motions").then(setItems).catch(() => {}); }, []);
  const themes = useMemo(() => [...new Set(items.map((m) => m.theme).filter(Boolean))].sort(), [items]);
  const shown = items.filter((m) => (!theme || m.theme === theme) && `${m.text} ${m.theme}`.toLowerCase().includes(q.toLowerCase()));
  const use = (m: Motion) => { set({ topic: m.text }); router.push("/debate/prep"); };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-60 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search motions" className="input pl-9" /></label>
          <button onClick={() => shown.length && use(shown[Math.floor(Math.random() * shown.length)])} className="btn-outline"><Dices className="size-4" /> Random → prep</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["", ...themes].map((t) => <button key={t} data-on={theme === t} onClick={() => setTheme(t)} className="chip">{t || "All"}</button>)}
        </div>
        <div className="flex flex-col gap-2">
          {shown.map((m) => (
            <div key={m.id} className="card group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.text}</div>{m.theme && <div className="text-[10px] uppercase tracking-wider text-muted">{m.theme}</div>}</div>
              <button onClick={() => use(m)} className="btn-ghost text-accent">Prep this</button>
              {!guest && <button onClick={() => { api(`/api/motions/${m.id}`, "DELETE"); setItems((x) => x.filter((y) => y.id !== m.id)); }} className="text-muted opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Delete motion"><Trash2 className="size-3.5" /></button>}
            </div>
          ))}
          {!shown.length && <Empty icon={Search} title="No motions match" />}
        </div>
      </section>
      <aside className="card h-fit p-5">
        <form onSubmit={async (e) => {
          e.preventDefault(); if (!text.trim()) return;
          const m = await api<Motion>("/api/motions", "POST", { text, theme: newTheme });
          setItems((x) => [...x, m]); setText(""); setNewTheme("");
        }} className="flex flex-col gap-2">
          <div className="mb-1 font-medium">Add a motion</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="This House would…" className="input resize-y" />
          <input value={newTheme} onChange={(e) => setNewTheme(e.target.value)} list="themes" placeholder="Theme (e.g. Economics)" className="input" />
          <datalist id="themes">{themes.map((t) => <option key={t} value={t} />)}</datalist>
          <button disabled={!text.trim()} className="btn-primary"><Plus className="size-4" /> Add to bank</button>
        </form>
        <p className="mt-4 text-xs text-muted">The motion bank is shared across all your debate workspaces.</p>
      </aside>
    </div>
  );
}

function Drill() {
  const { s } = useSettings();
  const [motions, setMotions] = useState<Motion[]>([]);
  const [motion, setMotion] = useState("");
  const [side, setSide] = useState("");
  const [answer, setAnswer] = useState("");
  const [round, setRound] = useState(0);
  const arg = useAI();
  const judge = useAI();

  useEffect(() => { api<Motion[]>("/api/motions").then(setMotions).catch(() => {}); }, []);

  const next = () => {
    const m = s.topic && !motion ? s.topic : motions.length ? motions[Math.floor(Math.random() * motions.length)].text : s.topic;
    if (!m) return;
    const sides = fmt(s.format).sides, sd = sides[Math.floor(Math.random() * sides.length)];
    setMotion(m); setSide(sd); setAnswer(""); setRound((n) => n + 1); judge.clear();
    arg.run("drill", { text: `Give me an argument to rebut.`, topic: m, target: sd });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="flex flex-col gap-3">
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-medium">{motion || "Rebut an argument before the clock runs out"}</span>
            <button onClick={next} disabled={arg.busy} className="btn-primary"><Dices className="size-4" /> {round ? "Next argument" : "Start"}</button>
            {arg.busy && <button onClick={arg.stop} className="btn-ghost"><Square className="size-3.5" /></button>}
          </div>
          {side && <span className="label">{side} argues:</span>}
          {arg.out ? <Markdown text={arg.out} /> : arg.busy ? <Thinking /> : <p className="text-sm text-muted">You get a random motion and one argument from a random side. Rebut it in 60 seconds, then get it judged.</p>}
        </div>
        {round > 0 && <Timer key={round} label="Your rebuttal" seconds={60} warning={10} sound={s.timer_sound} />}
      </section>
      <section className="flex flex-col gap-3">
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={7} disabled={!arg.out} placeholder="Type (or summarise) your rebuttal…" className="input resize-y" />
        <button disabled={!answer.trim() || !arg.out || judge.busy} onClick={() => judge.run("assist", {
          text: `Argument (${side}):\n${arg.out}\n\nMy rebuttal:\n${answer}`,
          instruction: "Judge my rebuttal like an adjudicator: score it out of 10, then 3 short bullets on how to make it sharper (e.g. attack the mechanism, mitigate the impact, turn it). Then give a model 3-sentence rebuttal.",
        })} className="btn-primary w-fit"><Gavel className="size-4" /> Judge my rebuttal</button>
        {(judge.out || judge.busy || judge.error) && <AIOutput ai={judge} icon={Gavel} empty="" />}
      </section>
    </div>
  );
}
