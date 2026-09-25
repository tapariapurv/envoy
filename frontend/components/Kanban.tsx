"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type Task } from "@/lib/api";
import { ErrorNote } from "./ui";

const COLS: { id: Task["status"]; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];
const PRI: Record<Task["priority"], string> = { low: "bg-muted/40", med: "bg-warn", high: "bg-danger" };
const NEXT_PRI: Record<Task["priority"], Task["priority"]> = { low: "med", med: "high", high: "low" };

export default function Kanban() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => { api<Task[]>("/api/tasks").then(setTasks).catch((e) => setErr(String(e.message))); }, []);

  const update = (id: number, p: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)).sort((a, b) => a.position - b.position));
    api(`/api/tasks/${id}`, "PATCH", p).catch((e) => setErr(String(e.message)));
  };
  const add = async (status: Task["status"], title: string) => {
    const t = await api<Task>("/api/tasks", "POST", { title, status });
    setTasks((ts) => [...ts, t]);
  };
  const remove = (id: number) => { setTasks((ts) => ts.filter((t) => t.id !== id)); api(`/api/tasks/${id}`, "DELETE"); };

  /** Drop before `beforeId` (or at column end): position = midpoint of neighbours. */
  const drop = (status: Task["status"], beforeId: number | null) => {
    if (drag === null || drag === beforeId) return setDrag(null);
    const col = tasks.filter((t) => t.status === status && t.id !== drag);
    const i = beforeId === null ? col.length : col.findIndex((t) => t.id === beforeId);
    const prev = col[i - 1]?.position ?? (col[0]?.position ?? 1) - 1;
    const next = col[i]?.position ?? prev + 2;
    update(drag, { status, position: (prev + next) / 2 });
    setDrag(null); setOver(null);
  };

  return (
    <section aria-label="Task board">
      <ErrorNote msg={err} />
      <div className="grid gap-4 md:grid-cols-3">
        {COLS.map((c) => {
          const items = tasks.filter((t) => t.status === c.id);
          return (
            <div
              key={c.id}
              onDragOver={(e) => { e.preventDefault(); setOver(c.id); }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={() => drop(c.id, null)}
              className={`flex min-h-64 flex-col rounded-2xl border p-2 transition ${over === c.id ? "border-accent/60 bg-accent/5" : "border-transparent bg-subtle/60"}`}
            >
              <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                <span className="text-sm font-medium">{c.label}</span>
                <span className="rounded-full bg-panel px-2 text-xs text-muted">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {items.map((t) => (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={() => setDrag(t.id)}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.stopPropagation(); drop(c.id, t.id); }}
                    className={`card group flex cursor-grab items-start gap-2 rounded-xl p-3 active:cursor-grabbing ${drag === t.id ? "opacity-40" : ""}`}
                  >
                    <button onClick={() => update(t.id, { priority: NEXT_PRI[t.priority] })} title={`Priority: ${t.priority} (click to change)`} className={`mt-1.5 size-2 shrink-0 rounded-full ${PRI[t.priority]}`} />
                    <p
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => { const v = e.currentTarget.textContent?.trim(); if (v && v !== t.title) update(t.id, { title: v }); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                      className={`min-w-0 flex-1 break-words text-sm outline-none ${t.status === "done" ? "text-muted line-through" : ""}`}
                    >
                      {t.title}
                    </p>
                    <button onClick={() => remove(t.id)} className="text-muted opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Delete task">
                      <Trash2 className="size-3.5" />
                    </button>
                  </article>
                ))}
                <AddTask onAdd={(title) => add(c.id, title)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AddTask({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }} className="flex items-center gap-1 rounded-xl px-2 text-muted focus-within:bg-panel">
      <Plus className="size-4 shrink-0" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add task" className="w-full bg-transparent py-2 text-sm text-fg outline-none placeholder:text-muted" />
    </form>
  );
}
