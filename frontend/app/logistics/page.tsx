"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FlipHorizontal, Maximize2, Pause, Pencil, Play, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { api, download, fmtTime, type Draft } from "@/lib/api";
import { useSettings } from "@/lib/settings";

export default function Logistics() {
  const { s } = useSettings();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const [wpm, setWpm] = useState(150);
  const [font, setFont] = useState(44);
  const [mirror, setMirror] = useState(false);
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const pos = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { api<Draft[]>("/api/drafts").then(setDrafts).catch(() => {}); }, []);
  useEffect(() => { setWpm(s.wpm); setFont(s.prompter_font); setMirror(s.prompter_mirror); }, [s.wpm, s.prompter_font, s.prompter_mirror]);

  // Strip Markdown syntax so the prompter shows only spoken words.
  const words = useMemo(() => text.replace(/[#*_>`]|\[(\d+)\]/g, "").split(/\s+/).filter(Boolean), [text]);

  // Advance by elapsed time × wpm, so changing speed mid-speech takes effect immediately and never drifts.
  useEffect(() => {
    if (!running) return;
    let last = performance.now(), raf = 0;
    const frame = (t: number) => {
      pos.current += ((t - last) / 60000) * wpm;
      last = t;
      const i = Math.floor(pos.current);
      if (i >= words.length) { setIdx(words.length); setRunning(false); return; }
      setIdx(i);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, wpm, words.length]);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - scroller.current.clientHeight * 0.38, behavior: "smooth" });
  }, [idx]);

  const jump = (i: number) => { pos.current = i; setIdx(i); };
  const reset = () => { setRunning(false); jump(0); };
  const toggle = () => { if (idx >= words.length) jump(0); setEditing(false); setRunning((r) => !r); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      if (e.key === "ArrowUp") { e.preventDefault(); setWpm((w) => Math.min(250, w + 5)); }
      if (e.key === "ArrowDown") { e.preventDefault(); setWpm((w) => Math.max(60, w - 5)); }
      if (e.key.toLowerCase() === "r") reset();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const remaining = ((words.length - idx) / wpm) * 60;
  const pace = wpm < 130 ? "Measured" : wpm <= 160 ? "Conversational" : "Brisk";

  return (
    <>
      <PageHeader title="Logistics" sub="Rehearse at conference pace, then take your whole workspace offline." />

      <section className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <span className="px-2 font-medium">Paced Teleprompter</span>
          <select onChange={(e) => { const d = drafts.find((x) => x.id === Number(e.target.value)); if (d) { setText(d.content); reset(); setEditing(false); } e.target.value = ""; }} defaultValue="" className="input w-48" aria-label="Load draft">
            <option value="" disabled>Load a draft…</option>
            {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <button onClick={() => { setRunning(false); setEditing(!editing); }} className="btn-ghost"><Pencil className="size-4" /> {editing ? "Done" : "Edit text"}</button>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            <span className="w-24 tabular-nums">{wpm} wpm</span>
            <input type="range" min={60} max={250} step={5} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} className="w-28 accent-[var(--accent)]" aria-label="Words per minute" />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">Aa
            <input type="range" min={24} max={96} step={2} value={font} onChange={(e) => setFont(Number(e.target.value))} className="w-24 accent-[var(--accent)]" aria-label="Font size" />
          </label>
          <button data-on={mirror} onClick={() => setMirror(!mirror)} className="chip flex items-center gap-1" title="Mirror for beam-splitter glass"><FlipHorizontal className="size-3.5" /> Mirror</button>
          <button onClick={() => stage.current?.requestFullscreen()} className="btn-ghost" aria-label="Fullscreen"><Maximize2 className="size-4" /></button>
        </div>

        <div ref={stage} className="relative bg-panel">
          {editing ? (
            <textarea value={text} onChange={(e) => { setText(e.target.value); reset(); }} placeholder="Paste your speech here, or load a draft above." className="h-[55vh] w-full resize-none bg-transparent p-8 text-lg leading-relaxed outline-none" />
          ) : (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 h-[1.4em] border-y border-accent/30 bg-accent/5" style={{ fontSize: font }} />
              <div ref={scroller} className="relative h-[55vh] overflow-hidden px-[8%] py-[25vh] [:fullscreen_&]:h-dvh" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
                <p className="font-display leading-[1.4]" style={{ fontSize: font }}>
                  {words.map((w, i) => (
                    <span key={i} data-i={i} onClick={() => jump(i)} className={`cursor-pointer transition-colors duration-150 ${i < idx ? "text-muted/45" : i === idx ? "text-accent" : ""}`}>{w} </span>
                  ))}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
          <button onClick={toggle} disabled={!words.length} className="btn-primary w-28">{running ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> {idx ? "Resume" : "Start"}</>}</button>
          <button onClick={reset} className="btn-ghost"><RotateCcw className="size-4" /> Reset</button>
          <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${(idx / Math.max(words.length, 1)) * 100}%` }} /></div>
          <span className="text-sm tabular-nums text-muted">{Math.min(idx, words.length)}/{words.length} words · {fmtTime(remaining)} left · {pace}</span>
        </div>
      </section>
      <p className="-mt-4 mb-8 text-xs text-muted">Space start/pause · ↑/↓ adjust speed · R reset · click any word to jump there.</p>

      <section className="card flex flex-wrap items-center gap-4 p-5">
        <div className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent"><Download className="size-5" /></div>
        <div className="min-w-60 flex-1">
          <div className="font-medium">Offline Binder</div>
          <p className="text-sm text-muted">Compile tasks, drafts, every research document, the clause bank and procedure cards into one searchable HTML file. No internet, no app, no Wi-Fi needed at the venue — it also prints cleanly.</p>
        </div>
        <button onClick={() => download("/api/export")} className="btn-primary"><Download className="size-4" /> Export binder</button>
      </section>
    </>
  );
}
