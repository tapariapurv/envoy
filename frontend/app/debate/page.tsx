"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Plus, Trash2, Trophy } from "lucide-react";
import Kanban from "@/components/Kanban";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";
import { api, type Round } from "@/lib/api";
import { fmt } from "@/lib/debate";
import { useSettings } from "@/lib/settings";

const PLACES = ["1st", "2nd", "3rd", "4th"]; // BP ranks; a 1st is worth 3 team points, a 4th none
const BLANK = { name: "", side: "", opponent: "", result: "", speaks: "", judge: "", motion: "", feedback: "" };

export default function RoundLog() {
  const { s } = useSettings();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [f, setF] = useState(BLANK);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const F = fmt(s.format);

  useEffect(() => { api<Round[]>("/api/rounds").then(setRounds).catch((e) => setErr(String(e.message))); }, []);

  const add = async () => {
    const speaks = f.speaks.trim() === "" ? null : Number(f.speaks);
    const r = await api<Round>("/api/rounds", "POST", { ...f, speaks, name: f.name || `Round ${rounds.length + 1}`, motion: f.motion || s.topic });
    setRounds((x) => [r, ...x]); setF(BLANK);
  };
  const remove = (id: number) => { api(`/api/rounds/${id}`, "DELETE"); setRounds((x) => x.filter((r) => r.id !== id)); };

  const bp = (s.format || "bp") === "bp";
  const wins = rounds.filter((r) => r.result === "Win").length, losses = rounds.filter((r) => r.result === "Loss").length;
  const points = rounds.reduce((a, r) => a + (PLACES.includes(r.result) ? 3 - PLACES.indexOf(r.result) : 0), 0);
  const scored = rounds.filter((r) => r.speaks != null);
  const avg = scored.length ? (scored.reduce((a, r) => a + Number(r.speaks), 0) / scored.length).toFixed(1) : "—";
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Round Log" sub={[s.team, F.name, s.topic].filter(Boolean).join(" · ") || "Log every round, the judge's feedback and your speaks."} />
      <ErrorNote msg={err} />
      <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-xl">
        {[bp ? ["Team points", String(points)] : ["Record", `${wins}–${losses}`], ["Avg. speaks", avg], ["Rounds", String(rounds.length)]].map(([k, v]) => (
          <div key={k} className="card px-4 py-3"><div className="label">{k}</div><div className="font-display text-3xl tabular-nums">{v}</div></div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex flex-col gap-2">
          {rounds.length ? rounds.map((r) => (
            <article key={r.id} className="card">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open === r.id}>
                <span className={`w-12 shrink-0 rounded-md py-0.5 text-center text-xs font-semibold ${["Win", "1st", "2nd"].includes(r.result) ? "bg-ok/15 text-ok" : r.result ? "bg-danger/10 text-danger" : "bg-subtle text-muted"}`}>{r.result || "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}{r.side && <span className="text-muted"> · {r.side}</span>}{r.opponent && <span className="text-muted"> vs {r.opponent}</span>}</span>
                  {r.motion && <span className="block truncate text-xs text-muted">{r.motion}</span>}
                </span>
                {r.speaks != null && <span className="font-mono text-sm tabular-nums">{r.speaks}</span>}
                <ChevronDown className={`size-4 text-muted transition ${open === r.id ? "rotate-180" : ""}`} />
              </button>
              {open === r.id && (
                <div className="border-t border-line px-4 py-3 text-sm">
                  {r.judge && <p className="mb-1 text-muted">Judge: <span className="text-fg">{r.judge}</span></p>}
                  <p className="whitespace-pre-wrap">{r.feedback || <span className="text-muted">No feedback logged.</span>}</p>
                  <button onClick={() => confirm(`Delete ${r.name}?`) && remove(r.id)} className="btn-ghost mt-2 text-danger"><Trash2 className="size-4" /> Delete</button>
                </div>
              )}
            </article>
          )) : <div className="card"><Empty icon={Trophy} title="No rounds yet">Log each round after it ends: result, speaks and the judge&apos;s reasons for decision.</Empty></div>}

          <h2 className="mt-6 font-display text-xl">Things to fix</h2>
          <Kanban />
        </section>

        <aside className="card h-fit p-5">
          <form onSubmit={(e) => { e.preventDefault(); add().catch((x) => setErr(String(x.message))); }} className="flex flex-col gap-2">
            <div className="mb-1 font-medium">Log a round</div>
            <div className="grid grid-cols-2 gap-2">
              <input value={f.name} onChange={set("name")} placeholder={`Round ${rounds.length + 1}`} className="input" aria-label="Round" />
              <select value={f.side} onChange={set("side")} className="input" aria-label="Side">
                <option value="">Side</option>{F.sides.map((x) => <option key={x}>{x}</option>)}
              </select>
              <input value={f.opponent} onChange={set("opponent")} placeholder="Opponent" className="input" aria-label="Opponent" />
              <select value={f.result} onChange={set("result")} className="input" aria-label="Result">
                <option value="">Result</option>{(bp ? PLACES : ["Win", "Loss"]).map((x) => <option key={x}>{x}</option>)}
              </select>
              <input value={f.speaks} onChange={set("speaks")} type="number" step="0.5" placeholder="Speaks" className="input" aria-label="Speaker points" />
              <input value={f.judge} onChange={set("judge")} placeholder="Judge" className="input" aria-label="Judge" />
            </div>
            <input value={f.motion} onChange={set("motion")} placeholder={s.topic || "Motion"} className="input" aria-label="Motion" />
            <textarea value={f.feedback} onChange={set("feedback")} rows={5} placeholder="Reason for decision and feedback" className="input resize-y" />
            <button className="btn-primary"><Plus className="size-4" /> Save round</button>
          </form>
        </aside>
      </div>
    </>
  );
}
