"""Envoy API. Run: uvicorn app.main:app --host 127.0.0.1 --port 8000

Access model
- Requests from this machine (loopback, no access code) are the owner: every workspace, all settings.
- Anyone else must send a workspace's access code (X-Access-Code header or ?code=) and can only
  touch that one workspace. Remote access only exists when started with `npm run share`.
"""
import os
import re
import secrets
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import db, docx_export, export, llm, rag

MAX_UPLOAD = 50 * 1024 * 1024
ALLOWED_EXT = {".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm", ".txt", ".md", ".csv", ".json"}
SHARE = os.environ.get("ENVOY_SHARE") == "1"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion


@asynccontextmanager
async def lifespan(_):
    db.init()
    await llm.autodetect_model()
    yield


app = FastAPI(title="Envoy", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_methods=["*"], allow_headers=["*"],
                   allow_origins=os.environ.get("ENVOY_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
                   allow_origin_regex=os.environ.get("ENVOY_ORIGIN_REGEX") or None)


# ---------- access ----------
@dataclass
class Ctx:
    ws: int
    owner: bool


def ctx(request: Request) -> Ctx:
    code = (request.headers.get("x-access-code") or request.query_params.get("code") or "").strip().upper()
    local = request.client is not None and request.client.host in ("127.0.0.1", "::1")
    if local and not code:
        ws = int(request.headers.get("x-workspace") or request.query_params.get("ws") or 0)
        return Ctx(ws if ws and db.one("SELECT 1 FROM workspaces WHERE id=?", (ws,)) else db.first_ws(), True)
    # ponytail: no rate limiting; codes carry ~50 bits of entropy, add a limiter if exposed beyond a LAN
    row = db.one("SELECT id FROM workspaces WHERE share_on=1 AND share_code=?", (code,)) if code else None
    if not row or not (SHARE or local):
        raise HTTPException(401, "A valid workspace access code is required")
    return Ctx(row["id"], False)


def owner(c: Ctx = Depends(ctx)) -> Ctx:
    if not c.owner:
        raise HTTPException(403, "Only the workspace owner can do this")
    return c


def patch(table: str, id: int, data: dict, allowed: set[str], ws: int | None = None) -> dict:
    data = {k: v for k, v in data.items() if k in allowed}
    scope, args = (" AND workspace_id=?", (ws,)) if ws else ("", ())
    if data:
        db.execute(f"UPDATE {table} SET {', '.join(f'{k}=?' for k in data)} WHERE id=?{scope}", (*data.values(), id, *args))
    row = db.one(f"SELECT * FROM {table} WHERE id=?{scope}", (id, *args))
    if not row:
        raise HTTPException(404)
    return row


# ---------- health, workspace & settings ----------
@app.get("/api/health")
async def health():
    s = db.get_settings()
    try:
        models = await llm.ollama_models(s["llm_api_base"])
    except Exception:
        models = None
    return {"ok": True, "ollama": models is not None, "model": s["llm_model"], "models": models or [],
            "share": SHARE, "share_url": os.environ.get("ENVOY_SHARE_URL", "")}


def _ws_out(w: dict, owner: bool) -> dict:
    counts = {t: db.one(f"SELECT COUNT(*) n FROM {t} WHERE workspace_id=?", (w["id"],))["n"] for t in db.SCOPED}
    out = {**w, "counts": counts}
    if not owner:
        out.pop("share_code", None)
    return out


@app.get("/api/workspace")
def current_workspace(c: Ctx = Depends(ctx)):
    return {**_ws_out(db.one("SELECT * FROM workspaces WHERE id=?", (c.ws,)), c.owner), "guest": not c.owner}


class Workspace(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    conference: str = ""
    dates: str = ""
    delegate_country: str = ""
    committee: str = ""
    topic: str = ""


@app.get("/api/workspaces")
def list_workspaces(_: Ctx = Depends(owner)):
    return [_ws_out(w, True) for w in db.rows("SELECT * FROM workspaces ORDER BY id DESC")]


@app.post("/api/workspaces")
def create_workspace(w: Workspace, _: Ctx = Depends(owner)):
    id = db.execute("INSERT INTO workspaces(name, conference, dates, delegate_country, committee, topic) VALUES(?,?,?,?,?,?)",
                    (w.name, w.conference, w.dates, w.delegate_country, w.committee, w.topic))
    return _ws_out(db.one("SELECT * FROM workspaces WHERE id=?", (id,)), True)


@app.patch("/api/workspaces/{id}")
def update_workspace(id: int, body: dict, _: Ctx = Depends(owner)):
    return _ws_out(patch("workspaces", id, body, set(Workspace.model_fields)), True)


@app.delete("/api/workspaces/{id}")
def delete_workspace(id: int, _: Ctx = Depends(owner)):
    if db.one("SELECT COUNT(*) n FROM workspaces")["n"] <= 1:
        raise HTTPException(400, "You need at least one workspace")
    rag.remove_workspace(id, db.get_settings())
    with db.tx() as c:
        for t in db.SCOPED:
            c.execute(f"DELETE FROM {t} WHERE workspace_id=?", (id,))
        c.execute("DELETE FROM workspaces WHERE id=?", (id,))
    return {"ok": True}


@app.post("/api/workspaces/{id}/share")
def share_workspace(id: int, body: dict, _: Ctx = Depends(owner)):
    w = patch("workspaces", id, {}, set())
    code = w["share_code"]
    if body.get("regenerate") or not code:
        raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
        code = f"{raw[:5]}-{raw[5:]}"
    db.execute("UPDATE workspaces SET share_on=?, share_code=? WHERE id=?", (1 if body.get("on", True) else 0, code, id))
    return _ws_out(db.one("SELECT * FROM workspaces WHERE id=?", (id,)), True)


@app.get("/api/settings")
def get_settings(c: Ctx = Depends(ctx)):
    s = db.mask(db.get_settings(c.ws))
    return s if c.owner else {k: v for k, v in s.items() if k not in db.SECRET_KEYS}


@app.put("/api/settings")
def put_settings(body: dict, c: Ctx = Depends(ctx)):
    body = {k: v for k, v in body.items() if not (k in db.SECRET_KEYS and str(v).startswith("••••"))}
    if not c.owner:  # guests may edit the shared delegation profile only
        body = {k: v for k, v in body.items() if k in db.PROFILE_KEYS}
    db.save_settings(body, c.ws)
    return get_settings(c)


@app.post("/api/settings/reset")
def reset_settings(c: Ctx = Depends(owner)):
    db.execute("DELETE FROM settings")
    return db.mask(db.get_settings(c.ws))


# ---------- tasks (kanban) ----------
class Task(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str = ""
    status: str = "todo"
    priority: str = "med"


@app.get("/api/tasks")
def list_tasks(c: Ctx = Depends(ctx)):
    return db.rows("SELECT * FROM tasks WHERE workspace_id=? ORDER BY position, id", (c.ws,))


@app.post("/api/tasks")
def create_task(t: Task, c: Ctx = Depends(ctx)):
    pos = (db.one("SELECT MAX(position) m FROM tasks WHERE workspace_id=?", (c.ws,))["m"] or 0) + 1
    id = db.execute("INSERT INTO tasks(title, notes, status, priority, position, workspace_id) VALUES(?,?,?,?,?,?)",
                    (t.title, t.notes, t.status, t.priority, pos, c.ws))
    return db.one("SELECT * FROM tasks WHERE id=?", (id,))


@app.patch("/api/tasks/{id}")
def update_task(id: int, body: dict, c: Ctx = Depends(ctx)):
    return patch("tasks", id, body, {"title", "notes", "status", "priority", "position"}, c.ws)


@app.delete("/api/tasks/{id}")
def delete_task(id: int, c: Ctx = Depends(ctx)):
    db.execute("DELETE FROM tasks WHERE id=? AND workspace_id=?", (id, c.ws))
    return {"ok": True}


# ---------- documents (RAG vault) ----------
@app.get("/api/docs")
def list_docs(c: Ctx = Depends(ctx)):
    return db.rows("SELECT id, name, chunks, length(markdown) chars, created FROM documents WHERE workspace_id=? ORDER BY id DESC", (c.ws,))


@app.get("/api/docs/{id}")
def get_doc(id: int, c: Ctx = Depends(ctx)):
    if not (d := db.one("SELECT * FROM documents WHERE id=? AND workspace_id=?", (id, c.ws))):
        raise HTTPException(404)
    return d


@app.post("/api/docs")
async def upload_docs(files: list[UploadFile], c: Ctx = Depends(ctx)):
    s, results = db.get_settings(c.ws), []
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        data = await f.read()
        if ext not in ALLOWED_EXT or len(data) > MAX_UPLOAD:
            results.append({"name": f.filename, "error": "Unsupported type or larger than 50 MB"})
            continue
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
        try:
            md = await run_in_threadpool(rag.parse, tmp.name)
            if not md:
                raise ValueError("No extractable text (scanned PDF? run OCR first)")
            id = db.execute("INSERT INTO documents(name, markdown, workspace_id) VALUES(?,?,?)", (f.filename, md, c.ws))
            try:
                n = await rag.index(id, f.filename, md, s, c.ws)
            except Exception:
                db.execute("DELETE FROM documents WHERE id=?", (id,))
                raise
            db.execute("UPDATE documents SET chunks=? WHERE id=?", (n, id))
            results.append({"name": f.filename, "id": id, "chunks": n})
        except Exception as e:
            results.append({"name": f.filename, "error": f"{type(e).__name__}: {e}"[:300]})
        finally:
            os.unlink(tmp.name)
    return results


@app.delete("/api/docs/{id}")
def delete_doc(id: int, c: Ctx = Depends(ctx)):
    if db.one("SELECT 1 FROM documents WHERE id=? AND workspace_id=?", (id, c.ws)):
        rag.remove(id, db.get_settings())
        db.execute("DELETE FROM documents WHERE id=?", (id,))
    return {"ok": True}


@app.post("/api/docs/reindex")
async def reindex(c: Ctx = Depends(owner)):
    """Re-chunk and re-embed every workspace's documents (after changing chunk size or embedding model)."""
    s = db.get_settings()
    for d in db.rows("SELECT id, name, markdown, workspace_id FROM documents"):
        n = await rag.index(d["id"], d["name"], d["markdown"], s, d["workspace_id"])
        db.execute("UPDATE documents SET chunks=? WHERE id=?", (n, d["id"]))
    return list_docs(c)


# ---------- drafts ----------
class Draft(BaseModel):
    title: str = "Untitled draft"
    content: str = ""


@app.get("/api/drafts")
def list_drafts(c: Ctx = Depends(ctx)):
    return db.rows("SELECT * FROM drafts WHERE workspace_id=? ORDER BY updated DESC", (c.ws,))


@app.post("/api/drafts")
def create_draft(d: Draft, c: Ctx = Depends(ctx)):
    id = db.execute("INSERT INTO drafts(title, content, workspace_id) VALUES(?,?,?)", (d.title, d.content, c.ws))
    return db.one("SELECT * FROM drafts WHERE id=?", (id,))


@app.put("/api/drafts/{id}")
def save_draft(id: int, d: Draft, c: Ctx = Depends(ctx)):
    db.execute("UPDATE drafts SET title=?, content=?, updated=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?",
               (d.title, d.content, id, c.ws))
    return {"ok": True}


@app.delete("/api/drafts/{id}")
def delete_draft(id: int, c: Ctx = Depends(ctx)):
    db.execute("DELETE FROM drafts WHERE id=? AND workspace_id=?", (id, c.ws))
    return {"ok": True}


# ---------- clause bank & flashcards (shared across workspaces) ----------
class Clause(BaseModel):
    kind: str = "custom"
    phrase: str = Field(min_length=1)
    example: str = ""
    topic: str = ""


@app.get("/api/clauses")
def list_clauses(_: Ctx = Depends(ctx)):
    return db.rows("SELECT * FROM clauses ORDER BY CASE kind WHEN 'preambulatory' THEN 0 WHEN 'operative' THEN 1 ELSE 2 END, phrase")


@app.post("/api/clauses")
def add_clause(c: Clause, _: Ctx = Depends(ctx)):
    id = db.execute("INSERT INTO clauses(kind, phrase, example, topic) VALUES(?,?,?,?)", (c.kind, c.phrase, c.example, c.topic))
    return db.one("SELECT * FROM clauses WHERE id=?", (id,))


@app.patch("/api/clauses/{id}")
def update_clause(id: int, body: dict, _: Ctx = Depends(ctx)):
    return patch("clauses", id, body, {"phrase", "example", "topic"})


@app.delete("/api/clauses/{id}")
def delete_clause(id: int, _: Ctx = Depends(owner)):
    db.execute("DELETE FROM clauses WHERE id=?", (id,))
    return {"ok": True}


class Card(BaseModel):
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)
    deck: str = "Custom"


@app.get("/api/flashcards")
def list_cards(_: Ctx = Depends(ctx)):
    return db.rows("SELECT * FROM flashcards ORDER BY deck, id")


@app.post("/api/flashcards")
def add_card(c: Card, _: Ctx = Depends(ctx)):
    id = db.execute("INSERT INTO flashcards(front, back, deck) VALUES(?,?,?)", (c.front, c.back, c.deck))
    return db.one("SELECT * FROM flashcards WHERE id=?", (id,))


@app.patch("/api/flashcards/{id}")
def update_card(id: int, body: dict, _: Ctx = Depends(ctx)):
    return patch("flashcards", id, body, {"front", "back", "deck", "known"})


@app.delete("/api/flashcards/{id}")
def delete_card(id: int, _: Ctx = Depends(owner)):
    db.execute("DELETE FROM flashcards WHERE id=?", (id,))
    return {"ok": True}


# ---------- AI (streamed NDJSON: {"sources":[...]} then {"t": token}... or {"error": msg}) ----------
class AIRequest(BaseModel):
    text: str = Field(min_length=1, max_length=60_000)
    instruction: str = ""
    target: str = ""
    topic: str = ""
    doc_ids: list[int] | None = None
    history: list[dict] = []


@app.post("/api/ai/{task}")
async def ai(task: str, r: AIRequest, c: Ctx = Depends(ctx)):
    if task not in llm.PROMPTS:
        raise HTTPException(404, "Unknown task")
    s = db.get_settings(c.ws)

    async def gen():
        try:
            sources, context = [], ""
            if task in llm.RAG_TASKS:
                sources = await rag.search(r.text, s, c.ws, r.doc_ids)
                context = rag.context(sources) or "(no documents in the vault)"
                yield llm.ndjson({"sources": sources})
            user = r.text
            if task == "assist":
                user = f"Instruction: {r.instruction or 'Improve clarity and persuasiveness.'}\n\nText:\n{r.text}"
            elif task == "counter":
                user = f"Topic: {r.topic or s['topic'] or 'unspecified'}\n\nMy position:\n{r.text}"
            elif task == "rebut":
                user = f"Opponent's argument ({r.target or 'unspecified delegation'}):\n{r.text}"
            history = [m for m in r.history[-8:] if m.get("role") in ("user", "assistant")]
            messages = [{"role": "system", "content": llm.system_prompt(task, s, context, r.target, r.topic)},
                        *[{"role": m["role"], "content": str(m.get("content", ""))} for m in history],
                        {"role": "user", "content": user}]
            async for t in llm.stream(messages, s):
                yield llm.ndjson({"t": t})
        except Exception as e:
            yield llm.ndjson({"error": f"{type(e).__name__}: {e}"[:500]})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# ---------- exports ----------
@app.get("/api/export", response_class=HTMLResponse)
def export_binder(c: Ctx = Depends(ctx)):
    html = export.binder(db.get_settings(c.ws), list_tasks(c), list_drafts(c),
                         db.rows("SELECT id, name, markdown FROM documents WHERE workspace_id=? ORDER BY name", (c.ws,)),
                         list_clauses(c), list_cards(c))
    return HTMLResponse(html, headers={"Content-Disposition": f'attachment; filename="envoy-binder-{date.today()}.html"'})


def _filename(title: str, ext: str) -> str:
    name = re.sub(r"[^\w\- ]+", "", title).strip().replace(" ", "_") or "Position_Paper"
    return f'attachment; filename="{name}.{ext}"'


class DocxRequest(BaseModel):
    markdown: str = Field(min_length=1, max_length=300_000)
    title: str = "Position Paper"
    style: str = "envoy"


@app.post("/api/export/docx")
def export_docx(r: DocxRequest, c: Ctx = Depends(ctx)):
    data = docx_export.build(r.markdown, db.get_settings(c.ws), r.style, r.title)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": _filename(r.title, "docx")})


def _chrome() -> str | None:
    for p in (os.environ.get("ENVOY_CHROME", ""), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"):
        if p and os.path.exists(p):
            return p
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")


class PdfRequest(BaseModel):
    html: str = Field(min_length=1, max_length=5_000_000)
    title: str = "Position Paper"


@app.post("/api/export/pdf")
def export_pdf(r: PdfRequest, _: Ctx = Depends(ctx)):
    """Prints the exact preview HTML (sent by the browser) with headless Chrome, so the PDF matches the preview."""
    chrome = _chrome()
    if not chrome:
        raise HTTPException(501, "No Chrome/Chromium/Edge found for PDF rendering")
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d) / "paper.html", Path(d) / "paper.pdf"
        src.write_text(r.html, encoding="utf-8")
        # No --user-data-dir: with it Chrome writes the PDF but never exits. Headless uses a throwaway profile anyway.
        try:
            subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", src.as_uri()],
                           capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            pass  # a lingering browser is fine if the file was written
        if not out.exists():
            raise HTTPException(500, "PDF rendering failed")
        return Response(out.read_bytes(), media_type="application/pdf", headers={"Content-Disposition": _filename(r.title, "pdf")})
