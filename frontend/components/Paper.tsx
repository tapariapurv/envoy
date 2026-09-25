"use client";
import { Clock } from "lucide-react";
import { Markdown } from "./ui";
import { fmtTime, words } from "@/lib/api";

const KEYS = ["committee", "topic", "country", "delegation", "delegate", "school", "conference"];
const META = new RegExp(`^\\s*(?:[-*]\\s*)?\\**\\s*(${KEYS.join("|")})s?\\s*(?::\\**|\\**:)\\s*(.*?)\\s*$`, "i");

/** Mirrors backend docx_export.split_meta: leading "# Title" + "**Committee:** X" lines become the letterhead. */
export function splitMeta(md: string) {
  const lines = md.trim().split("\n");
  const meta: Record<string, string> = {};
  let title = "", i = 0;
  for (; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln || ln === "---") continue;
    if (ln.startsWith("# ") && !title && !Object.keys(meta).length) { title = ln.slice(2).replace(/\*/g, "").trim(); continue; }
    const m = ln.match(META);
    if (!m) break;
    const v = m[2].replace(/\*/g, "").trim();
    if (v) meta[m[1].toLowerCase() === "delegation" ? "country" : m[1].toLowerCase()] = v;
  }
  return { title, meta, body: lines.slice(i).join("\n") };
}

/** A position paper rendered like a printed brief: letterhead, numbered sections, pull-quote, proposal cards. */
export default function Paper({ text, wpm, profile }: { text: string; wpm: number; profile: { country: string; committee: string; topic: string } }) {
  const { title, meta, body } = splitMeta(text);
  const m: Record<string, string> = { country: profile.country, committee: profile.committee, topic: profile.topic, ...meta };
  const hasHead = Object.keys(meta).length > 0 || !!title;
  const n = words(body);

  return (
    <article data-paper className="paper mx-auto max-w-[68ch]">
      {hasHead && (
        <header className="paper-head">
          <div className="flex items-center justify-between gap-3">
            <span className="paper-label">{title && title.toLowerCase() !== "position paper" ? title : "Position Paper"}</span>
            <span className="paper-ui flex items-center gap-1 text-xs text-muted"><Clock className="size-3" /> {Math.max(1, Math.round(n / 230))} min read · {n} words</span>
          </div>
          <h1 className="paper-title">{m.country || title || "Position Paper"}</h1>
          <dl className="mt-4 flex flex-wrap gap-2">
            {(["committee", "topic", "delegate", "school", "conference"] as const).map((k) => m[k] && (
              <div key={k} className="paper-chip"><dt className="sr-only">{k}</dt><dd>{m[k]}</dd></div>
            ))}
          </dl>
        </header>
      )}
      <Markdown text={body.replace(/(\S) - /g, "$1 – ").replace(/(?<!-)--(?!-)/g, "—")} className="paper-body" />
      {n > 0 && <footer className="paper-ui mt-10 border-t border-line pt-3 text-center text-xs text-muted">≈ {fmtTime((n / wpm) * 60)} spoken at {wpm} wpm</footer>}
    </article>
  );
}
