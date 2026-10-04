/**
 * Web Research, server half: search -> read trusted pages -> rank passages. Streams NDJSON
 * ({step, detail} … then {sources}). The browser plans the queries and writes the report with the user's model.
 */
import { parse } from "node-html-parser";
import TRUSTED from "@/lib/trusted.json";

export const maxDuration = 60;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const DEPTH: Record<string, [number, number]> = { quick: [8, 10], standard: [14, 18], deep: [24, 28] }; // pages read, passages
const MAX_BYTES = 4_000_000, MAX_CHARS = 60_000, PER_DOMAIN = 2;
const GROUPS = [
  ["reuters.com", "apnews.com", "bbc.co.uk", "theguardian.com", "aljazeera.com", "economist.com", "ft.com"],
  ["un.org", "int", "gov", "worldbank.org", "oecd.org", "imf.org", "europa.eu"],
  ["brookings.edu", "cfr.org", "chathamhouse.org", "csis.org", "rand.org", "crisisgroup.org", "carnegieendowment.org"],
  ["edu", "ac.uk", "nature.com", "ncbi.nlm.nih.gov", "theconversation.com", "ourworldindata.org", "pewresearch.org"],
];
type Hit = { url: string; title: string; snippet: string };
type Body = { text: string; mode: string; depth: string; queries: string[]; country?: string; provider?: string; brave_key?: string; serper_key?: string; use_default?: boolean; custom?: string };

const norm = (e: string) => e.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split("/")[0].split("#")[0].trim().replace(/^www\./, "").replace(/^\.+|\.+$/g, "");
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const clean = (h: string) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function rules(b: Body) {
  const allow = new Set<string>(b.use_default === false ? [] : TRUSTED), block = new Set<string>(), mine: string[] = [];
  for (const raw of (b.custom ?? "").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    if (l.startsWith("-")) block.add(norm(l.slice(1))); else if (norm(l)) { allow.add(norm(l)); mine.push(norm(l)); }
  }
  block.forEach((d) => allow.delete(d));
  return { allow, block, mine };
}
function trusted(url: string, allow: Set<string>, block: Set<string>) {
  const h = host(url);
  if (!h.includes(".") || /^[\d.]+$|^\[|:/.test(h) || !url.startsWith("http")) return false; // never IPs or internal hosts
  const parts = h.split(".");
  const cands = parts.map((_, i) => parts.slice(i).join("."));
  return !!parts[0] && cands.some((c) => allow.has(c)) && !cands.some((c) => block.has(c));
}

// ---------- search ----------
async function ddg(q: string): Promise<Hit[]> {
  const r = await fetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ q, kl: "wt-wt" }) });
  if (r.status !== 200) throw new Error(`DuckDuckGo returned ${r.status} (rate limited?). Try again shortly or add a Brave or Serper key in Settings.`);
  return parse(await r.text()).querySelectorAll("div.result").filter((d) => !d.classList.contains("result--ad")).flatMap((d) => {
    const a = d.querySelector("a.result__a"), href = a?.getAttribute("href") ?? "";
    let url = href; try { url = new URL(href, "https://duckduckgo.com").searchParams.get("uddg") ?? href; } catch {}
    return a && url.startsWith("http") ? [{ url, title: a.text.trim(), snippet: d.querySelector(".result__snippet")?.text.trim() ?? "" }] : [];
  });
}
async function brave(q: string, key: string): Promise<Hit[]> {
  let r: Response | null = null;
  for (let i = 0; i < 3; i++) {
    r = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: "20" })}`, { headers: { "X-Subscription-Token": key, Accept: "application/json" } });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 1100)); // free tier: 1 request/second
  }
  if (!r?.ok) throw new Error(`Brave Search returned ${r?.status}. Check the key in Settings → Web Research.`);
  return ((await r.json()).web?.results ?? []).map((x: { url: string; title?: string; description?: string }) => ({ url: x.url, title: clean(x.title ?? ""), snippet: clean(x.description ?? "") }));
}
async function serper(q: string, key: string): Promise<Hit[]> {
  const r = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 20 }) });
  if (r.status === 401 || r.status === 403) throw new Error("Serper rejected the API key. Check it in Settings → Web Research.");
  if (r.status === 429) throw new Error("Serper rate limit or credits exhausted. Check your plan at serper.dev.");
  if (!r.ok) throw new Error(`Serper returned ${r.status}`);
  return ((await r.json()).organic ?? []).filter((x: { link?: string }) => x.link?.startsWith("http")).map((x: { link: string; title?: string; snippet?: string }) => ({ url: x.link, title: clean(x.title ?? ""), snippet: clean(x.snippet ?? "") }));
}

// ---------- read ----------
async function fetchPage(url: string, allow: Set<string>, block: Set<string>) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en;q=0.9" }, signal: AbortSignal.timeout(12_000) });
    const ctype = r.headers.get("content-type")?.toLowerCase() ?? "";
    // ponytail: PDFs fall back to the search snippet; add a PDF parser if briefs need report text
    if (r.status !== 200 || !/html|xml/.test(ctype) || !trusted(r.url, allow, block)) return null; // a redirect must stay trusted
    const html = (await r.text()).slice(0, MAX_BYTES);
    const root = parse(html);
    const title = root.querySelector('meta[property="og:title"]')?.getAttribute("content") || root.querySelector("title")?.text.trim() || "";
    root.querySelectorAll("script,style,nav,header,footer,aside,form,noscript,svg,button").forEach((n) => n.remove());
    const main = root.querySelector("article") ?? root.querySelector("main") ?? root.querySelector("body") ?? root;
    const seen = new Set<string>(), blocks: string[] = [];
    for (const el of main.querySelectorAll("h1,h2,h3,p,li,blockquote,td")) {
      if (el.querySelector("p,li")) continue; // a container; its children are visited on their own
      const t = el.text.replace(/\s+/g, " ").trim(), head = /^h[123]$/i.test(el.tagName);
      if ((t.length >= 60 || head) && !seen.has(t)) { seen.add(t); blocks.push(t); }
    }
    return { url, title, text: blocks.join("\n\n").slice(0, MAX_CHARS) };
  } catch { return null; } // a timeout or odd markup must never sink the whole run
}

// ---------- rank ----------
const STOP = new Set("the and for with that this from are was were has have its their into than then they them will would about should which what when where while been being also more most such other over under between house".split(" "));
const terms = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
const lexical = (q: Set<string>, t: string) => { const x = terms(t); let n = 0; q.forEach((w) => { if (x.has(w)) n++; }); return n / (1 + Math.sqrt(q.size)); };
function chunks(text: string, size = 900) {
  const out: string[] = []; let cur = "";
  for (const p of text.split(/\n\s*\n/)) { if (cur && cur.length + p.length > size) { out.push(cur); cur = ""; } cur = cur ? `${cur}\n\n${p}` : p.slice(0, size * 2); }
  if (cur) out.push(cur);
  return out;
}
const subject = (t: string) => t.replace(/^\s*(?:this house(?: would| believes that| believes| regrets| supports| opposes| prefers)?|th(?:bt|w|r|s|o|p))\b[:,\s]*/i, "").trim().replace(/\.$/, "") || t.trim();
function angles(b: Body): [string, string][] {
  const t = subject(b.text), c = b.country;
  if (b.mode === "mun") return [["Background", `background, key facts and statistics on ${t}`], ["International action", `UN resolutions, treaties and international action on ${t}`],
    ...(c ? [[c, `${c} government position, policy and interests on ${t}`] as [string, string]] : []),
    ["For action", `arguments and evidence for stronger international action on ${t}; proposed solutions`], ["Against / concerns", `arguments against, costs, obstacles and criticism of action on ${t}`]];
  return [["Proposition", `arguments, evidence and benefits supporting: ${t}`], ["Opposition", `arguments, evidence, risks and harms against: ${t}`], ["Context", `key facts, statistics and background on ${t}`]];
}

export async function POST(req: Request) {
  const b: Body = await req.json();
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctl) {
      const send = (o: object) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const [nPages, nPass] = DEPTH[b.depth] ?? DEPTH.standard;
        const { allow, block, mine } = rules(b);
        if (!allow.size) throw new Error("Your trusted source list is empty. Add domains in Settings → Web Research.");
        if (b.provider === "serper" && !b.serper_key) throw new Error("Google (Serper) needs your own API key. Add it in Settings → Web Research.");
        const groups = [...Array.from({ length: Math.ceil(mine.length / 7) }, (_, i) => mine.slice(i * 7, i * 7 + 7)),
          ...GROUPS.map((g) => g.filter((d) => allow.has(d) && !block.has(d))).filter((g) => g.length)];
        const site = (g: string[]) => g.map((d) => `site:${d.includes(".") ? d : "." + d}`).join(" OR ");
        const runs = (b.queries ?? []).slice(0, 12).flatMap((q, i) => [q, groups.length ? `${q} (${site(groups[i % groups.length])})` : q]);
        send({ step: "search", detail: `Running ${runs.length} searches` });
        const engine = (q: string) => b.provider === "serper" ? serper(q, b.serper_key!) : b.provider === "brave" && b.brave_key ? brave(q, b.brave_key) : ddg(q);
        // Brave's free tier allows 1 request/second; others run 3 at a time.
        const width = b.provider === "brave" ? 1 : 3, results: (Hit[] | Error)[] = [];
        for (let i = 0; i < runs.length; i += width) results.push(...await Promise.all(runs.slice(i, i + width).map((q) => engine(q).catch((e: Error) => e))));
        const errors = results.filter((r): r is Error => r instanceof Error);
        if (errors.length === results.length) throw errors[0];

        // Rank URLs: reciprocal rank summed over every search that found them.
        const hits = new Map<string, Hit & { score: number; snippets: string[] }>(); let total = 0;
        for (const res of results) if (!(res instanceof Error)) { total += res.length; res.forEach((r, rank) => {
          const url = r.url.split("#")[0];
          if (!trusted(url, allow, block)) return;
          const h = hits.get(url) ?? { ...r, url, score: 0, snippets: [] };
          h.score += 1 / (rank + 2);
          if (r.snippet && !h.snippets.includes(r.snippet)) h.snippets.push(r.snippet);
          hits.set(url, h);
        }); }
        if (!hits.size) throw new Error("No results from trusted sources. Try rewording, a deeper search, or adding domains in Settings → Web Research.");
        const per: Record<string, number> = {}, chosen: (Hit & { snippets: string[]; domain: string })[] = [];
        for (const h of [...hits.values()].sort((a, b) => b.score - a.score)) {
          const domain = host(h.url);
          if ((per[domain] ?? 0) < PER_DOMAIN + Number(b.depth === "deep")) { per[domain] = (per[domain] ?? 0) + 1; chosen.push({ ...h, domain }); }
          if (chosen.length >= nPages) break;
        }
        send({ step: "search", detail: `${total} results · ${hits.size} from trusted sources · reading the top ${chosen.length}` });

        let done = 0;
        send({ step: "read", detail: `Reading 0/${chosen.length} sources` });
        const pages = await Promise.all(chosen.map((h) => fetchPage(h.url, allow, block).then((p) => { send({ step: "read", detail: `Reading ${++done}/${chosen.length} sources` }); return p; })));

        const q = terms([b.text, ...(b.queries ?? [])].join(" "));
        const passages = chosen.flatMap((h, i) => {
          const page = pages[i], full = !!page && page.text.length >= 400;
          const body = full ? page!.text : h.snippets.join(" ");
          if (body.length < 80) return [];
          const title = (page?.title || h.title || h.domain).slice(0, 200);
          return chunks(body).sort((a, c) => lexical(q, c) - lexical(q, a)).slice(0, 8).map((text) => ({ url: h.url, domain: h.domain, title, text, snippet_only: !full }));
        });
        if (!passages.length) throw new Error("The trusted sources found couldn't be read. Try again or choose a deeper search.");

        send({ step: "rank", detail: `Ranking ${passages.length} passages from ${new Set(passages.map((p) => p.url)).size} sources` });
        // Round-robin over angles, each taking its best unused passage, so every side gets evidence.
        const ang = angles(b), scores = ang.map(([, a]) => { const t = terms(a); return passages.map((p) => lexical(t, p.text)); });
        const order = scores.map((sc) => passages.map((_, i) => i).sort((x, y) => sc[y] - sc[x]));
        const used = new Set<number>(), perUrl: Record<string, number> = {}, ptr = ang.map(() => 0), picked: object[] = [];
        while (picked.length < nPass && ptr.some((p) => p < passages.length)) {
          for (let a = 0; a < ang.length && picked.length < nPass; a++) {
            while (ptr[a] < passages.length) {
              const i = order[a][ptr[a]++];
              if (!used.has(i) && (perUrl[passages[i].url] ?? 0) < 3) {
                used.add(i); perUrl[passages[i].url] = (perUrl[passages[i].url] ?? 0) + 1;
                picked.push({ ...passages[i], n: picked.length + 1, angle: ang[a][0], score: Math.round(scores[a][i] * 1000) / 1000 });
                break;
              }
            }
          }
        }
        send({ sources: picked });
      } catch (e) {
        send({ error: (e as Error).message.slice(0, 500) });
      }
      ctl.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
