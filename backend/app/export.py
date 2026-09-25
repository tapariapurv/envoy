"""Offline Binder: the whole workspace compiled into one self-contained HTML file."""
import base64
import secrets
from datetime import datetime
from html import escape
from pathlib import Path

import markdown

CSS = """
:root{--bg:#fbfaf8;--fg:#1c1b1a;--mut:#6b6862;--line:#e7e4df;--card:#fff;--acc:#4f46e5}
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
.brand{display:flex;align-items:center;gap:10px;font-size:15px}.brand img{width:28px;height:28px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}.stat{flex:1;min-width:110px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.stat b{display:block;font:600 22px Georgia,serif}.stat span{color:var(--mut);font-size:12px}
@media print{nav,#q{display:none}main{margin:0;padding:0;max-width:none}section{break-before:page}h2{margin-top:0}.card{break-inside:avoid}}
@media(max-width:800px){nav{position:static;width:auto;border:0}main{margin:0;padding:16px}}
"""


PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"


def _data_uri(name: str) -> str:
    f = PUBLIC / name
    return f"data:image/png;base64,{base64.b64encode(f.read_bytes()).decode()}" if f.exists() else ""


LOGO_URI, LOGO_DARK_URI = _data_uri("logo.png"), _data_uri("logo-dark.png")


def md(text: str) -> str:
    return markdown.markdown(text or "", extensions=["tables", "fenced_code", "sane_lists"])


def binder(s, tasks, drafts, docs, clauses, cards) -> str:
    nonce = secrets.token_hex(12)
    e = escape
    status = {"todo": "To do", "doing": "In progress", "done": "Done"}
    sec = []
    sec.append(("tasks", "Tasks", "".join(
        f'<div class="card f"><span class="pill">{status[t["status"]]}</span><span class="pill">{e(t["priority"])}</span>'
        f'<b>{e(t["title"])}</b>{"<div>" + md(t["notes"]) + "</div>" if t["notes"] else ""}</div>' for t in tasks) or "<p class=mut>None</p>"))
    sec.append(("drafts", "Drafts & Position Papers", "".join(
        f'<div class="card f"><h3>{e(d["title"])}</h3><p class=mut>Updated {e(d["updated"])}</p>{md(d["content"])}</div>'
        for d in drafts) or "<p class=mut>None</p>"))
    sec.append(("research", "Research Vault", "".join(
        f'<details class="card f"><summary>{e(d["name"])}</summary>{md(d["markdown"])}</details>' for d in docs) or "<p class=mut>None</p>"))
    for kind in ("preambulatory", "operative", "custom"):
        items = [c for c in clauses if c["kind"] == kind]
        if items:
            sec.append((kind, f"{kind.title()} Clauses", '<div class="grid">' + "".join(
                f'<div class="card f" style="margin:0;padding:8px 12px"><i>{e(c["phrase"])}</i>'
                f'{"<div class=mut>" + e(c["example"]) + "</div>" if c["example"] else ""}</div>' for c in items) + "</div>"))
    sec.append(("rules", "Rules of Procedure", "".join(
        f'<details class="card f"><summary>{e(c["front"])}</summary><p>{e(c["back"])}</p></details>' for c in cards)))

    profile = " · ".join(e(x) for x in (s["delegate_country"], s["committee"], s["topic"]) if x) or "Model UN Binder"
    nav = "".join(f'<a href="#{i}">{t}</a>' for i, t, _ in sec)
    stats = "".join(f'<div class="stat"><b>{n}</b><span>{l}</span></div>' for n, l in (
        (sum(t["status"] != "done" for t in tasks), "open tasks"), (len(drafts), "drafts"),
        (len(docs), "research documents"), (len(clauses), "clauses"), (len(cards), "procedure cards")))
    body = "".join(f'<section id="{i}"><h2>{t}</h2>{h}</section>' for i, t, h in sec)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-{nonce}'">
<title>Envoy Binder</title>{f'<link rel="icon" href="{LOGO_URI}">' if LOGO_URI else ""}<style>{CSS}</style></head><body>
<nav><div class="brand">{f'<picture><source srcset="{LOGO_DARK_URI}" media="(prefers-color-scheme: dark)"><img src="{LOGO_URI}" alt=""></picture>' if LOGO_URI else ""}<b>Envoy Binder</b></div><p class=mut>{profile}</p><input id=q placeholder="Search binder…" aria-label="Search binder">{nav}</nav>
<main><h1>{profile}</h1><p class=mut>Compiled {datetime.now():%B %d, %Y at %H:%M} · works fully offline</p><div class="stats">{stats}</div>{body}</main>
<script nonce="{nonce}">document.getElementById('q').addEventListener('input',e=>{{const q=e.target.value.toLowerCase();
document.querySelectorAll('.f').forEach(n=>{{const m=!q||n.textContent.toLowerCase().includes(q);n.classList.toggle('hide',!m);if(q&&m&&n.tagName==='DETAILS')n.open=true}})}})</script>
</body></html>"""
