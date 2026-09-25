"""Run: cd backend && ENVOY_DATA=/tmp/envoy-test python -m tests.test_core"""
from app import db, export
from app.rag import chunk

text = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(20)) + "\n\n" + "x" * 5000
parts = chunk(text, 1000, 150)
assert all(len(p) <= 1000 + 150 + 2 for p in parts), max(map(len, parts))
assert "Paragraph 0" in parts[0] and "x" * 100 in parts[-1]
assert chunk("", 1000, 100) == []
assert chunk("short", 1000, 5000) == ["short"]  # overlap clamps, no crash

db.init()
assert db.mask({"llm_api_key": "sk-abcdef1234", "x": 1}) == {"llm_api_key": "••••1234", "x": 1}
s = db.save_settings({"wpm": 170, "not_a_setting": 1})
assert s["wpm"] == 170 and "not_a_setting" not in s

html = export.binder(s, [{"status": "todo", "priority": "high", "title": "<b>x</b>", "notes": ""}], [], [], [], [])
assert "&lt;b&gt;x&lt;/b&gt;" in html and "Content-Security-Policy" in html
from app import docx_export
title, meta, body = docx_export.split_meta("# Paper\n**Committee:** UNEP\nTopic: Plastics\n**Delegate:**\n**Country**: Kenya\n\n## Background\nTopic sentences matter.")
assert title == "Paper" and meta == {"committee": "UNEP", "topic": "Plastics", "country": "Kenya"}, meta
assert body.startswith("## Background") and "Topic sentences" in body
import io, docx
d = docx.Document(io.BytesIO(docx_export.build("**Country:** Kenya\n\n## A\nx - y [1]\n\n1. **Cap** - z", {}, "classic")))
styles = [p.style.name for p in d.paragraphs]
assert "Title" in styles and "Heading 1" in styles and "List Number" in styles, styles  # conference style keeps Word lists
assert "\u2013" in d.paragraphs[-2].text or any("\u2013" in p.text for p in d.paragraphs)
# workspaces: profile is per workspace, globals are shared
w2 = db.execute("INSERT INTO workspaces(name) VALUES('HMUN')")
db.save_settings({"delegate_country": "Brazil", "wpm": 160}, w2)
assert db.get_settings(w2)["delegate_country"] == "Brazil" and db.get_settings(1)["delegate_country"] != "Brazil"
assert db.get_settings(1)["wpm"] == 160
# debate workspaces: kind migrates in, profile + kind reach the prompts, debate seeds exist
from app import llm
d = db.execute("INSERT INTO workspaces(name, kind) VALUES('Worlds', 'debate')")
db.save_settings({"format": "bp", "side": "Opening Government", "topic": "THW ban zoos"}, d)
ds = db.get_settings(d)
assert ds["kind"] == "debate" and ds["side"] == "Opening Government" and db.get_settings(1)["kind"] == "mun"
p = llm.system_prompt("breakdown", ds)
assert "British Parliamentary" in p and "THW ban zoos" in p and "extensions" in p and "Model UN" not in p
assert "Model UN" in llm.system_prompt("chat", db.get_settings(1)) and "debater" in llm.system_prompt("chat", ds)
assert all("{" not in llm.system_prompt(t, ds) for t in llm.PROMPTS)  # every placeholder filled
assert db.one("SELECT 1 FROM flashcards WHERE deck='Debate'") and db.one("SELECT 1 FROM motions")
from fastapi.testclient import TestClient
from app import main
main.SHARE = True
api = TestClient(main.app, client=("127.0.0.1", 5000))
r = api.post("/api/rounds", json={"name": "R1", "result": "win", "speaks": 76.5}, headers={"X-Workspace": str(d)}).json()
assert r["workspace_id"] == d and api.get("/api/rounds", headers={"X-Workspace": "1"}).json() == []
assert api.post("/api/rounds", json={"name": {"x": 1}}, headers={"X-Workspace": str(d)}).status_code == 422
assert api.post("/api/workspaces", json={"name": "x", "kind": "evil"}).status_code == 422
code = api.post(f"/api/workspaces/{d}/share", json={"on": True}).json()["share_code"]
guest = TestClient(main.app, client=("10.0.0.9", 5000), headers={"X-Access-Code": code})
assert [x["id"] for x in guest.get("/api/rounds").json()] == [r["id"]]
assert guest.patch(f"/api/workspaces/{d}", json={"kind": "mun"}).status_code == 403
m = guest.post("/api/motions", json={"text": "THW test"}).json()
assert guest.delete(f"/api/motions/{m['id']}").status_code == 403 and api.delete(f"/api/motions/{m['id']}").json()["ok"]
api.delete(f"/api/workspaces/{d}")
assert not db.one("SELECT 1 FROM rounds WHERE workspace_id=?", (d,))
print("ok")
