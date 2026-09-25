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
print("ok")
