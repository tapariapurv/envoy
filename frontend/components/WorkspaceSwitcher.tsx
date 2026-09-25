"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Check, ChevronsUpDown, LogOut, Plus, Settings2, Users } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

export default function WorkspaceSwitcher() {
  const { ws, guest, list, switchTo, leave } = useWorkspace();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false; };
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, []);
  if (!ws) return null;

  const sub = [ws.delegate_country, ws.committee].filter(Boolean).join(" · ") || ws.conference || "Set up your delegation";
  const pick = (id: number) => { if (menu.current) menu.current.open = false; switchTo(id); };

  return (
    <details ref={menu} className="group relative mx-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-panel p-2.5 transition hover:border-muted/50">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/12 text-sm font-semibold text-accent">{ws.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{ws.name}</span>
          <span className="block truncate text-xs text-muted">{guest ? "Shared with you" : sub}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
      </summary>
      <div className="card rise absolute inset-x-0 z-40 mt-1.5 p-1.5">
        {guest ? (
          <button onClick={leave} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-danger hover:bg-subtle"><LogOut className="size-4" /> Leave workspace</button>
        ) : (
          <>
            <div className="label px-2.5 pb-1 pt-1.5">Workspaces</div>
            <div className="max-h-64 overflow-auto">
              {list.map((w) => (
                <button key={w.id} onClick={() => pick(w.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-subtle">
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {!!w.share_on && <Users className="size-3.5 text-muted" aria-label="Shared" />}
                  {w.id === ws.id && <Check className="size-4 text-accent" />}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-line" />
            <Link href="/workspaces?new=1" onClick={() => menu.current?.removeAttribute("open")} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-subtle"><Plus className="size-4" /> New workspace</Link>
            <Link href="/workspaces" onClick={() => menu.current?.removeAttribute("open")} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-subtle"><Settings2 className="size-4" /> Manage & share</Link>
          </>
        )}
      </div>
    </details>
  );
}
