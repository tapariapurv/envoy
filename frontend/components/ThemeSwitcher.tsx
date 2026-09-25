"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings } from "@/lib/settings";

const MODES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

/** Segmented System / Light / Dark control. `compact` renders a single button that cycles modes (mobile header). */
export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { s, set } = useSettings();
  // Midnight counts as a dark theme and Sepia as a light one, so the matching mode stays highlighted.
  const mode = s.theme === "midnight" ? "dark" : s.theme === "sepia" ? "light" : s.theme;

  if (compact) {
    const i = MODES.findIndex((m) => m.id === mode);
    const next = MODES[(i + 1) % MODES.length];
    const Icon = MODES[Math.max(i, 0)].icon;
    return (
      <button onClick={() => set({ theme: next.id })} className="btn-ghost p-2" aria-label={`Theme: ${MODES[Math.max(i, 0)].label}. Switch to ${next.label}`} title={`Switch to ${next.label}`}>
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Colour mode" className="grid grid-cols-3 gap-0.5 rounded-lg border border-line bg-subtle/70 p-0.5">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={mode === id}
          onClick={() => set({ theme: id })}
          title={label}
          className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${mode === id ? "bg-panel font-medium text-fg shadow-[var(--shadow)]" : "text-muted hover:text-fg"}`}
        >
          <Icon className="size-3.5" /> <span className="sr-only lg:not-sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
