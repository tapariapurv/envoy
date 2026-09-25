"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ListTree, Plus, Search, Square, Trash2, X } from "lucide-react";
import { AIOutput, Empty, ErrorNote, PageHeader } from "@/components/ui";
import { api, useAI, type Flow } from "@/lib/api";
import { FORMATS, fmt } from "@/lib/debate";
import { useSettings } from "@/lib/settings";

/** A flow is a grid: one column per speech, one row per argument thread, so each response sits beside what it answers. */
type Grid = { rows: string[][]; dropped: string[] };
const parse = (f: Flow): Grid => { try { const g = JSON.parse(f.data); if (Array.isArray(g.rows)) return { rows: g.rows, dropped: g.dropped ?? [] }; } catch {} return { rows: [[]], dropped: [] }; };

export default function FlowPage() {
  const { s } = useSettings();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [cur, setCur] = useState<Flow | null>(null);
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ai = useAI();

  useEffect(() => { api<Flow[]>("/api/flows").then((f) => { setFlows(f); setCur(f[0] ?? null); }).catch((e) => setErr(String(e.message))); }, []);

  const edit = (p: Partial<Flow>) => {
    if (!cur) return;
    const f = { ...cur, ...p };
    setCur(f); setSaved(false);
    setFlows((fs) => fs.map((x) => (x.id === f.id ? f : x)));
    clearTimeout(timer.current);
    // ponytail: last write wins if two teammates edit the same flow at once; fine for one flower per flow
    timer.current = setTimeout(() => api(`/api/flows/${f.id}`, "PATCH", { title: f.title, format: f.format, data: f.data }).then(() => setSaved(true)).catch((e) => setErr(String(e.message))), 600);
  };
  const create = async () => {
    const f = await api<Flow>("/api/flows", "POST", { title: s.topic ? `Flow: ${s.topic}`.slice(0, 120) : "Untitled flow", format: s.format || "bp", data: JSON.stringify({ rows: [[]], dropped: [] }) });
    setFlows((x) => [f, ...x]); setCur(f); ai.clear();
  };
  const remove = async () => {
    if (!cur || !confirm(`Delete "${cur.title}"?`)) return;
    await api(`/api/flows/${cur.id}`, "DELETE");
    const rest = flows.filter((f) => f.id !== cur.id);
    setFlows(rest); setCur(rest[0] ?? null);
  };

  if (!cur) return (
    <>
      <PageHeader title="Flow" sub="Take notes speech by speech and never drop an argument." />
      <ErrorNote msg={err} />
      <div className="card"><Empty icon={ListTree} title="No flows yet">One column per speech, one row per argument.<button onClick={create} className="btn-primary mx-auto mt-4"><Plus className="size-4" /> New flow</button></Empty></div>
    </>
  );

  const g = parse(cur);
  const cols = fmt(cur.format).speeches.filter((x) => !x.cx);
  const setGrid = (n: Grid) => edit({ data: JSON.stringify(n) });
  const setCell = (r: number, c: number, v: string) => setGrid({ ...g, rows: g.rows.map((row, i) => i === r ? Object.assign([...row], { [c]: v }) : row) });
  const toggle = (id: string) => setGrid({ ...g, dropped: g.dropped.includes(id) ? g.dropped.filter((x) => x !== id) : [...g.dropped, id] });
  const deleteRow = (r: number) => setGrid({
    rows: g.rows.filter((_, i) => i !== r),
    dropped: g.dropped.flatMap((id) => { const [a, b] = id.split(":").map(Number); return a === r ? [] : [`${a > r ? a - 1 : a}:${b}`]; }),
  });
  const text = cols.map((sp, c) => `## ${sp.name}\n` + g.rows.map((row, r) => row[c]?.trim() ? `- Row ${r + 1}: ${row[c].trim()}${g.dropped.includes(`${r}:${c}`) ? " [DROPPED]" : ""}` : "").filter(Boolean).join("\n")).join("\n\n");

  return (
    <>
      <PageHeader title="Flow" sub="One column per speech, one row per argument: write each response beside what it answers. Mark anything left unanswered as dropped.">
        <select value={cur.id} onChange={(e) => { setCur(flows.find((f) => f.id === Number(e.target.value)) ?? null); ai.clear(); }} className="input w-56" aria-label="Choose flow">
          {flows.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        <button onClick={create} className="btn-outline"><Plus className="size-4" /> New</button>
        <button onClick={remove} className="btn-ghost" aria-label="Delete flow"><Trash2 className="size-4" /></button>
      </PageHeader>
      <ErrorNote msg={err} />

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <input value={cur.title} onChange={(e) => edit({ title: e.target.value })} className="input min-w-60 flex-1" aria-label="Flow title" />
        <select value={cur.format} onChange={(e) => edit({ format: e.target.value })} className="input w-52" aria-label="Format">
          {Object.entries(FORMATS).map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}
        </select>
        <button disabled={ai.busy || !text.includes("- Row")} onClick={() => ai.run("flowcheck", { text })} className="btn-primary"><Search className="size-4" /> Check the flow</button>
        {ai.busy && <button onClick={ai.stop} className="btn-ghost"><Square className="size-3.5" /> Stop</button>}
        <span className="ml-auto flex items-center gap-1 px-2 text-xs text-muted">{saved ? <><Check className="size-3" /> Saved</> : "Saving…"}</span>
      </div>

      <div className="card overflow-x-auto p-3">
        <table className="w-full border-separate border-spacing-1.5">
          <thead><tr>{cols.map((sp, c) => <th key={c} className="label min-w-48 text-left font-medium">{sp.name}</th>)}<th /></tr></thead>
          <tbody>
            {g.rows.map((row, r) => (
              <tr key={r}>
                {cols.map((_, c) => {
                  const id = `${r}:${c}`, dropped = g.dropped.includes(id);
                  return (
                    <td key={c} className="relative align-top">
                      <textarea value={row[c] ?? ""} onChange={(e) => setCell(r, c, e.target.value)} rows={3} aria-label={`${cols[c].name}, row ${r + 1}`}
                        className={`input resize-y text-[13px] leading-snug ${dropped ? "border-danger/50 bg-danger/5 line-through decoration-danger/60" : ""}`} />
                      {row[c]?.trim() && <button onClick={() => toggle(id)} className={`absolute bottom-2 right-1.5 rounded px-1 text-[10px] uppercase tracking-wide ${dropped ? "text-danger" : "text-muted hover:text-fg"}`}>{dropped ? "Dropped" : "Drop?"}</button>}
                    </td>
                  );
                })}
                <td className="align-top"><button onClick={() => deleteRow(r)} disabled={g.rows.length < 2} className="btn-ghost p-1" aria-label={`Delete row ${r + 1}`}><X className="size-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setGrid({ ...g, rows: [...g.rows, []] })} className="btn-ghost mt-1"><Plus className="size-4" /> Add argument row</button>
      </div>

      {(ai.out || ai.busy || ai.error) && <div className="mt-4"><AIOutput ai={ai} icon={ListTree} empty="" /></div>}
    </>
  );
}
