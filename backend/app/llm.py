"""LiteLLM routing: local Ollama by default, cloud providers via Settings."""
import json
from collections.abc import AsyncIterator

import httpx
import litellm

from . import db

litellm.telemetry = False
litellm.drop_params = True  # tolerate params some providers don't accept

CITE = "Cite sources inline as [n] right after the claim they support. Never invent sources or statistics."

PAPER_TEMPLATE = """Output ONLY Markdown in exactly this structure:
**Committee:** <committee>
**Topic:** <topic>
**Country:** <country>
**Delegate:** <delegate name, or omit the line if unknown>

## Background
2-3 short paragraphs framing why the issue matters now.

> <One memorable sentence that captures the country's core message - the line a chair would remember.>

## Past International Action
Key treaties, resolutions and programmes (bold their names, e.g. **UNEA Resolution 5/14**) and what they achieved or lacked.

## National Policy
The country's record, domestic laws, votes and stance - specific and proud but diplomatic.

## Proposed Solutions
1. **<Short bold lead-in>** - one or two sentences on the measure, who implements it, and how it is funded or monitored.
2. ... (3 to 5 numbered proposals)

## Conclusion
One short paragraph that closes on cooperation and restates the key commitment.

Rules: no H1 heading, no preamble or closing remarks, no emoji, keep [n] citations exactly as written."""

PROMPTS = {
    "chat": ("You are Envoy, a research assistant for a Model UN delegate{who}. Answer using ONLY the numbered sources "
             "below. " + CITE + " If the sources do not contain the answer, say so plainly.\n\nSOURCES:\n{context}"),
    "tone": ("You are a senior diplomat. Rewrite the user's text in a formal, measured, diplomatic register suitable for "
             "a UN committee floor: courteous, precise, non-inflammatory, third-person where appropriate. Preserve every "
             "substantive point and fact. Return ONLY the rewritten text, no preamble."),
    "format": ("You are an award-winning Model UN head delegate writing a Position Paper{who}.{profile} Turn the "
               "user's notes into a polished, persuasive paper that is a pleasure to read: confident topic sentences, "
               "concrete facts, varied sentence length, no filler, formal diplomatic register. Keep every fact the user "
               "gave; never invent statistics - write [citation needed] where evidence should go. " + PAPER_TEMPLATE),
    "polish": ("You are a meticulous layout editor for Model UN Position Papers{who}.{profile} Reformat the user's "
               "Markdown into the house structure below WITHOUT changing its substance: keep the author's sentences, "
               "facts and citations; you may only move text into the right section, split walls of text into "
               "paragraphs, fix heading levels, turn proposals into the numbered list format, choose the key message "
               "quote from the author's own words, and bold a few key terms. " + PAPER_TEMPLATE),
    "assist": ("You are an expert Model UN speechwriter and editor{who}. Apply the user's instruction to the text. "
               "Return ONLY the resulting text in Markdown."),
    "counter": ("You simulate the delegation of {target} in a Model UN committee{on}. The user represents {country}. "
                "Produce the 5 strongest counter-arguments {target} would raise against the user's position. For each: "
                "### a short title, **Argument** (as {target} would say it on the floor), **Underlying interest** "
                "(the real national motive), **Pressure point** (where the user's position is weakest), and "
                "**Suggested response** for the user. Stay faithful to {target}'s real-world foreign policy. Markdown only."),
    "rebut": ("You are a fact-checker preparing rebuttals for a Model UN delegate{who}. For each claim in the opponent's "
              "argument, find factual counter-evidence in the numbered sources. " + CITE + " Format: ### Claim, then "
              "**Rebuttal** with citations. If the sources contain nothing relevant for a claim, write 'No local "
              "evidence found - research further.'\n\nSOURCES:\n{context}"),
}
RAG_TASKS = {"chat", "rebut"}


def _creds(s: dict, model: str, base: str) -> dict:
    kw = {}
    if model.startswith(("ollama/", "ollama_chat/")) or s["llm_provider"] == "openai_compatible":
        kw["api_base"] = base or None
    if s["llm_api_key"] and not model.startswith(("ollama/", "ollama_chat/")):
        kw["api_key"] = s["llm_api_key"]
    return kw


def system_prompt(task: str, s: dict, context: str = "", target: str = "", topic: str = "") -> str:
    country, committee = s["delegate_country"], s["committee"]
    who = f" representing {country}" if country else ""
    who += f" in {committee}" if committee else ""
    topic = topic or s["topic"]
    profile = " ".join(f"{k}: {v}." for k, v in (("Country", country), ("Committee", committee), ("Topic", topic)) if v)
    profile = f" Delegate profile - {profile}" if profile else ""
    return PROMPTS[task].format(who=who, context=context, target=target or "the opposing delegation", profile=profile,
                                country=country or "the user's country", on=f" on '{topic}'" if topic else "")


async def stream(messages: list[dict], s: dict) -> AsyncIterator[str]:
    resp = await litellm.acompletion(model=s["llm_model"], messages=messages, stream=True,
                                     temperature=float(s["llm_temperature"]), max_tokens=int(s["llm_max_tokens"]),
                                     **_creds(s, s["llm_model"], s["llm_api_base"]))
    async for chunk in resp:
        if delta := chunk.choices[0].delta.content:
            yield delta


async def embed(texts: list[str], s: dict) -> list[list[float]]:
    out = []
    for i in range(0, len(texts), 32):  # batch to keep Ollama memory flat
        r = await litellm.aembedding(model=s["embed_model"], input=texts[i:i + 32],
                                     **_creds(s, s["embed_model"], s["embed_api_base"]))
        out += [d["embedding"] for d in r.data]
    return out


async def ollama_tags(base: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=3) as c:
        r = await c.get(f"{base.rstrip('/')}/api/tags")
        r.raise_for_status()
        return r.json().get("models", [])


async def ollama_models(base: str) -> list[str]:
    return [m["name"] for m in await ollama_tags(base)]


async def autodetect_model() -> None:
    """First run only: if the user never chose a model, pick the most capable installed local chat model."""
    if db.one("SELECT 1 FROM settings WHERE key='llm_model'"):
        return
    try:
        tags = await ollama_tags(db.get_settings()["llm_api_base"])
    except Exception:
        return
    chat = sorted((m for m in tags if "embed" not in m["name"]), key=lambda m: m.get("size", 0))
    # ponytail: size as a proxy for quality; cap at ~12 GB so an 8-16 GB Mac stays responsive
    fits = [m for m in chat if m.get("size", 0) <= 12e9] or chat
    if fits and not any(m["name"].startswith("llama3.2") for m in chat):
        db.save_settings({"llm_model": f"ollama/{fits[-1]['name']}"})


def ndjson(obj: dict) -> str:
    return json.dumps(obj) + "\n"
