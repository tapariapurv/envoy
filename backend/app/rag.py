"""Document parsing (MarkItDown), chunking, and local vector search (ChromaDB)."""
import re
from functools import cache

from . import db, llm


def chunk(text: str, size: int, overlap: int) -> list[str]:
    """Paragraph-aware splitter: packs paragraphs up to `size` chars, carries `overlap` chars forward."""
    size, overlap = max(200, int(size)), max(0, min(int(overlap), int(size) // 2))
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out, cur = [], ""
    for p in paras:
        while len(p) > size:  # hard-split giant paragraphs (tables, PDFs without breaks)
            cut = p.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            head, p = p[:cut], p[cut:].lstrip()
            if cur:
                out.append(cur)
                cur = ""
            out.append(head)
        if cur and len(cur) + len(p) + 2 > size:
            out.append(cur)
            cur = cur[-overlap:] if overlap else ""
        cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        out.append(cur)
    return out


@cache
def _md():
    from markitdown import MarkItDown
    return MarkItDown(enable_plugins=False)


def parse(path: str) -> str:
    return _md().convert(path).text_content.strip()


@cache
def _client():
    import chromadb
    return chromadb.PersistentClient(path=str(db.DATA_DIR / "chroma"),
                                     settings=chromadb.Settings(anonymized_telemetry=False))


def collection(s: dict):
    # One collection per embedding model: vectors from different models are incompatible.
    name = "docs_" + re.sub(r"[^a-zA-Z0-9_-]", "_", s["embed_model"])[:50]
    return _client().get_or_create_collection(name, metadata={"hnsw:space": "cosine"})


async def index(doc_id: int, name: str, markdown: str, s: dict, ws: int) -> int:
    parts = chunk(markdown, s["rag_chunk_size"], s["rag_chunk_overlap"])
    if not parts:
        return 0
    vecs = await llm.embed(parts, s)
    col = collection(s)
    col.delete(where={"doc_id": doc_id})
    col.add(ids=[f"{doc_id}:{i}" for i in range(len(parts))], documents=parts, embeddings=vecs,
            metadatas=[{"doc_id": doc_id, "name": name, "idx": i, "workspace_id": ws} for i in range(len(parts))])
    return len(parts)


def remove(doc_id: int, s: dict) -> None:
    collection(s).delete(where={"doc_id": doc_id})


def remove_workspace(ws: int, s: dict) -> None:
    collection(s).delete(where={"workspace_id": ws})


async def search(query: str, s: dict, ws: int, doc_ids: list[int] | None = None) -> list[dict]:
    col = collection(s)
    if not col.count():
        return []
    [vec] = await llm.embed([query], s)
    where = {"$and": [{"workspace_id": ws}, {"doc_id": {"$in": doc_ids}}]} if doc_ids else {"workspace_id": ws}
    r = col.query(query_embeddings=[vec], n_results=min(int(s["rag_top_k"]), col.count()), where=where)
    if not r["ids"][0]:
        return []
    return [{"n": i + 1, "doc_id": m["doc_id"], "name": m["name"], "chunk": m["idx"], "text": d,
             "score": round(1 - dist, 3)}
            for i, (d, m, dist) in enumerate(zip(r["documents"][0], r["metadatas"][0], r["distances"][0]))]


def context(sources: list[dict]) -> str:
    return "\n\n".join(f"[{x['n']}] ({x['name']}, part {x['chunk'] + 1})\n{x['text']}" for x in sources)
