"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, Hourglass, Library, LayoutGrid, ListTree, MonitorPlay, PenLine, ScrollText, Settings2, Swords, Timer, Trophy } from "lucide-react";
import { isLocal } from "@/lib/ai";
import { useSettings } from "@/lib/settings";
import Logo from "./Logo";
import ThemeSwitcher from "./ThemeSwitcher";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { useWorkspace } from "@/lib/workspace";

const NAV = {
  mun: [
    { href: "/", label: "War Room", icon: LayoutGrid },
    { href: "/research", label: "Research Hub", icon: Library },
    { href: "/drafting", label: "Drafting Studio", icon: PenLine },
    { href: "/opponent", label: "Opponent Sim", icon: Swords },
    { href: "/procedure", label: "Procedural Prep", icon: ScrollText },
    { href: "/logistics", label: "Logistics", icon: MonitorPlay },
  ],
  debate: [
    { href: "/debate", label: "Round Log", icon: Trophy },
    { href: "/research", label: "Research Hub", icon: Library },
    { href: "/debate/prep", label: "Prep Room", icon: Hourglass },
    { href: "/drafting", label: "Case Builder", icon: PenLine },
    { href: "/debate/flow", label: "Flow", icon: ListTree },
    { href: "/debate/spar", label: "Sparring", icon: Swords },
    { href: "/debate/timer", label: "Timer & Drills", icon: Timer },
  ],
};
export const HOME = { mun: "/", debate: "/debate" };
const SHARED = ["/research", "/drafting", "/workspaces", "/settings"];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { s } = useSettings();
  const { ws, list, switchTo } = useWorkspace();
  const kind = ws?.kind ?? "mun";

  // Each mode has its own pages; landing on the other mode's page (e.g. after switching workspace) goes home.
  useEffect(() => {
    if (!ws || SHARED.some((p) => path.startsWith(p))) return;
    if ((kind === "debate") !== path.startsWith("/debate")) router.replace(HOME[kind]);
  }, [ws, kind, path, router]);

  const setMode = (k: "mun" | "debate") => {
    if (k === kind) return;
    const target = list.find((w) => w.kind === k); // list is newest first
    if (target) { switchTo(target.id); router.push(HOME[k]); } else router.push(`/workspaces?new=1&kind=${k}`);
  };
  // Local engines are checked from the browser; cloud providers just need a key.
  const local = isLocal(s);
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!local) return setUp(!!s.llm_api_key);
    const check = () => fetch(`${s.llm_api_base.replace(/\/v1\/?$/, "").replace(/\/+$/, "")}${s.llm_provider === "ollama" ? "/api/tags" : "/models"}`).then((r) => setUp(r.ok)).catch(() => setUp(false));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [local, s.llm_api_base, s.llm_provider, s.llm_api_key]);
  const ok = !!up;
  const label = up === null ? "Connecting…" : !up ? (local ? "Local model not reachable" : "Add an API key") : s.llm_model.replace(/^[^/]+\//, "");
  const health = up;

  const item = (href: string, active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition whitespace-nowrap ${active ? "bg-panel text-fg font-medium shadow-[var(--shadow)] border border-line" : "text-muted hover:text-fg hover:bg-subtle border border-transparent"}`;

  return (
    <aside className="sticky top-0 z-20 flex shrink-0 flex-col gap-4 border-b border-line bg-bg/85 px-3 py-3 backdrop-blur md:h-dvh md:w-60 md:border-b-0 md:border-r md:px-4 md:py-6">
      <div className="flex items-center gap-2 px-2">
        <Link href={HOME[kind]} className="flex min-w-0 items-center gap-2.5" aria-label="Envoy home">
          <Logo className="size-8 shrink-0" />
          <span className="font-display text-2xl leading-none">Envoy</span>
        </Link>
        {ws && <span className="ml-auto truncate text-xs text-muted md:hidden">{ws.name}</span>}
        <span className={`md:hidden ${ws ? "" : "ml-auto"}`}><ThemeSwitcher compact /></span>
      </div>

      {(
        <div className="flex gap-1 rounded-xl bg-subtle p-1 md:mx-2" role="tablist" aria-label="Mode">
          {([["mun", "MUN"], ["debate", "Debate"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setMode(k)}
              className={`flex-1 rounded-lg py-1.5 text-sm transition ${kind === k ? "bg-panel font-medium shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      )}

      <div className="hidden md:block"><WorkspaceSwitcher /></div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {NAV[kind].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={item(href, href === HOME[kind] ? path === href : path.startsWith(href))}>
            <Icon className="size-4 shrink-0" /> <span>{label}</span>
          </Link>
        ))}
        <Link href="/workspaces" className={`${item("/workspaces", path.startsWith("/workspaces"))} md:hidden`}>
          <Briefcase className="size-4" /> <span>Workspaces</span>
        </Link>
        <Link href="/settings" className={`${item("/settings", path.startsWith("/settings"))} md:hidden`}>
          <Settings2 className="size-4" /> <span>Settings</span>
        </Link>
      </nav>

      <div className="mt-auto hidden flex-col gap-1 md:flex">
        <div className="mb-2 px-1"><ThemeSwitcher /></div>
        <Link href="/settings" className={item("/settings", path.startsWith("/settings"))}>
          <Settings2 className="size-4" /> Settings
        </Link>
        <Link href="/settings#ai" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-subtle" title="AI engine status">
          <span className={`size-2 rounded-full ${ok ? "bg-ok" : health === null ? "bg-muted" : "bg-danger"} ${ok ? "pulse" : ""}`} />
          <span className="truncate">{label}</span>
          <span className="ml-auto rounded bg-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{local ? "Local" : "Cloud"}</span>
        </Link>
      </div>
    </aside>
  );
}
