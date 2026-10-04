"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { onAuthStateChanged, type User } from "firebase/auth";
import { toast } from "@/components/ui";
import { api, session } from "./api";
import { join } from "./backend";
import { auth, signIn } from "./firebase";

export type Workspace = {
  id: string; name: string; owner: string; members: string[]; conference: string; dates: string;
  kind: "mun" | "debate"; delegate_country: string; committee: string; topic: string;
  format: string; side: string; team: string;
  share_on: boolean; share_code?: string; guest?: boolean;
  counts: { tasks: number; documents: number; drafts: number; rounds: number; flows: number };
};

type Ctx = { ws: Workspace | null; guest: boolean; list: Workspace[]; user: User | null; switchTo: (id: string) => void; refresh: () => Promise<void>; leave: () => void };
const WorkspaceCtx = createContext<Ctx>({ ws: null, guest: false, list: [], user: null, switchTo: () => {}, refresh: async () => {}, leave: () => {} });
export const useWorkspace = () => useContext(WorkspaceCtx);

/** Signs the user in, then resolves the active workspace; everything below remounts when it changes, so every page refetches. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [list, setList] = useState<Workspace[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin">("loading");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const code = new URLSearchParams(location.search).get("join");
      if (code) { // invite link: envoy.app/?join=ABCDE-FGH23
        history.replaceState(null, "", location.pathname);
        await join(code).then(() => toast("Joined the workspace")).catch((e) => toast(String(e.message)));
      }
      const cur = await api<Workspace>("/api/workspace");
      setList(await api<Workspace[]>("/api/workspaces"));
      setWs(cur); setState("ready");
    } catch (e) {
      setError(String((e as Error).message)); setState("ready");
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    if (u) refresh(); else { setWs(null); setState("signin"); }
  }), [refresh]);

  const switchTo = useCallback((id: string) => { session.setWs(id); refresh(); }, [refresh]);
  const leave = useCallback(() => {
    if (ws && confirm(`Leave "${ws.name}"? You'll need a new code to rejoin.`)) api(`/api/workspaces/${ws.id}/leave`, "POST").then(() => { session.setWs(""); refresh(); });
  }, [ws, refresh]);

  if (state === "loading") return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  if (state === "signin") return <SignIn />;
  return (
    <WorkspaceCtx.Provider value={{ ws, guest: !!ws?.guest, list, user, switchTo, refresh, leave }}>
      {error && !ws && <p role="alert" className="m-4 text-sm text-danger">{error}</p>}
      <Fragment key={ws?.id ?? 0}>{children}</Fragment>
    </WorkspaceCtx.Provider>
  );
}

function SignIn() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="hero grid min-h-dvh place-items-center px-4">
      <div className="card rise w-full max-w-sm p-8 text-center">
        <Logo className="float mx-auto size-16" />
        <h1 className="mt-4 font-display text-3xl">Envoy</h1>
        <p className="mt-2 text-sm text-muted">Your AI workspace for Model UN and debate. Research, draft, rehearse and share with your team.</p>
        <button disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { await signIn(); } catch (e) { setErr(String((e as Error).message).replace("Firebase: ", "")); } setBusy(false); }} className="btn-primary mt-6 w-full py-2.5">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Continue with Google
        </button>
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        <p className="mt-4 text-xs text-muted">Free. Your workspaces sync across devices; teammates join with an access code.</p>
      </div>
    </main>
  );
}
