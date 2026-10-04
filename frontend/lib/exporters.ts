"use client";
/** Browser-side file work: document text extraction, the offline binder and position paper -> Word. */
import DOMPurify from "dompurify";
import { marked, type Token, type Tokens } from "marked";
import { splitMeta } from "@/components/Paper";

const MAX_UPLOAD = 50 * 1024 * 1024;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Sanitized: teammates write this content, and the binder is opened as a local file.
const md = (s: string) => DOMPurify.sanitize(marked.parse(s || "", { async: false }) as string);

// ---------- upload parsing ----------
export async function parseFile(f: File): Promise<string> {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (f.size > MAX_UPLOAD) throw new Error("Larger than 50 MB");
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const items = (await (await pdf.getPage(i)).getTextContent()).items as { str: string; hasEOL?: boolean }[];
      pages.push(items.map((x) => x.str + (x.hasEOL ? "\n" : "")).join("").replace(/\n{2,}/g, "\n\n"));
    }
    return pages.join("\n\n");
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
  }
  if (ext === "html" || ext === "htm") {
    const d = new DOMParser().parseFromString(await f.text(), "text/html");
    return [...d.querySelectorAll("h1,h2,h3,h4,p,li,td,pre,blockquote")].map((e) => e.textContent?.trim()).filter(Boolean).join("\n\n");
  }
  if (["txt", "md", "csv", "json"].includes(ext)) return f.text();
  throw new Error("Unsupported type. Use PDF, Word (.docx), HTML, TXT, Markdown, CSV or JSON");
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- offline binder ----------
const CSS = `:root{--bg:#fbfaf8;--fg:#1c1b1a;--mut:#6b6862;--line:#e7e4df;--card:#fff;--acc:#4f46e5}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ecebe8;--mut:#9b988f;--line:#2a2927;--card:#1a1a19;--acc:#818cf8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Inter",sans-serif}
nav{position:fixed;inset:0 auto 0 0;width:240px;padding:28px 20px;border-right:1px solid var(--line);overflow:auto}
nav a{display:block;color:var(--mut);text-decoration:none;padding:4px 0;font-size:13px}nav a:hover{color:var(--acc)}
nav input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);margin-bottom:16px}
main{margin-left:240px;max-width:880px;padding:40px 48px}
h1{font:600 30px/1.2 Georgia,serif;margin:0 0 4px}h2{font:600 22px Georgia,serif;margin:48px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.mut{color:var(--mut);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:12px 0}
details summary{cursor:pointer;font-weight:600}table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}
.pill{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mut);margin-right:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px}.hide{display:none}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}.stat{flex:1;min-width:110px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.stat b{display:block;font:600 22px Georgia,serif}.stat span{color:var(--mut);font-size:12px}
@media print{nav,#q{display:none}main{margin:0;padding:0;max-width:none}section{break-before:page}h2{margin-top:0}.card{break-inside:avoid}}
@media(max-width:800px){nav{position:static;width:auto;border:0}main{margin:0;padding:16px}}`;
type R = Record<string, string | number>;

export function binder(s: R, tasks: R[], drafts: R[], docs: R[], clauses: R[], cards: R[]) {
  const status: R = { todo: "To do", doing: "In progress", done: "Done" };
  const none = "<p class=mut>None</p>";
  const sec: [string, string, string][] = [
    ["tasks", "Tasks", tasks.map((t) => `<div class="card f"><span class="pill">${status[t.status]}</span><span class="pill">${esc(t.priority)}</span><b>${esc(t.title)}</b>${t.notes ? `<div>${md(String(t.notes))}</div>` : ""}</div>`).join("") || none],
    ["drafts", "Drafts & Position Papers", drafts.map((d) => `<div class="card f"><h3>${esc(d.title)}</h3><p class=mut>Updated ${esc(String(d.updated).slice(0, 16).replace("T", " "))}</p>${md(String(d.content))}</div>`).join("") || none],
    ["research", "Research Vault", docs.map((d) => `<details class="card f"><summary>${esc(d.name)}</summary>${md(String(d.markdown))}</details>`).join("") || none],
  ];
  for (const kind of ["preambulatory", "operative", "custom"]) {
    const items = clauses.filter((c) => c.kind === kind);
    if (items.length) sec.push([kind, `${kind[0].toUpperCase()}${kind.slice(1)} Clauses`, `<div class="grid">${items.map((c) => `<div class="card f" style="margin:0;padding:8px 12px"><i>${esc(c.phrase)}</i>${c.example ? `<div class=mut>${esc(c.example)}</div>` : ""}</div>`).join("")}</div>`]);
  }
  sec.push(["rules", "Rules of Procedure", cards.map((c) => `<details class="card f"><summary>${esc(c.front)}</summary><p>${esc(c.back)}</p></details>`).join("")]);
  const profile = [s.delegate_country, s.committee, s.topic].filter(Boolean).map(esc).join(" · ") || "Model UN Binder";
  const stats = ([[tasks.filter((t) => t.status !== "done").length, "open tasks"], [drafts.length, "drafts"], [docs.length, "research documents"], [clauses.length, "clauses"], [cards.length, "procedure cards"]] as const)
    .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Envoy Binder</title><style>${CSS}</style></head><body>
<nav><b>Envoy Binder</b><p class=mut>${profile}</p><input id=q placeholder="Search binder…" aria-label="Search binder">${sec.map(([i, t]) => `<a href="#${i}">${t}</a>`).join("")}</nav>
<main><h1>${profile}</h1><p class=mut>Compiled ${new Date().toLocaleString()} · works fully offline</p><div class="stats">${stats}</div>${sec.map(([i, t, h]) => `<section id="${i}"><h2>${t}</h2>${h}</section>`).join("")}</main>
<script>document.getElementById('q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();
document.querySelectorAll('.f').forEach(n=>{const m=!q||n.textContent.toLowerCase().includes(q);n.classList.toggle('hide',!m);if(q&&m&&n.tagName==='DETAILS')n.open=true})})</script></body></html>`;
}

// ---------- position paper -> Word ----------
const SERIF = "Georgia", SANS = "Helvetica Neue"; // same fonts as the preview (.paper in globals.css)
const C = { ink: "1D1C1A", muted: "75716A", accent: "4F46E5", tint: "F1F0FD", badge: "E4E3FB", mark: "E0DEFB", card: "EFEDE8", line: "E4E1DA", warn: "C2410C", warnBg: "FBE9DC" };
const cm = (n: number) => Math.round(n * 567);

/** "envoy" mirrors the in-app preview; "conference" is plain Times New Roman 12. Both use real Word styles. */
export async function buildDocx(markdown: string, profile: { delegate_country: string; committee: string; topic: string }, style = "envoy", fallbackTitle = "Position Paper") {
  const d = await import("docx");
  const rich = style !== "conference";
  const st = rich ? { body: SERIF, head: SERIF, label: SANS, size: 11 } : { body: "Times New Roman", head: "Times New Roman", label: "Times New Roman", size: 12 };
  const { title, meta: m, body } = splitMeta(markdown);
  const meta: Record<string, string> = { country: profile.delegate_country, committee: profile.committee, topic: profile.topic, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)) };
  const shade = (fill: string) => ({ type: d.ShadingType.CLEAR, color: "auto", fill });
  const none = { style: d.BorderStyle.NONE, size: 0, color: "auto" };
  const noBorders = { top: none, bottom: none, left: none, right: none };
  type Fmt = { b?: boolean; i?: boolean; code?: boolean; a?: boolean; card?: boolean; quote?: boolean; normal?: boolean };

  const runs = (tokens: Token[] = [], f: Fmt = {}): InstanceType<typeof d.TextRun>[] => tokens.flatMap((t) => {
    const tk = t as Tokens.Generic;
    if (t.type === "strong") return runs(tk.tokens, { ...f, b: true });
    if (t.type === "em") return runs(tk.tokens, { ...f, i: true });
    if (t.type === "link") return runs(tk.tokens, { ...f, a: true });
    if (t.type === "codespan") return [new d.TextRun({ text: tk.text, font: "Menlo", size: (st.size - 1.5) * 2 })];
    if (t.type === "br") return [new d.TextRun({ break: 1 })];
    if (tk.tokens?.length && t.type === "text") return runs(tk.tokens, f);
    const text = String(tk.text ?? tk.raw ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/(\S) - /g, "$1 – ").replace(/(?<!-)--(?!-)/g, "—"); // typographic dashes
    return text.split(/(\[citation needed\]|\[\d{1,2}(?:,\s*\d{1,2})*\])/i).filter(Boolean).map((part) => {
      if (part.toLowerCase() === "[citation needed]")
        return new d.TextRun({ text: " citation needed ", font: rich ? SANS : st.body, size: 16, color: C.warn, italics: true, shading: rich ? shade(C.warnBg) : undefined });
      if (/^\[[\d,\s]+\]$/.test(part))
        return new d.TextRun({ text: rich ? part.slice(1, -1) : part, superScript: true, color: rich ? C.accent : C.muted, bold: rich || undefined });
      return new d.TextRun({
        text: part, bold: f.b || undefined, italics: f.i || f.quote || undefined,
        ...(f.quote ? { font: SERIF, size: 28, color: C.ink } : {}),
        ...(f.b && rich && f.card ? { color: C.accent } : f.b && rich && f.normal && !f.quote ? { shading: shade(C.mark) } : {}),
        ...(f.a ? { color: C.accent, underline: {} } : {}),
      });
    });
  });

  const cellOpts = (fill: string | null, border: string | null, mar: [number, number, number, number]) => ({
    shading: fill ? shade(fill) : undefined,
    borders: border ? { top: { style: d.BorderStyle.SINGLE, size: 4, color: border }, bottom: { style: d.BorderStyle.SINGLE, size: 4, color: border }, left: { style: d.BorderStyle.SINGLE, size: 4, color: border }, right: { style: d.BorderStyle.SINGLE, size: 4, color: border } } : noBorders,
    margins: { top: mar[0], left: mar[1], bottom: mar[2], right: mar[3] },
  });
  const boxTable = (cells: InstanceType<typeof d.TableCell>[], widths: number[]) => new d.Table({
    rows: [new d.TableRow({ children: cells })], columnWidths: widths.map(cm), layout: d.TableLayoutType.FIXED,
    width: { size: cm(widths.reduce((a, b) => a + b)), type: d.WidthType.DXA }, borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
  });
  const gap = () => new d.Paragraph({ spacing: { after: 0, line: 140 } });

  let sec = 0, cardN = 0;
  const blocks = (tokens: Token[], f: Fmt = {}, depth = 0): (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] => tokens.flatMap((t) => {
    const tk = t as Tokens.Generic;
    if (t.type === "heading") {
      if (tk.depth <= 2) {
        sec++;
        const badge = rich ? [new d.TextRun({ text: ` ${String(sec).padStart(2, "0")} `, font: SANS, size: 16, color: C.accent, bold: true, shading: shade(C.badge) }), new d.TextRun("  ")] : [];
        return [new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [...badge, ...runs(tk.tokens)] })];
      }
      return [new d.Paragraph({ heading: tk.depth === 3 ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3, children: runs(tk.tokens) })];
    }
    if (t.type === "paragraph") return [new d.Paragraph({ children: runs(tk.tokens, { ...f, normal: !f.card && !f.quote }), spacing: f.card || f.quote ? { after: 0, line: f.quote ? 300 : undefined } : undefined })];
    if (t.type === "text") return [new d.Paragraph({ children: runs(tk.tokens ?? [t], f), spacing: f.card ? { after: 0 } : undefined })];
    if (t.type === "list") {
      const list = t as Tokens.List;
      return list.items.flatMap((it) => {
        if (rich && list.ordered && depth === 0) { // top-level numbered list -> proposal cards
          cardN++;
          return [boxTable([
            new d.TableCell({ ...cellOpts(null, null, [150, 0, 0, 0]), width: { size: cm(0.9), type: d.WidthType.DXA }, verticalAlign: d.VerticalAlign.TOP,
              children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: ` ${cardN} `, font: SANS, size: 18, color: "FFFFFF", bold: true, shading: shade(C.accent) })] })] }),
            new d.TableCell({ ...cellOpts(C.card, C.line, [140, 200, 140, 200]), width: { size: cm(15.1), type: d.WidthType.DXA }, children: blocks(it.tokens, { ...f, card: true }, depth + 1) }),
          ], [0.9, 15.1]), gap()];
        }
        const [first, ...rest] = blocks(it.tokens, f, depth + 1);
        const lead = first instanceof d.Paragraph ? new d.Paragraph({
          children: runs((it.tokens[0] as Tokens.Generic)?.tokens ?? [], f), spacing: { after: 80 },
          ...(list.ordered ? { numbering: { reference: "num", level: Math.min(depth, 1) } } : { bullet: { level: Math.min(depth, 1) } }),
        }) : first;
        return [lead, ...rest];
      });
    }
    if (t.type === "blockquote") {
      const inner = ((tk.tokens ?? []) as Tokens.Generic[]).flatMap((p) => p.tokens ?? []);
      if (!rich) return [new d.Paragraph({ indent: { left: cm(1) }, children: runs(inner, { i: true }) })];
      return [boxTable([new d.TableCell({ ...cellOpts(C.tint, null, [200, 320, 200, 320]), width: { size: cm(16), type: d.WidthType.DXA },
        children: [new d.Paragraph({ spacing: { after: 0, line: 300 }, children: [new d.TextRun({ text: "“ ", font: SERIF, size: 52, color: C.accent }), ...runs(inner, { quote: true })] })] })], [16]), gap()];
    }
    if (t.type === "table") {
      const tb = t as Tokens.Table;
      const row = (cells: Tokens.TableCell[], head: boolean) => new d.TableRow({ children: cells.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: runs(c.tokens, { b: head }) })] })) });
      return [new d.Table({ rows: [row(tb.header, true), ...tb.rows.map((r) => row(r, false))], width: { size: 100, type: d.WidthType.PERCENTAGE } }), new d.Paragraph({})];
    }
    if (t.type === "hr") return [new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: C.line, space: 4 } } })];
    if (t.type === "code") return [new d.Paragraph({ children: [new d.TextRun({ text: tk.text, font: "Menlo", size: (st.size - 1.5) * 2 })] })];
    return [];
  });

  const label = (title && title.toLowerCase() !== "position paper" ? title : "Position Paper").toUpperCase();
  const fields = ["Committee", "Topic", "Delegate", "School", "Conference"].map((k) => [k, meta[k.toLowerCase()]] as const).filter(([, v]) => v);
  const info = rich
    ? fields.flatMap(([, v]) => [new d.TextRun({ text: `  ${v}  `, font: SANS, size: 17, color: C.ink, shading: shade(C.card) }), new d.TextRun(" ")])
    : fields.flatMap(([k, v], i) => [new d.TextRun({ text: `${k}: `, bold: true, break: i ? 1 : 0 }), new d.TextRun(v!)]);
  const heading = (id: string, name: string, size: number, o: { bold?: boolean; italics?: boolean; color?: string; before?: number; after?: number }) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
    run: { font: st.head, size: size * 2, bold: !!o.bold, italics: !!o.italics, color: o.color ?? C.ink },
    paragraph: { spacing: { before: (o.before ?? 0) * 20, after: (o.after ?? 6) * 20, line: 264 }, keepNext: true },
  });
  const base = st.size;

  const doc = new d.Document({
    title: title || fallbackTitle, subject: meta.topic ?? "", creator: meta.delegate || meta.country || "Envoy", description: "Created with Envoy",
    styles: {
      default: { document: { run: { font: st.body, size: base * 2, color: C.ink }, paragraph: { spacing: { after: 180, line: rich ? 312 : 276 }, alignment: rich ? undefined : d.AlignmentType.JUSTIFIED } } },
      paragraphStyles: [
        heading("Title", "Title", rich ? 30 : base + 12, { bold: !rich, after: 8 }),
        heading("Heading1", "Heading 1", rich ? 17 : base + 2, { bold: !rich, before: 18, after: 8 }),
        heading("Heading2", "Heading 2", rich ? 13 : base, { bold: true, before: 12, after: 4 }),
        heading("Heading3", "Heading 3", base, { bold: true, italics: true, color: C.muted, before: 8, after: 3 }),
      ],
    },
    numbering: { config: [{ reference: "num", levels: [0, 1].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    sections: [{
      properties: { page: { margin: { top: cm(2.2), bottom: cm(2.2), left: cm(2.4), right: cm(2.4) } } },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], font: rich ? SANS : st.body, size: 17, color: C.muted })] })] }) },
      children: [
        new d.Paragraph({ spacing: { after: 80 }, children: [new d.TextRun({ text: label, font: st.label, size: rich ? 16 : 20, color: rich ? C.accent : C.ink, bold: true })] }),
        new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(meta.country || title || fallbackTitle)] }),
        new d.Paragraph({ children: info, spacing: { after: 320, line: 384 }, border: { bottom: { style: d.BorderStyle.SINGLE, size: rich ? 18 : 8, color: rich ? C.accent : C.ink, space: 10 } } }),
        ...blocks(marked.lexer(body)),
      ],
    }],
  });
  return d.Packer.toBlob(doc);
}
