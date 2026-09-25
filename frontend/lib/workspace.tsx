"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { api, ApiError, session } from "./api";

export type Workspace = {
  id: number; name: string; conference: string; dates: string;
  delegate_country: string; committee: string; topic: string;
  share_on: number; share_code?: string; guest?: boolean;
  counts: { tasks: number; documents: number; drafts: number };
};

type Ctx = { ws: Workspace | null; guest: boolean; list: Workspace[]; switchTo: (id: number) => void; refresh: () => Promise<void>; leave: () => void };
const WorkspaceCtx = createContext<Ctx>({ ws: null, guest: false, list: [], switchTo: () => {}, refresh: async () => {}, leave: () => {} });
export const useWorkspace = () => useContext(WorkspaceCtx);

/** Resolves the active workspace; everything below remounts when it changes, so every page refetches its data. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [list, setList] = useState<Workspace[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "join">("loading");
  const [joinError, setJoinError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const cur = await api<Workspace>("/api/workspace");
      if (!cur.guest) { session.setWs(cur.id); setList(await api<Workspace[]>("/api/workspaces")); }
      setWs(cur); setState("ready"); setJoinError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (session.code) setJoinError("That code didn't work. It may have been changed or sharing was turned off.");
        session.setCode(null); setState("join");
      } else setState("ready"); // backend offline: pages show their own offline messages
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const switchTo = useCallback((id: number) => { session.setWs(id); refresh(); }, [refresh]);
  const leave = useCallback(() => { session.setCode(null); setWs(null); refresh(); }, [refresh]);

  if (state === "loading") return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  if (state === "join") return <Join error={joinError} onJoin={(code) => { session.setCode(code); refresh(); }} />;
  return (
    <WorkspaceCtx.Provider value={{ ws, guest: !!ws?.guest, list, switchTo, refresh, leave }}>
      <Fragment key={ws?.id ?? 0}>{children}</Fragment>
    </WorkspaceCtx.Provider>
  );
}

function Join({ error, onJoin }: { error: string; onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={(e) => { e.preventDefault(); if (clean.length === 10) onJoin(`${clean.slice(0, 5)}-${clean.slice(5)}`); }} className="card rise w-full max-w-sm p-8 text-center">
        <Logo className="mx-auto size-14" />
        <h1 className="mt-4 font-display text-3xl">Join a workspace</h1>
        <p className="mt-2 text-sm text-muted">Enter the access code your teammate shared with you.</p>
        <input
          autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDE-FGH23" maxLength={11}
          aria-label="Access code" className="input mt-6 text-center font-mono text-xl tracking-[.2em] uppercase"
        />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button disabled={clean.length !== 10} className="btn-primary mt-4 w-full py-2.5">Join <ArrowRight className="size-4" /></button>
      </form>
    </main>
  );
}
