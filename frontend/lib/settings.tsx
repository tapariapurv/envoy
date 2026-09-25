"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, apiFetch } from "./api";

// Mirrors backend DEFAULT_SETTINGS so the UI works before the first fetch / when offline.
export const DEFAULTS = {
  delegate_country: "", committee: "", topic: "",
  theme: "system", accent: "indigo", font_scale: 1,
  timer_speaker: 60, timer_mod_total: 600, timer_mod_speaker: 45, timer_unmod: 900, timer_warning: 10, timer_sound: true,
  wpm: 150, prompter_font: 44, prompter_mirror: false,
  llm_provider: "ollama", llm_model: "ollama/llama3.2", llm_api_base: "http://localhost:11434", llm_api_key: "",
  llm_temperature: 0.4, llm_max_tokens: 1500,
  embed_model: "ollama/nomic-embed-text", embed_api_base: "http://localhost:11434",
  rag_chunk_size: 1200, rag_chunk_overlap: 200, rag_top_k: 6,
  web_search_provider: "duckduckgo", web_search_key: "", trusted_use_default: true, trusted_custom: "",
};
export type Settings = typeof DEFAULTS;

type Ctx = { s: Settings; set: (p: Partial<Settings>) => void; replace: (s: Settings) => void; status: "idle" | "saving" | "saved" | "error"; offline: boolean };
const SettingsCtx = createContext<Ctx>({ s: DEFAULTS, set: () => {}, replace: () => {}, status: "idle", offline: false });
export const useSettings = () => useContext(SettingsCtx);

export function applyTheme(s: Pick<Settings, "theme" | "accent" | "font_scale">) {
  const el = document.documentElement;
  const theme = s.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : s.theme;
  el.dataset.theme = theme;
  el.dataset.dark = String(theme === "dark" || theme === "midnight");
  el.dataset.accent = s.accent;
  el.style.fontSize = `${16 * Number(s.font_scale || 1)}px`;
  try { localStorage.setItem("envoy-theme", JSON.stringify({ theme: s.theme, accent: s.accent, font_scale: s.font_scale })); } catch {}
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [status, setStatus] = useState<Ctx["status"]>("idle");
  const [offline, setOffline] = useState(false);
  const pending = useRef<Partial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api<Settings>("/api/settings").then((r) => setS({ ...DEFAULTS, ...r })).catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    applyTheme(s);
    if (s.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(s);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [s]);

  const set = useCallback((p: Partial<Settings>) => {
    setS((cur) => ({ ...cur, ...p }));
    pending.current = { ...pending.current, ...p };
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const body = pending.current;
      pending.current = {};
      try {
        const saved = await api<Settings>("/api/settings", "PUT", body);
        setS((cur) => ({ ...cur, llm_api_key: saved.llm_api_key, web_search_key: saved.web_search_key }));
        setStatus("saved");
        setOffline(false);
      } catch {
        setStatus("error");
      }
    }, 450);
  }, []);

  // Don't lose a debounced save when the tab closes or reloads.
  useEffect(() => {
    const flush = () => {
      if (!Object.keys(pending.current).length) return;
      apiFetch("/api/settings", { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      pending.current = {};
    };
    addEventListener("pagehide", flush);
    return () => removeEventListener("pagehide", flush);
  }, []);

  const replace = useCallback((next: Settings) => setS({ ...DEFAULTS, ...next }), []);

  return <SettingsCtx.Provider value={{ s, set, replace, status, offline }}>{children}</SettingsCtx.Provider>;
}
