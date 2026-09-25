"""SQLite storage (stdlib only). One file at data/envoy.db."""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get("ENVOY_DATA", Path(__file__).resolve().parents[2] / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "envoy.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  priority TEXT NOT NULL DEFAULT 'med' CHECK(priority IN ('low','med','high')),
  position REAL NOT NULL DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, markdown TEXT NOT NULL,
  chunks INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS drafts(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled draft',
  content TEXT NOT NULL DEFAULT '', updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS clauses(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('preambulatory','operative','custom')),
  phrase TEXT NOT NULL, example TEXT DEFAULT '', topic TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS flashcards(
  id INTEGER PRIMARY KEY, front TEXT NOT NULL, back TEXT NOT NULL,
  deck TEXT DEFAULT 'Rules of Procedure', known INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, conference TEXT DEFAULT '', dates TEXT DEFAULT '',
  delegate_country TEXT DEFAULT '', committee TEXT DEFAULT '', topic TEXT DEFAULT '',
  share_on INTEGER DEFAULT 0, share_code TEXT UNIQUE, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rounds(
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, name TEXT DEFAULT '', side TEXT DEFAULT '',
  opponent TEXT DEFAULT '', result TEXT DEFAULT '', speaks REAL, judge TEXT DEFAULT '', motion TEXT DEFAULT '',
  feedback TEXT DEFAULT '', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS flows(
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, title TEXT DEFAULT 'Untitled flow', format TEXT DEFAULT 'bp',
  data TEXT DEFAULT '{}', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS motions(
  id INTEGER PRIMARY KEY, text TEXT NOT NULL, theme TEXT DEFAULT '', info TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS web_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL, ts REAL NOT NULL);
"""
SCOPED = ("tasks", "documents", "drafts", "rounds", "flows")  # per-workspace; clauses, flashcards & motions are shared
PROFILE_KEYS = ("delegate_country", "committee", "topic", "format", "side", "team")  # stored on the workspace, not globally
WS_COLUMNS = {"kind": "TEXT NOT NULL DEFAULT 'mun'", "format": "TEXT DEFAULT ''", "side": "TEXT DEFAULT ''", "team": "TEXT DEFAULT ''"}

DEFAULT_SETTINGS = {
    # Profile
    "delegate_country": "", "committee": "", "topic": "",
    "format": "", "side": "", "team": "",  # debate workspaces (topic = the motion)
    # Appearance
    "theme": "system", "accent": "indigo", "font_scale": 1.0,
    # Timers (seconds)
    "timer_speaker": 60, "timer_mod_total": 600, "timer_mod_speaker": 45,
    "timer_unmod": 900, "timer_warning": 10, "timer_sound": True,
    # Teleprompter
    "wpm": 150, "prompter_font": 44, "prompter_mirror": False,
    # AI engine
    "llm_provider": "ollama", "llm_model": "ollama/llama3.2",
    "llm_api_base": "http://localhost:11434", "llm_api_key": "",
    "llm_temperature": 0.4, "llm_max_tokens": 1500,
    "embed_model": "ollama/nomic-embed-text", "embed_api_base": "http://localhost:11434",
    # RAG
    "rag_chunk_size": 1200, "rag_chunk_overlap": 200, "rag_top_k": 6,
    # Web research
    "web_search_provider": "duckduckgo", "web_search_key": "",
    "trusted_use_default": True, "trusted_custom": "",
}
SECRET_KEYS = {"llm_api_key", "web_search_key"}

PREAMBULATORY = ["Acknowledging", "Affirming", "Alarmed by", "Approving", "Aware of", "Bearing in mind",
    "Believing", "Confident", "Congratulating", "Convinced", "Declaring", "Deeply concerned",
    "Deeply conscious", "Deeply convinced", "Deeply disturbed", "Deeply regretting", "Desiring",
    "Emphasizing", "Expecting", "Expressing its appreciation", "Fulfilling", "Fully aware",
    "Further deploring", "Further recalling", "Guided by", "Having adopted", "Having considered",
    "Having examined", "Having heard", "Having received", "Keeping in mind", "Noting with deep concern",
    "Noting with satisfaction", "Noting further", "Observing", "Reaffirming", "Realizing", "Recalling",
    "Recognizing", "Referring", "Seeking", "Taking into account", "Taking note", "Viewing with appreciation",
    "Welcoming"]
OPERATIVE = ["Accepts", "Affirms", "Approves", "Authorizes", "Calls", "Calls upon", "Condemns",
    "Confirms", "Congratulates", "Considers", "Declares accordingly", "Deplores", "Designates",
    "Draws the attention", "Emphasizes", "Encourages", "Endorses", "Expresses its appreciation",
    "Expresses its hope", "Further invites", "Further proclaims", "Further recommends", "Further requests",
    "Further resolves", "Has resolved", "Notes", "Proclaims", "Reaffirms", "Recommends", "Regrets",
    "Reminds", "Requests", "Solemnly affirms", "Strongly condemns", "Supports", "Takes note of",
    "Transmits", "Trusts", "Urges"]
FLASHCARDS = [
    ("Point of Personal Privilege", "Raised when a delegate experiences personal discomfort that impairs participation (e.g. audibility, temperature). May interrupt a speaker."),
    ("Point of Order", "Raised when a delegate believes the Chair or a delegate has improperly followed the rules of procedure. May interrupt a speaker only if the error is urgent."),
    ("Point of Parliamentary Inquiry", "A question to the Chair about the rules of procedure. Cannot interrupt a speaker."),
    ("Point of Information", "A question to a speaker who has yielded to points of information. Must be phrased as a question."),
    ("Right of Reply", "Requested when a delegate's national integrity has been impugned by another delegate. Granted at the Chair's discretion."),
    ("Motion to Open Debate", "Begins formal debate on the agenda. Requires a simple majority."),
    ("Motion to Set the Agenda", "Chooses which topic is discussed first. Typically two speakers for, two against; simple majority."),
    ("Motion for a Moderated Caucus", "Must specify total time, speaking time, and purpose. Simple majority. The Chair calls on speakers."),
    ("Motion for an Unmoderated Caucus", "Must specify total time. Delegates move freely to negotiate and draft. Simple majority."),
    ("Motion to Close Debate (Cloture)", "Ends debate and moves into voting procedure. Usually two speakers against; requires a two-thirds majority."),
    ("Motion to Table / Postpone Debate", "Suspends debate on the current topic. Usually requires a two-thirds majority."),
    ("Motion to Suspend the Meeting", "Pauses the session (e.g. for lunch). Simple majority."),
    ("Motion to Adjourn the Meeting", "Ends the session for the conference. Usually only in the final session; simple majority."),
    ("Motion to Introduce a Draft Resolution", "Brings a draft resolution onto the floor once it has the required number of sponsors/signatories and Chair approval."),
    ("Friendly Amendment", "An amendment agreed to by all sponsors; incorporated without a vote."),
    ("Unfriendly Amendment", "An amendment not supported by all sponsors; requires signatories and a committee vote."),
    ("Yield to the Chair", "The speaker gives remaining time back to the Chair."),
    ("Yield to Another Delegate", "Remaining time is given to another delegate, who may not yield further."),
    ("Yield to Points of Information", "The speaker accepts questions from delegates for the remaining time."),
    ("Division of the Question", "Motion to vote on operative clauses of a resolution separately. Procedural vote on how to divide."),
    ("Roll Call Vote", "Each delegate votes aloud when called: Yes, No, Abstain, Pass (or 'with rights')."),
    ("Quorum", "The minimum number of members present to conduct business - often one-third to begin debate, a majority to vote on substance."),
    ("Sponsor vs. Signatory", "Sponsors authored and support the resolution; signatories only wish to see it debated and need not vote for it."),
    ("Simple vs. Qualified Majority", "Simple majority: more than half of members present and voting. Qualified (two-thirds): needed for cloture and some procedural motions."),
]
DEBATE_CARDS = [
    ("Point of Information (POI)", "A short question or statement offered to the opposing speaker during unprotected time. The speaker may accept or decline; accept 1-2 per speech."),
    ("Protected time", "The first and last minute of a speech (BP, Asians, WSDC) when POIs may not be offered. Marked by a single knock or bell."),
    ("Burden of proof", "What a side must prove to win. Usually set by the motion's wording and the definitions: e.g. 'This House would' requires a policy and its benefits."),
    ("Model", "The Proposition's concrete policy mechanism: who does what, how it is enforced and funded. Opposition may challenge but should not 'squirrel' the debate."),
    ("Squirrelling", "Defining the motion in an unreasonable or unexpected way to escape the core clash. Penalised by adjudicators."),
    ("Counter-model / counter-prop", "An alternative policy the Opposition proposes instead of the status quo. It must be mutually exclusive with the Proposition's model."),
    ("Clash", "The core points of disagreement between the sides. Good speakers identify 2-3 clashes and win them explicitly."),
    ("Weighing", "Comparing impacts to show why your arguments matter more: magnitude, probability, timeframe, reversibility, and who is affected."),
    ("Extension (BP)", "New material from a closing team that is distinct from its opening half and adds a new reason to win. Required to beat the opening team."),
    ("Member speech / Whip speech", "BP closing half: the Member brings the extension; the Whip summarises the debate by clashes and may not add new arguments."),
    ("Reply speech (WSDC / Asians)", "A biased summary by the 1st or 2nd speaker, Opposition first. No new arguments; shows why your side won the key clashes."),
    ("Dropped argument", "An argument the other side never responded to. Point it out: in most formats it is treated as conceded."),
    ("Crossfire (PF)", "A 3-minute period where both speakers question each other. Grand crossfire involves all four debaters."),
    ("Cross-examination (LD / Policy)", "A 3-minute question period where the previous speaker is questioned by an opponent. Used to set up arguments, not to make speeches."),
    ("Value & criterion (LD)", "The value is the ideal the resolution should be judged by (e.g. justice); the criterion is the standard for measuring whether that value is achieved."),
    ("Evidence card", "A quoted passage with a tag (the claim it proves) and a full citation. Used in PF, LD and Policy; paraphrasing a card misrepresents evidence."),
    ("Signposting", "Telling the judge where you are: 'I have two responses, then my extension.' It makes the flow easy to follow."),
    ("Speaker points", "Individual scores (e.g. 50-100 in BP, 60-80 in WSDC, 25-30 in US formats) reflecting style, content and strategy."),
]
MOTIONS = [
    ("This House would ban private schools", "Education"),
    ("This House believes that social media has done more harm than good for democracy", "Technology"),
    ("This House would implement a universal basic income", "Economics"),
    ("This House regrets the rise of influencer culture", "Culture"),
    ("This House would allow the sale of human organs", "Ethics"),
    ("This House supports the use of economic sanctions to promote human rights", "International relations"),
    ("This House would make voting compulsory", "Politics"),
    ("This House believes that developing nations should prioritise economic growth over environmental protection", "Environment"),
    ("This House would abolish the veto power in the UN Security Council", "International relations"),
    ("This House believes that the feminist movement should oppose the beauty industry", "Feminism"),
    ("This House would ban the development of lethal autonomous weapons", "Technology"),
    ("This House would tax meat", "Environment"),
    ("This House believes that art should never be separated from the artist", "Culture"),
    ("This House would give parents a vote on behalf of their children", "Politics"),
    ("This House regrets the glorification of hustle culture", "Culture"),
    ("This House would nationalise essential public utilities", "Economics"),
]


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextmanager
def tx():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def rows(sql: str, args=()) -> list[dict]:
    with tx() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def one(sql: str, args=()) -> dict | None:
    r = rows(sql, args)
    return r[0] if r else None


def execute(sql: str, args=()) -> int:
    with tx() as c:
        return c.execute(sql, args).lastrowid


def init() -> None:
    with tx() as c:
        c.executescript(SCHEMA)
        c.execute("DELETE FROM web_cache WHERE ts < strftime('%s','now') - 7*86400")
        if not c.execute("SELECT 1 FROM clauses LIMIT 1").fetchone():
            c.executemany("INSERT INTO clauses(kind, phrase) VALUES(?,?)",
                          [("preambulatory", p) for p in PREAMBULATORY] + [("operative", p) for p in OPERATIVE])
        if not c.execute("SELECT 1 FROM flashcards LIMIT 1").fetchone():
            c.executemany("INSERT INTO flashcards(front, back) VALUES(?,?)", FLASHCARDS)
        if not c.execute("SELECT 1 FROM flashcards WHERE deck='Debate' LIMIT 1").fetchone():
            c.executemany("INSERT INTO flashcards(front, back, deck) VALUES(?,?,'Debate')", DEBATE_CARDS)
        if not c.execute("SELECT 1 FROM motions LIMIT 1").fetchone():
            c.executemany("INSERT INTO motions(text, theme) VALUES(?,?)", MOTIONS)
        for t in SCOPED:  # migrate pre-workspace databases
            if "workspace_id" not in [r[1] for r in c.execute(f"PRAGMA table_info({t})")]:
                c.execute(f"ALTER TABLE {t} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1")
        have = [r[1] for r in c.execute("PRAGMA table_info(workspaces)")]
        for col, decl in WS_COLUMNS.items():
            if col not in have:
                c.execute(f"ALTER TABLE workspaces ADD COLUMN {col} {decl}")
        if not c.execute("SELECT 1 FROM workspaces LIMIT 1").fetchone():
            old = {r[0]: json.loads(r[1]) for r in c.execute("SELECT key, value FROM settings WHERE key IN ('delegate_country','committee','topic')")}
            c.execute("INSERT INTO workspaces(id, name, delegate_country, committee, topic) VALUES(1, 'My first conference', ?, ?, ?)",
                      (old.get("delegate_country", ""), old.get("committee", ""), old.get("topic", "")))


def get_settings(ws: int | None = None) -> dict:
    """Global settings, with the delegation profile taken from workspace `ws`."""
    stored = {r["key"]: json.loads(r["value"]) for r in rows("SELECT key, value FROM settings")}
    s = {**DEFAULT_SETTINGS, **stored}
    if ws and (w := one("SELECT * FROM workspaces WHERE id=?", (ws,))):
        s.update({k: w[k] for k in (*PROFILE_KEYS, "kind")})
    return s


def save_settings(patch: dict, ws: int | None = None) -> dict:
    prof = {k: str(v) for k, v in patch.items() if k in PROFILE_KEYS}
    with tx() as c:
        c.executemany("INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      [(k, json.dumps(v)) for k, v in patch.items() if k in DEFAULT_SETTINGS and k not in PROFILE_KEYS])
        if ws and prof:
            c.execute(f"UPDATE workspaces SET {', '.join(f'{k}=?' for k in prof)} WHERE id=?", (*prof.values(), ws))
    return get_settings(ws)


def first_ws() -> int:
    return one("SELECT id FROM workspaces ORDER BY id LIMIT 1")["id"]


def mask(s: dict) -> dict:
    """Never send secrets back to the browser in plaintext."""
    return {k: ("••••" + v[-4:] if k in SECRET_KEYS and v else v) for k, v in s.items()}
