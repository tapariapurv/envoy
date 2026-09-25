"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, Library, LayoutGrid, MonitorPlay, PenLine, ScrollText, Settings2, Swords } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import Logo from "./Logo";
import ThemeSwitcher from "./ThemeSwitcher";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { useWorkspace } from "@/lib/workspace";

const NAV = [
  { href: "/", label: "War Room", icon: LayoutGrid },
  { href: "/research", label: "Research Hub", icon: Library },
  { href: "/drafting", label: "Drafting Studio", icon: PenLine },
  { href: "/opponent", label: "Opponent Sim", icon: Swords },
  { href: "/procedure", label: "Procedural Prep", icon: ScrollText },
  { href: "/logistics", label: "Logistics", icon: MonitorPlay },
];

type Health = { ollama: boolean; model: string } | null;

export default function Sidebar() {
  const path = usePathname();
  const { s } = useSettings();
  const { ws } = useWorkspace();
  const [health, setHealth] = useState<Health | "down">(null);

  useEffect(() => {
    const check = () => api<Health>("/api/health").then(setHealth).catch(() => setHealth("down"));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [s.llm_model, s.llm_api_base]);

  const local = s.llm_model.startsWith("ollama");
  const ok = health !== "down" && health !== null && (health.ollama || !local);
  const label = health === "down" ? "Backend offline" : !health ? "Connecting…" : local && !health.ollama ? "Ollama not running" : s.llm_model.replace(/^ollama(_chat)?\//, "");

  const item = (href: string, active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition whitespace-nowrap ${active ? "bg-panel text-fg font-medium shadow-[var(--shadow)] border border-line" : "text-muted hover:text-fg hover:bg-subtle border border-transparent"}`;

  return (
    <aside className="sticky top-0 z-20 flex shrink-0 flex-col gap-4 border-b border-line bg-bg/85 px-3 py-3 backdrop-blur md:h-dvh md:w-60 md:border-b-0 md:border-r md:px-4 md:py-6">
      <div className="flex items-center gap-2 px-2">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Envoy home">
          <Logo className="size-8 shrink-0" />
          <span className="font-display text-2xl leading-none">Envoy</span>
        </Link>
        {ws && <span className="ml-auto truncate text-xs text-muted md:hidden">{ws.name}</span>}
        <span className={`md:hidden ${ws ? "" : "ml-auto"}`}><ThemeSwitcher compact /></span>
      </div>

      <div className="hidden md:block"><WorkspaceSwitcher /></div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={item(href, href === "/" ? path === "/" : path.startsWith(href))}>
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
          <span className={`size-2 rounded-full ${ok ? "bg-ok" : health === null ? "bg-muted" : "bg-danger"}`} />
          <span className="truncate">{label}</span>
          <span className="ml-auto rounded bg-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{local ? "Local" : "Cloud"}</span>
        </Link>
      </div>
    </aside>
  );
}
