"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { fmtTime } from "@/lib/api";

function beep(times = 2) {
  try {
    const ctx = new AudioContext();
    [0, 0.3].slice(0, times).forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.18, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.26);
    });
  } catch {}
}

const parse = (v: string) => {
  const [m, s] = v.includes(":") ? v.split(":") : ["0", v];
  const n = Number(m) * 60 + Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Drift-free timer: derives time from Date.now(), not from counting ticks. `seconds=0` makes a stopwatch.
 *  `poi` = [open, close] seconds of unprotected time: a single knock at each edge, as in parliamentary debate. */
export default function Timer({ label, seconds, warning = 10, sound = true, big = false, poi }: { label: string; seconds: number; warning?: number; sound?: boolean; big?: boolean; poi?: [number, number] }) {
  const stopwatch = seconds === 0;
  const [base, setBase] = useState(seconds);
  const [acc, setAcc] = useState(0);
  const [start, setStart] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [editing, setEditing] = useState(false);
  const rang = useRef(false);
  const knocked = useRef(0); // how many POI-window edges have sounded

  useEffect(() => { if (start === null) setBase(seconds); }, [seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (start === null) return;
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [start]);

  const elapsed = (acc + (start ? Date.now() - start : 0)) / 1000;
  const remaining = base - elapsed;
  const over = !stopwatch && remaining < 0;
  const warn = !stopwatch && !over && remaining <= warning;

  useEffect(() => {
    if (!stopwatch && remaining <= 0 && start && !rang.current) { rang.current = true; if (sound) beep(); }
    const edges = poi?.filter((t) => elapsed >= t).length ?? 0;
    if (start && edges > knocked.current) { knocked.current = edges; if (sound) beep(1); }
  });

  const toggle = () => (start ? (setAcc(acc + Date.now() - start), setStart(null)) : setStart(Date.now()));
  const reset = () => { setAcc(0); setStart(null); rang.current = false; knocked.current = 0; };
  const poiOpen = poi && elapsed >= poi[0] && elapsed < poi[1];
  const nudge = (d: number) => { setBase((b) => Math.max(5, b + d)); if (d > 0) rang.current = false; };

  const display = stopwatch ? fmtTime(Math.floor(elapsed)) : over ? `+${fmtTime(-remaining)}` : fmtTime(remaining);
  const pct = stopwatch ? 0 : Math.min(100, (elapsed / base) * 100);

  return (
    <div
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === " ") { e.preventDefault(); toggle(); }
        if (e.key.toLowerCase() === "r") reset();
      }}
      className={`card relative overflow-hidden p-4 transition ${over ? "border-danger/50" : warn ? "border-warn/50" : ""}`}
      aria-label={`${label} timer`}
    >
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {poi && (elapsed > 0 || start) && <span className={`chip ${poiOpen ? "text-ok" : ""}`}>{poiOpen ? "POIs open" : "Protected"}</span>}
        {!stopwatch && <span className="text-xs text-muted">of {fmtTime(base)}</span>}
      </div>
      {editing ? (
        <input
          autoFocus
          defaultValue={fmtTime(base)}
          className="input my-2 font-mono text-3xl"
          onBlur={(e) => { const n = parse(e.target.value); if (n) { setBase(n); reset(); } setEditing(false); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Set duration (m:ss)"
        />
      ) : (
        <button
          onClick={() => !stopwatch && !start && setEditing(true)}
          title={stopwatch ? undefined : "Click to set duration while paused"}
          className={`my-1 block font-mono font-semibold tabular-nums tracking-tight transition-colors ${big ? "text-6xl" : "text-5xl"} ${over ? "text-danger" : warn ? "text-warn" : ""} ${start ? "" : "opacity-80"}`}
        >
          {display}
        </button>
      )}
      <div className="flex items-center gap-1">
        <button onClick={toggle} className="btn-primary" aria-label={start ? "Pause" : "Start"}>
          {start ? <Pause className="size-4" /> : <Play className="size-4" />} {start ? "Pause" : elapsed ? "Resume" : "Start"}
        </button>
        <button onClick={reset} className="btn-ghost" aria-label="Reset"><RotateCcw className="size-4" /></button>
        {!stopwatch && (
          <span className="ml-auto flex">
            <button onClick={() => nudge(-15)} className="btn-ghost px-2" aria-label="Minus 15 seconds"><Minus className="size-3.5" />15</button>
            <button onClick={() => nudge(15)} className="btn-ghost px-2" aria-label="Plus 15 seconds"><Plus className="size-3.5" />15</button>
          </span>
        )}
      </div>
      {!stopwatch && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-subtle">
          <div className={`h-full transition-[width] duration-100 ${over ? "bg-danger" : warn ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
