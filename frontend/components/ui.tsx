"use client";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-4xl leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** Sanitized Markdown. `[n]` citations become clickable chips when `onCite` is given. */
export function Markdown({ text, onCite, className = "" }: { text: string; onCite?: (n: number) => void; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const html = useMemo(() => {
    if (!mounted) return ""; // DOMPurify needs a DOM; never ship unsanitized SSR HTML
    let h = marked.parse(text || "", { async: false, gfm: true, breaks: false }) as string;
    h = h.replace(/\[citation needed\]/gi, '<mark class="cn">citation needed</mark>');
    if (onCite) // handles [1] and [1, 3]
      h = h.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?![(:])/g, (_, g: string) =>
        g.split(/\s*,\s*/).map((n) => `<button type="button" class="cite" data-cite="${n}">${n}</button>`).join(""));
    else h = h.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?![(:])/g, '<sup class="ref">$1</sup>');
    return DOMPurify.sanitize(h, { ADD_ATTR: ["data-cite"] });
  }, [text, onCite, mounted]);
  return (
    <div
      className={`prose-envoy ${className}`}
      onClick={(e) => {
        const n = (e.target as HTMLElement).closest<HTMLElement>("[data-cite]")?.dataset.cite;
        if (n && onCite) onCite(Number(n));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div role="alert" className="rise flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span>{msg}</span>
    </div>
  );
}

export function Thinking() {
  return (
    <span className="inline-flex items-center gap-1 text-muted" aria-label="Generating">
      {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />)}
    </span>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted">
      <Icon className="size-8 opacity-40" />
      <div className="font-medium text-fg">{title}</div>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export const toast = (msg: string) => window.dispatchEvent(new CustomEvent("envoy-toast", { detail: msg }));

export function Toaster() {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => { setMsg((e as CustomEvent<string>).detail); clearTimeout(t); t = setTimeout(() => setMsg(""), 2200); };
    window.addEventListener("envoy-toast", on);
    return () => window.removeEventListener("envoy-toast", on);
  }, []);
  if (!msg) return null;
  return (
    <div role="status" className="rise fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-lg">
      <Check className="size-4" /> {msg}
    </div>
  );
}

export async function copy(text: string, label = "Copied") {
  await navigator.clipboard.writeText(text);
  toast(label);
}
