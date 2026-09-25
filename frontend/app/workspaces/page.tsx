"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Copy, Pencil, Plus, RefreshCw, Trash2, Users, Wifi, X } from "lucide-react";
import { HOME } from "@/components/Sidebar";
import { ErrorNote, PageHeader, copy, toast } from "@/components/ui";
import { FORMATS } from "@/lib/debate";
import { api } from "@/lib/api";
import { useWorkspace, type Workspace } from "@/lib/workspace";

type Kind = Workspace["kind"];
const FIELDS: Record<Kind, [string, string, string][]> = {
  mun: [["name", "Workspace name", "e.g. HMUN 2026"], ["conference", "Conference", "Harvard Model United Nations"],
    ["dates", "Dates", "Jan 29 – Feb 1, 2027"], ["delegate_country", "Country", "Republic of Kenya"],
    ["committee", "Committee", "UNEP"], ["topic", "Topic", "Plastic pollution"]],
  debate: [["name", "Workspace name", "e.g. Worlds 2027"], ["conference", "Tournament", "World Schools Debating Championship"],
    ["dates", "Dates", "Jul 12 – 22, 2027"], ["format", "Format", ""], ["team", "Team", "Team Canada A"],
    ["side", "Side (if known)", "Proposition"], ["topic", "Motion (if known)", "This House would ban zoos"]],
};
const DETAILS: Record<Kind, [string, keyof Workspace][]> = {
  mun: [["Country", "delegate_country"], ["Committee", "committee"], ["Topic", "topic"]],
  debate: [["Format", "format"], ["Team", "team"], ["Side", "side"]],
};
type Form = Record<string, string>;
const empty = (kind: Kind): Form => ({ kind, ...Object.fromEntries(FIELDS[kind].map(([k]) => [k, k === "format" ? "bp" : ""])) });

export default function WorkspacesPage() {
  return <Suspense><Workspaces /></Suspense>;
}

function Workspaces() {
  const { ws, guest, list, refresh, switchTo } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState<Kind | null>(params.get("new") === "1" ? (params.get("kind") === "debate" ? "debate" : ws?.kind ?? "mun") : null);
  const [editing, setEditing] = useState<number | null>(null);
  const [share, setShare] = useState<{ share: boolean; share_url: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => { api<{ share: boolean; share_url: string }>("/api/health").then(setShare).catch(() => {}); }, []);

  if (guest) return (
    <>
      <PageHeader title="Workspaces" />
      <p className="text-muted">You&apos;re a guest in <b className="text-fg">{ws?.name}</b>. Only its owner can manage workspaces.</p>
    </>
  );

  const run = async (fn: () => Promise<unknown>) => { setErr(""); try { await fn(); await refresh(); } catch (e) { setErr(String((e as Error).message)); } };

  return (
    <>
      <PageHeader title="Workspaces" sub="One workspace per conference or tournament: its own research vault, drafts and profile. Share it with your delegation or team.">
        <button onClick={() => setCreating(ws?.kind ?? "mun")} className="btn-primary"><Plus className="size-4" /> New workspace</button>
      </PageHeader>
      <ErrorNote msg={err} />

      {creating && (
        <WorkspaceForm
          key={creating} title="New workspace" initial={empty(creating)} submit="Create workspace" onCancel={() => setCreating(null)} onKind={setCreating}
          onSave={(f) => run(async () => {
            const w = await api<Workspace>("/api/workspaces", "POST", f);
            setCreating(null); switchTo(w.id); router.push(HOME[w.kind]); toast(`Switched to ${w.name}`);
          })}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((w) => editing === w.id ? (
          <WorkspaceForm key={w.id} title={`Edit ${w.name}`} initial={pick(w)} submit="Save" onCancel={() => setEditing(null)}
            onSave={(f) => run(async () => { await api(`/api/workspaces/${w.id}`, "PATCH", f); setEditing(null); })} />
        ) : (
          <article key={w.id} className={`card flex flex-col p-5 ${w.id === ws?.id ? "ring-2 ring-accent/40" : ""}`}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-lg font-semibold text-accent">{w.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 font-display text-xl"><span className="truncate">{w.name}</span>
                  <span className="rounded bg-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-muted">{w.kind === "debate" ? "Debate" : "MUN"}</span></h2>
                <p className="truncate text-sm text-muted">{[w.conference, w.dates].filter(Boolean).join(" · ") || "No conference details yet"}</p>
              </div>
              {w.id === ws?.id && <span className="chip" data-on="true">Active</span>}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              {DETAILS[w.kind].map(([k, f]) => (
                <div key={k} className="min-w-0 rounded-lg bg-subtle/70 px-3 py-2"><dt className="label">{k}</dt>
                  <dd className="truncate">{(f === "format" ? FORMATS[w.format]?.name : String(w[f] ?? "")) || "—"}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">{w.kind === "debate"
              ? `${w.counts.rounds} rounds · ${w.counts.documents} documents · ${w.counts.drafts} cases`
              : `${w.counts.tasks} tasks · ${w.counts.documents} documents · ${w.counts.drafts} drafts`}</p>

            <SharePanel w={w} share={share} onChange={(body) => run(() => api(`/api/workspaces/${w.id}/share`, "POST", body))} />

            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {w.id !== ws?.id && <button onClick={() => { switchTo(w.id); router.push(HOME[w.kind]); }} className="btn-primary">Open <ArrowRight className="size-4" /></button>}
              <button onClick={() => setEditing(w.id)} className="btn-outline"><Pencil className="size-3.5" /> Edit</button>
              <button disabled={list.length < 2} title={list.length < 2 ? "You need at least one workspace" : undefined}
                onClick={() => confirm(`Delete "${w.name}" and all its tasks, documents and drafts? This cannot be undone.`) && run(async () => {
                  await api(`/api/workspaces/${w.id}`, "DELETE");
                  const rest = list.filter((x) => x.id !== w.id);
                  if (w.id === ws?.id) switchTo((rest.find((x) => x.kind === w.kind) ?? rest[0]).id);
                })} className="btn-ghost ml-auto text-danger"><Trash2 className="size-4" /></button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

const pick = (w: Workspace): Form => ({ kind: w.kind, ...Object.fromEntries(FIELDS[w.kind].map(([k]) => [k, (w as unknown as Form)[k] || (k === "format" ? "bp" : "")])) });

function WorkspaceForm({ title, initial, submit, onSave, onCancel, onKind }: { title: string; initial: Form; submit: string; onSave: (f: Form) => void; onCancel: () => void; onKind?: (k: Kind) => void }) {
  const [f, setF] = useState(initial);
  const kind = f.kind as Kind;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave(f); }} className="card rise mb-4 p-5 lg:col-span-2">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl">{title}</h2>
        <button type="button" onClick={onCancel} className="btn-ghost p-1.5" aria-label="Cancel"><X className="size-4" /></button></div>
      {onKind && (
        <div className="mb-4 flex w-fit gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Workspace type">
          {([["mun", "Model UN conference"], ["debate", "Debate tournament"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => onKind(k)}
              className={`rounded-lg px-4 py-1.5 text-sm ${kind === k ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS[kind].map(([k, label, ph]) => (
          <label key={k} className="flex flex-col gap-1"><span className="label">{label}</span>
            {k === "format" ? (
              <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="input">
                {Object.entries(FORMATS).map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}
              </select>
            ) : <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} required={k === "name"} autoFocus={k === "name"} className="input" />}</label>
        ))}
      </div>
      <div className="mt-4 flex gap-2"><button className="btn-primary">{submit}</button><button type="button" onClick={onCancel} className="btn-ghost">Cancel</button></div>
    </form>
  );
}

function SharePanel({ w, share, onChange }: { w: Workspace; share: { share: boolean; share_url: string } | null; onChange: (b: object) => void }) {
  const on = !!w.share_on;
  const invite = `Join my Envoy workspace "${w.name}": open ${share?.share_url || "the Envoy link I send you"} and enter the code ${w.share_code}`;
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted" />
        <span className="flex-1 text-sm font-medium">Teammate access</span>
        <button role="switch" aria-checked={on} aria-label="Share this workspace" onClick={() => onChange({ on: !on })}
          className={`relative h-6 w-10 rounded-full transition ${on ? "bg-accent" : "bg-line"}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </div>
      {on && w.share_code && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-subtle px-3 py-2 text-center font-mono text-lg tracking-[.2em]">{w.share_code}</code>
            <button onClick={() => copy(w.share_code!, "Code copied")} className="btn-outline" aria-label="Copy code"><Copy className="size-4" /></button>
            <button onClick={() => confirm("Generate a new code? The old one stops working immediately.") && onChange({ on: true, regenerate: true })} className="btn-ghost" aria-label="New code" title="New code"><RefreshCw className="size-4" /></button>
          </div>
          <button onClick={() => copy(invite, "Invite copied")} className="btn-ghost justify-start text-xs"><Copy className="size-3.5" /> Copy invite message</button>
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Wifi className="mt-0.5 size-3.5 shrink-0" />
            {share?.share
              ? <span>Teammates on your network open <b className="text-fg">{share.share_url}</b> and enter this code. They only see this workspace.</span>
              : <span>To let teammates connect, restart Envoy with <code className="rounded bg-subtle px-1">npm run share</code> (same Wi-Fi). They only see this workspace.</span>}
          </p>
        </div>
      )}
    </div>
  );
}
