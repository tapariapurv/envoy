/** Pure text helpers (no imports, so tests/core.test.ts can run them in plain Node). */
export function chunk(text: string, size: number, overlap: number) {
  size = Math.max(200, size); overlap = Math.max(0, Math.min(overlap, size / 2));
  const out: string[] = []; let cur = "";
  for (let p of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    while (p.length > size) { // hard-split giant paragraphs (tables, PDFs without breaks)
      let cut = p.lastIndexOf(" ", size); if (cut <= size / 2) cut = size;
      if (cur) { out.push(cur); cur = ""; }
      out.push(p.slice(0, cut)); p = p.slice(cut).trimStart();
    }
    if (cur && cur.length + p.length + 2 > size) { out.push(cur); cur = overlap ? cur.slice(-overlap) : ""; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}
const STOP = new Set("the and for with that this from are was were has have its their into than then they them will would about should which what when where while been being also more most such other over under between".split(" "));
export const terms = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w));

/** BM25: the top `k` chunks for query `q`, each with a score > 0. */
export function rank<T extends { text: string }>(q: string, chunks: T[], k: number): (T & { score: number })[] {
  if (!chunks.length) return [];
  const toks = chunks.map((c) => terms(c.text));
  const qs = [...new Set(terms(q))], N = chunks.length, avg = toks.reduce((a, t) => a + t.length, 0) / N || 1;
  const df = Object.fromEntries(qs.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  return chunks.map((c, i) => {
    const tf: Record<string, number> = {};
    for (const w of toks[i]) if (w in df) tf[w] = (tf[w] ?? 0) + 1;
    const score = qs.reduce((a, w) => a + (tf[w] ? Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)) * tf[w] * 2.5 / (tf[w] + 1.5 * (0.25 + 0.75 * toks[i].length / avg)) : 0), 0);
    return { ...c, score };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
