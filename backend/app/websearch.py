"""Web Research: a systematic, cited brief on a debate motion or MUN topic, built only from trusted sources.

Pipeline (streamed as NDJSON events so the UI can show progress):
  plan    the LLM writes balanced search queries (deterministic fallback if it can't)
  search  each query runs twice: open web, and restricted to groups of top trusted domains
  read    top-ranked trusted pages are fetched concurrently and reduced to clean paragraphs
  rank    passages are scored against each angle (Proposition/Opposition, or MUN angles) with embeddings
  write   the LLM writes a structured report citing [n]; the source list is appended verbatim
Searches and pages are cached in SQLite, so re-running or refining a motion is fast.
"""
import asyncio
import json
import math
import os
import re
import tempfile
import time
from collections import defaultdict
from datetime import date
from functools import cache
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

from . import db, llm, rag

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
DEPTH = {"quick": (3, 8, 10), "standard": (6, 14, 18), "deep": (10, 24, 28)}  # queries (x2 searches), pages read, passages
SEARCH_TTL, PAGE_TTL = 86_400, 3 * 86_400
MAX_BYTES, MAX_CHARS, PER_DOMAIN = 4_000_000, 60_000, 2
# Site-restricted searches rotate through these groups (entries the user blocked are dropped).
GROUPS = [
    ["reuters.com", "apnews.com", "bbc.co.uk", "theguardian.com", "aljazeera.com", "economist.com", "ft.com"],
    ["un.org", ".int", ".gov", "worldbank.org", "oecd.org", "imf.org", "europa.eu"],
    ["brookings.edu", "cfr.org", "chathamhouse.org", "csis.org", "rand.org", "crisisgroup.org", "carnegieendowment.org"],
    [".edu", ".ac.uk", "nature.com", "ncbi.nlm.nih.gov", "theconversation.com", "ourworldindata.org", "pewresearch.org"],
]


# ---------- trusted sources ----------
@cache
def builtin() -> frozenset[str]:
    lines = Path(__file__).with_name("trusted_sources.txt").read_text().splitlines()
    return frozenset(n for l in lines if (n := _norm(l)) and not l.lstrip().startswith("#"))


def _norm(entry: str) -> str:
    """'https://www.BBC.co.uk/news' -> 'bbc.co.uk'; '.gov' -> 'gov' (every rule matches whole labels from the right)."""
    e = re.sub(r"^[a-z]+://", "", entry.strip().lower()).split("/")[0].split("#")[0].strip()
    return e.removeprefix("www.").strip(".")


def rules(s: dict) -> tuple[set[str], set[str], list[str]]:
    """(allowed, blocked, user's own additions) from Settings. Lines starting with '-' block a domain."""
    allow, block, mine = set(builtin()) if s.get("trusted_use_default", True) else set(), set(), []
    for line in str(s.get("trusted_custom") or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            block.add(_norm(line[1:]))
        elif n := _norm(line):
            allow.add(n)
            mine.append(n)
    return allow - block, block, mine


def trusted(url: str, allow: set[str], block: set[str]) -> bool:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    cands = {".".join(parts[i:]) for i in range(len(parts))}
    return bool(host) and bool(cands & allow) and not cands & block


def site_groups(allow: set[str], block: set[str], mine: list[str]) -> list[list[str]]:
    ok = lambda d: d in allow and d not in block
    groups = [mine[i:i + 7] for i in range(0, len(mine), 7)]  # the user's own sources come first
    groups += [g for g in ([d.strip(".") for d in grp if ok(d.strip("."))] for grp in GROUPS) if g]
    return groups or [sorted(allow)[:7]]


# ---------- cache ----------
def cache_get(key: str, ttl: int):
    r = db.one("SELECT value, ts FROM web_cache WHERE key=?", (key,))
    return json.loads(r["value"]) if r and time.time() - r["ts"] < ttl else None


def cache_set(key: str, value) -> None:
    db.execute("INSERT OR REPLACE INTO web_cache(key, value, ts) VALUES(?,?,?)", (key, json.dumps(value), time.time()))


# ---------- query planning ----------
MOTION_PREFIX = re.compile(r"^\s*(?:this house(?: would| believes that| believes| regrets| supports| opposes| prefers)?|th(?:bt|w|r|s|o|p))\b[:,\s]*", re.I)


def subject(text: str) -> str:
    """'THW ban social media for under-16s' -> 'ban social media for under-16s'."""
    return MOTION_PREFIX.sub("", text).strip().rstrip(".") or text.strip()


def fallback_queries(text: str, mode: str, s: dict) -> list[str]:
    t, y, c = subject(text), date.today().year, s.get("delegate_country") or ""
    if mode == "mun":
        return [t, f"UN resolution {t}", f"{c} position {t}".strip(), f"{t} statistics", f"{t} treaty international agreement",
                f"{t} solutions", f"{t} criticism challenges", f"{t} developing countries", f"{t} {y}", f"{t} report"]
    return [t, f"{t} evidence", f"benefits of {t}", f"problems with {t}", f"{t} statistics", f"{t} case study",
            f"{t} criticism", f"{t} research study", f"{t} {y}", f"{t} expert analysis"]


def parse_queries(raw: str) -> list[str]:
    try:
        m = re.search(r"\[.*\]", raw, re.S)
        items = json.loads(m.group(0)) if m else []
    except ValueError:
        items = []
    if not items:  # tolerate numbered/bulleted lists from small models
        items = [re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", l) for l in raw.splitlines()]
    return [q for i in items if isinstance(i, str) and 2 <= len(q := i.strip().strip('"\'').replace('"', "")) <= 120]


def dedupe(qs: list[str]) -> list[str]:
    seen, out = set(), []
    for q in qs:
        if (k := q.lower()) not in seen:
            seen.add(k)
            out.append(q)
    return out


async def plan(text: str, mode: str, n: int, s: dict) -> list[str]:
    if mode == "mun":
        who = s.get("delegate_country") or "a delegation"
        cover = (f"background and statistics, past UN resolutions and treaties, {who}'s official position, the positions of "
                 "major blocs, proposed solutions and their criticisms, recent developments")
    else:
        cover = ("core facts and statistics, the strongest evidence FOR the motion, the strongest evidence AGAINST it, "
                 "real-world examples and case studies, academic research, recent developments")
    prompt = (f"Today is {date.today():%B %Y}. Write {n} distinct web search queries to research this "
              f"{'Model UN topic' if mode == 'mun' else 'debate motion'}: \"{text}\". Cover: {cover}. Keep both sides "
              "balanced. Each query 3-9 words, plain keywords, no quotes or operators. Return ONLY a JSON array of strings.")
    try:
        raw = "".join([t async for t in llm.stream([{"role": "user", "content": prompt}], s, temperature=0.2, max_tokens=800)])
        qs = parse_queries(raw)
    except Exception:
        qs = []
    return dedupe(qs + fallback_queries(text, mode, s))[:n]


# ---------- search ----------
def _clean(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


async def ddg(client: httpx.AsyncClient, q: str) -> list[dict]:
    from bs4 import BeautifulSoup
    r = await client.post("https://html.duckduckgo.com/html/", data={"q": q, "kl": "wt-wt"})
    if r.status_code != 200:
        raise RuntimeError(f"DuckDuckGo returned {r.status_code} (rate limited?). Try again shortly or add a Brave Search key in Settings.")
    out = []
    for d in BeautifulSoup(r.text, "html.parser").select("div.result"):
        a = d.select_one("a.result__a")
        if not a or "result--ad" in d.get("class", []):
            continue
        href = a.get("href", "")
        url = parse_qs(urlparse(href).query).get("uddg", [href])[0]
        if url.startswith("http"):
            sn = d.select_one(".result__snippet")
            out.append({"url": url, "title": a.get_text(" ", strip=True), "snippet": sn.get_text(" ", strip=True) if sn else ""})
    return out


async def brave(client: httpx.AsyncClient, q: str, key: str) -> list[dict]:
    for _ in range(3):
        r = await client.get("https://api.search.brave.com/res/v1/web/search", params={"q": q, "count": 20},
                             headers={"X-Subscription-Token": key, "Accept": "application/json"})
        if r.status_code != 429:
            break
        await asyncio.sleep(1.1)  # free tier: 1 request/second
    r.raise_for_status()
    return [{"url": x["url"], "title": _clean(x.get("title", "")), "snippet": _clean(x.get("description", ""))}
            for x in r.json().get("web", {}).get("results", [])]


async def search(client: httpx.AsyncClient, q: str, s: dict, gate: asyncio.Semaphore) -> list[dict]:
    use_brave = s.get("web_search_provider") == "brave" and s.get("web_search_key")
    key = f"search:{'brave' if use_brave else 'ddg'}:{q}"
    if (hit := cache_get(key, SEARCH_TTL)) is not None:
        return hit
    async with gate:
        out = await (brave(client, q, s["web_search_key"]) if use_brave else ddg(client, q))
    cache_set(key, out)
    return out


# ---------- read ----------
def extract(data: bytes, ext: str) -> tuple[str, str]:
    """(title, clean text). HTML keeps only article-like blocks; PDFs go through MarkItDown."""
    if ext == ".pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
        try:
            return "", rag.parse(f.name)[:MAX_CHARS]
        finally:
            os.unlink(f.name)
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(data, "html.parser")
    og = soup.find("meta", property="og:title")
    title = (og.get("content") if og else "") or (soup.title.get_text(strip=True) if soup.title else "")
    for t in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript", "svg", "button"]):
        t.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    blocks, seen = [], set()
    for el in root.find_all(["h1", "h2", "h3", "p", "li", "blockquote", "td"]):
        if el.find(["p", "li"]):  # a container; its children are visited on their own
            continue
        txt = el.get_text(" ", strip=True)
        if (len(txt) >= 60 or el.name in ("h1", "h2", "h3")) and txt not in seen:
            seen.add(txt)
            blocks.append(txt)
    return title, "\n\n".join(blocks)[:MAX_CHARS]


async def fetch(client: httpx.AsyncClient, url: str, allow: set[str], block: set[str]) -> dict | None:
    if hit := cache_get(f"page:{url}", PAGE_TTL):
        return hit
    page = None
    try:
        async with client.stream("GET", url) as r:
            ctype = r.headers.get("content-type", "").lower()
            ext = ".pdf" if "pdf" in ctype else ".html" if "html" in ctype or "xml" in ctype else None
            if r.status_code == 200 and ext and trusted(str(r.url), allow, block):  # a redirect must stay trusted
                data = b""
                async for b in r.aiter_bytes():
                    data += b
                    if len(data) > MAX_BYTES:
                        break
                title, text = await asyncio.to_thread(extract, data, ext)
                page = {"url": url, "title": title, "text": text}
                cache_set(f"page:{url}", page)  # failures aren't cached, so a flaky site is retried next run
    except Exception:  # a timeout, broken PDF or odd markup must never sink the whole run
        pass
    return page


# ---------- rank ----------
WORD = re.compile(r"[a-z0-9]{3,}")
STOP = set("the and for with that this from are was were has have its their into than then they them will would about "
           "should which what when where while been being also more most such other over under between house".split())


def terms(text: str) -> set[str]:
    return set(WORD.findall(text.lower())) - STOP


def lexical(q: set[str], text: str) -> float:
    t = terms(text)
    return len(q & t) / (1 + math.sqrt(len(q)))


def cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1)


def angles(text: str, mode: str, s: dict) -> list[tuple[str, str]]:
    t, c = subject(text), s.get("delegate_country")
    if mode == "mun":
        out = [("Background", f"background, key facts and statistics on {t}"),
               ("International action", f"UN resolutions, treaties and international action on {t}")]
        if c:
            out.append((c, f"{c} government position, policy and interests on {t}"))
        return out + [("For action", f"arguments and evidence for stronger international action on {t}; proposed solutions"),
                      ("Against / concerns", f"arguments against, costs, obstacles and criticism of action on {t}")]
    return [("Proposition", f"arguments, evidence and benefits supporting: {t}"),
            ("Opposition", f"arguments, evidence, risks and harms against: {t}"),
            ("Context", f"key facts, statistics and background on {t}")]


def select(passages: list[dict], scores: list[list[float]], labels: list[str], k: int, per_url: int = 3) -> list[dict]:
    """Round-robin over angles, each taking its best unused passage, so every side gets evidence."""
    order = [sorted(range(len(passages)), key=lambda i: -sc[i]) for sc in scores]
    used, per, out, ptr = set(), defaultdict(int), [], [0] * len(labels)
    while len(out) < k and any(p < len(passages) for p in ptr):
        for a, label in enumerate(labels):
            while ptr[a] < len(passages):
                i = order[a][ptr[a]]
                ptr[a] += 1
                if i not in used and per[passages[i]["url"]] < per_url:
                    used.add(i)
                    per[passages[i]["url"]] += 1
                    out.append({**passages[i], "angle": label, "score": round(scores[a][i], 3)})
                    break
            if len(out) >= k:
                break
    return out


# ---------- report ----------
DEBATE_REPORT = """## Motion at a glance
What the motion means, key terms and a sensible definition, and the burden each side carries.

## Key facts & statistics
Bullet list of the most useful facts, each cited.

## Proposition case
3-5 arguments. For each: ### <title>, then **Claim**, **Mechanism** (why it is true), **Evidence** (cited), **Impact**, and **Expect Opposition to say** (one line).

## Opposition case
Same structure as the Proposition case, 3-5 arguments, ending each with **Expect Proposition to say**.

## Key clashes
A Markdown table: | Clash | Proposition | Opposition |

## Weighing
How each side wins the round: which clashes matter most and why.

## Evidence gaps
What is thin or missing and what to research next."""

MUN_REPORT = """## Topic overview
Why the issue matters now, in two short paragraphs.

## Key facts & statistics
Bullet list of the most useful facts, each cited.

## International action so far
Resolutions, treaties, programmes and bodies involved (bold their names), what they achieved and where they fell short.

## {country}'s position & interests
What the evidence shows about {country}'s stance, record and interests. If the evidence is thin, say so and list what to verify.

## Arguments for action
3-5 arguments. For each: ### <title>, then **Claim**, **Evidence** (cited), **Impact**.

## Arguments against / concerns
3-5 arguments other delegations may raise. Same structure, plus **How to respond**.

## Bloc landscape
A Markdown table: | Country or bloc | Likely stance | Basis |

## Solutions & clause ideas
Numbered proposals with a **bold lead-in**, who implements them and how they are funded or monitored.

## Questions to expect
3-5 likely points of information, each with a short answer.

## Evidence gaps
What is thin or missing and what to research next."""


def report_messages(text: str, mode: str, s: dict, picked: list[dict]) -> list[dict]:
    evidence = "\n\n".join(f"[{p['n']}] {p['title']} ({p['domain']}) - retrieved for: {p['angle']}\n{p['text']}" for p in picked)
    if mode == "mun":
        country = s.get("delegate_country") or "the delegation"
        role = (f"a senior Model UN research director briefing a delegate representing {country}"
                f"{' in ' + s['committee'] if s.get('committee') else ''}")
        template = MUN_REPORT.format(country=country)
    else:
        role = "a championship debate coach and research analyst preparing a team for a competitive round"
        template = DEBATE_REPORT
    system = (f"You are {role}. Today is {date.today():%d %B %Y}. Write a comprehensive, rigorous research brief using ONLY "
              "the numbered evidence below, which comes from vetted trusted sources. " + llm.CITE + " Cite as many "
              "different sources as are relevant. If the evidence does not support a point, present it as analysis "
              "('Analysis:') without a citation rather than inventing support. Be specific: names, numbers, dates, places. "
              "Be even-handed between sides.\n\nOutput Markdown in exactly this structure, no preamble, no H1, no "
              f"sources list (it is appended automatically):\n\n{template}\n\nEVIDENCE:\n{evidence}")
    label = "Model UN topic" if mode == "mun" else "Motion"
    return [{"role": "system", "content": system}, {"role": "user", "content": f"{label}: {text}"}]


def bibliography(picked: list[dict]) -> str:
    lines = [f"{p['n']}. [{p['title'].replace('[', '(').replace(']', ')')}]({p['url']}) - {p['domain']}"
             f"{' (search summary only)' if p.get('snippet_only') else ''}" for p in picked]
    return "\n\n## Sources\n\n" + "\n".join(lines) + "\n"


# ---------- pipeline ----------
async def run(text: str, mode: str, depth: str, s: dict):
    n_q, n_pages, n_pass = DEPTH.get(depth, DEPTH["standard"])
    allow, block, mine = rules(s)
    if not allow:
        raise ValueError("Your trusted source list is empty. Add domains in Settings → Web Research.")

    yield {"step": "plan", "detail": "Planning searches"}
    queries = await plan(text, mode, n_q, s)
    yield {"queries": queries}

    groups = site_groups(allow, block, mine)
    site = lambda g: " OR ".join(f"site:{d if '.' in d else '.' + d}" for d in g)
    runs = [r for i, q in enumerate(queries) for r in (q, f"{q} ({site(groups[i % len(groups)])})")]
    yield {"step": "search", "detail": f"Running {len(runs)} searches"}
    limits = httpx.Limits(max_connections=16, max_keepalive_connections=8)
    async with httpx.AsyncClient(headers={"User-Agent": UA, "Accept-Language": "en;q=0.9"}, follow_redirects=True,
                                 timeout=httpx.Timeout(12, connect=6), limits=limits) as client:
        gate = asyncio.Semaphore(1 if s.get("web_search_provider") == "brave" else 3)
        results = await asyncio.gather(*(search(client, q, s, gate) for q in runs), return_exceptions=True)
        errors = [r for r in results if isinstance(r, Exception)]
        if len(errors) == len(results):
            raise errors[0]

        # Rank URLs: reciprocal rank summed over every search that found them.
        hits: dict[str, dict] = {}
        total = 0
        for res in results:
            if isinstance(res, Exception):
                continue
            total += len(res)
            for rank, r in enumerate(res):
                url = r["url"].split("#")[0]
                if not trusted(url, allow, block):
                    continue
                h = hits.setdefault(url, {**r, "url": url, "score": 0.0, "snippets": []})
                h["score"] += 1 / (rank + 2)
                if r["snippet"] and r["snippet"] not in h["snippets"]:
                    h["snippets"].append(r["snippet"])
        if not hits:
            raise ValueError("No results from trusted sources. Try rewording the motion, a deeper search, "
                             "or adding domains in Settings → Web Research.")
        per, chosen = defaultdict(int), []
        for h in sorted(hits.values(), key=lambda h: -h["score"]):
            dom = (urlparse(h["url"]).hostname or "").removeprefix("www.")
            if per[dom] < PER_DOMAIN + (depth == "deep"):
                per[dom] += 1
                chosen.append({**h, "domain": dom})
            if len(chosen) >= n_pages:
                break
        yield {"step": "search", "detail": f"{total} results · {len(hits)} from trusted sources · reading the top {len(chosen)}"}

        yield {"step": "read", "detail": f"Reading 0/{len(chosen)} sources"}
        pages, done = [], 0
        for fut in asyncio.as_completed([fetch(client, h["url"], allow, block) for h in chosen]):
            pages.append(await fut)
            done += 1
            yield {"step": "read", "detail": f"Reading {done}/{len(chosen)} sources"}

    by_url = {p["url"]: p for p in pages if p}
    q_terms = terms(" ".join([text, *queries]))
    passages = []
    for h in chosen:
        page = by_url.get(h["url"])
        body, snippet_only = (page["text"], False) if page and len(page["text"]) >= 400 else (" ".join(h["snippets"]), True)
        if len(body) < 80:
            continue
        # Prefilter each page to its most on-topic chunks so embedding stays cheap.
        chunks = sorted(rag.chunk(body, 900, 120), key=lambda c: -lexical(q_terms, c))[:8]
        title = (page and page["title"]) or h["title"] or h["domain"]
        passages += [{"url": h["url"], "domain": h["domain"], "title": title[:200], "text": c, "snippet_only": snippet_only}
                     for c in chunks]
    if not passages:
        raise ValueError("The trusted sources found couldn't be read. Try again or choose a deeper search.")

    yield {"step": "rank", "detail": f"Ranking {len(passages)} passages from {len({p['url'] for p in passages})} sources"}
    ang = angles(text, mode, s)
    try:
        vecs = await llm.embed([a[1] for a in ang] + [p["text"] for p in passages], s)
        scores = [[cos(vecs[a], v) for v in vecs[len(ang):]] for a in range(len(ang))]
    except Exception:  # no embedding model: fall back to keyword overlap
        scores = [[lexical(terms(a[1]), p["text"]) for p in passages] for a in ang]
    picked = select(passages, scores, [a[0] for a in ang], n_pass)
    for i, p in enumerate(picked, 1):
        p["n"] = i
    yield {"sources": [{k: p[k] for k in ("n", "url", "domain", "title", "text", "angle", "score", "snippet_only")} for p in picked]}

    yield {"step": "write", "detail": f"Writing the report from {len(picked)} passages"}
    kw = {"max_tokens": max(int(s["llm_max_tokens"]), 4000)}
    if s["llm_model"].startswith(("ollama/", "ollama_chat/")):
        kw["num_ctx"] = 16384  # Ollama's default window would silently drop most of the evidence
    async for t in llm.stream(report_messages(text, mode, s, picked), s, **kw):
        yield {"t": t}
    yield {"t": bibliography(picked)}
    yield {"step": "done", "detail": f"{len(picked)} passages from {len({p['url'] for p in picked})} trusted sources"}
