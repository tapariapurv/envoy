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
# web research: trusted-source rules, motion parsing, balanced passage selection
from app import websearch as w
allow, block, mine = w.rules({"trusted_use_default": True, "trusted_custom": "https://www.MySource.org/x\n-theguardian.com\n# note"})
assert len(w.builtin()) > 900 and mine == ["mysource.org"]
assert all(w.trusted(u, allow, block) for u in ("https://news.un.org/a", "https://www.state.gov/b", "https://x.mysource.org/"))
assert not any(w.trusted(u, allow, block) for u in ("https://www.theguardian.com/a", "https://evil-un.org/", "https://un.org.evil.com/"))
assert w.site_groups(allow, block, mine)[0] == ["mysource.org"] and all("theguardian.com" not in g for g in w.site_groups(allow, block, mine))
assert w.subject("THBT social media does more harm than good.") == "social media does more harm than good"
assert w.subject("This House would ban zoos") == "ban zoos"
assert w.parse_queries('Sure:\n["a b c", "d e"]') == ["a b c", "d e"] and w.parse_queries("1. x y\n- z w") == ["x y", "z w"]
ps = [{"url": f"u{i % 3}", "text": str(i)} for i in range(9)]
picked = w.select(ps, [[9 - i for i in range(9)], [i for i in range(9)]], ["Prop", "Opp"], 6, per_url=2)
assert [p["angle"] for p in picked] == ["Prop", "Opp"] * 3 and len({p["text"] for p in picked}) == 6
print("ok")
