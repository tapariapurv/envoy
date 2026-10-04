"use client";
/**
 * The REST API the pages call (`api("/api/tasks")` …), served in the browser from Firestore.
 * Data model:
 *   users/{uid}                       { settings }            + clauses, flashcards, motions (personal)
 *   workspaces/{wid}                  { owner, members[], profile, share_on, share_code }
 *     tasks | documents | drafts | rounds | flows              (shared with every member)
 *   codes/{CODE}                      { ws }                  access code -> workspace (get only)
 */
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs,
  query, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import seed from "./seed.json";
import trusted from "./trusted.json";
import { parseFile } from "./exporters";

export const DEFAULT_SETTINGS = seed.defaults;
const PROFILE = ["delegate_country", "committee", "topic", "format", "side", "team"];
const WS_FIELDS = ["name", "conference", "dates", "kind", ...PROFILE];
const SCOPED: Record<string, string> = { tasks: "tasks", docs: "documents", drafts: "drafts", rounds: "rounds", flows: "flows" };
const PERSONAL = ["clauses", "flashcards", "motions"];
const DEFAULTS: Record<string, Record<string, unknown>> = {
  tasks: { title: "", notes: "", status: "todo", priority: "med", position: 0 },
  drafts: { title: "Untitled draft", content: "" },
  rounds: { name: "", side: "", opponent: "", result: "", speaks: null, judge: "", motion: "", feedback: "" },
  flows: { title: "Untitled flow", format: "bp", data: "{}" },
  clauses: { kind: "custom", phrase: "", example: "", topic: "" },
  flashcards: { front: "", back: "", deck: "Custom", known: 0 },
  motions: { text: "", theme: "", info: "" },
};
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
const MAX_DOC = 900_000; // Firestore documents cap at 1 MiB

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
type Row = Record<string, unknown> & { id: string };

const uid = () => { const u = auth.currentUser?.uid; if (!u) throw new ApiError(401, "Please sign in"); return u; };
const now = () => new Date().toISOString();
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => keys.includes(k) && v !== undefined));
const rows = async (path: string[]): Promise<Row[]> => (await getDocs(collection(db, path.join("/")))).docs.map((d) => ({ ...d.data(), id: d.id }));
const by = <T extends Row>(key: string, desc = false) => (a: T, b: T) => (String(a[key] ?? "") < String(b[key] ?? "") ? -1 : 1) * (desc ? -1 : 1);

// ---------- active workspace ----------
const store = (k: string, v?: string | null) => {
  try { if (v === undefined) return localStorage.getItem(k) ?? ""; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {}
  return "";
};
export const session = { get ws() { return store("envoy-ws"); }, setWs: (id: string) => store("envoy-ws", id) };

let cache: { uid: string; list: Row[] } | null = null;
async function myWorkspaces(fresh = false): Promise<Row[]> {
  const u = uid();
  if (!fresh && cache?.uid === u) return cache.list;
  let list = (await getDocs(query(collection(db, "workspaces"), where("members", "array-contains", u)))).docs.map((d) => ({ ...d.data(), id: d.id }) as Row);
  if (!list.length) { await createWorkspace({ name: "My first conference", kind: "mun" }); return myWorkspaces(true); }
  list = list.sort(by("created", true)).map((w) => ({ ...w, guest: w.owner !== u }));
  cache = { uid: u, list };
  return list;
}
async function current(): Promise<Row> {
  const list = await myWorkspaces();
  return list.find((w) => w.id === session.ws) ?? list[0];
}
const wsPath = async (col: string) => ["workspaces", (await current()).id, col];

async function withCounts(w: Row) {
  const counts = Object.fromEntries(await Promise.all(Object.values(SCOPED).map(async (c) =>
    [c, (await getCountFromServer(collection(db, "workspaces", w.id, c))).data().count])));
  return { ...w, counts, share_code: w.guest ? undefined : w.share_code };
}

async function createWorkspace(body: Record<string, unknown>) {
  const u = uid();
  const data = { ...Object.fromEntries(WS_FIELDS.map((k) => [k, ""])), kind: "mun", ...pick(body, WS_FIELDS), owner: u, members: [u], share_on: false, share_code: "", created: now() };
  const ref = await addDoc(collection(db, "workspaces"), data);
  cache = null;
  return { ...data, id: ref.id, guest: false };
}

async function deleteWorkspace(id: string) {
  const w = (await myWorkspaces()).find((x) => x.id === id);
  if (!w || w.guest) throw new ApiError(403, "Only the workspace owner can delete it");
  if ((await myWorkspaces()).filter((x) => !x.guest).length <= 1) throw new ApiError(400, "You need at least one workspace");
  for (const c of Object.values(SCOPED)) {
    const docs = (await getDocs(collection(db, "workspaces", id, c))).docs;
    for (let i = 0; i < docs.length; i += 450) { const b = writeBatch(db); docs.slice(i, i + 450).forEach((d) => b.delete(d.ref)); await b.commit(); }
  }
  if (w.share_code) await deleteDoc(doc(db, "codes", String(w.share_code))).catch(() => {});
  await deleteDoc(doc(db, "workspaces", id));
  cache = null;
}

async function share(id: string, body: { on?: boolean; regenerate?: boolean }) {
  const w = (await myWorkspaces()).find((x) => x.id === id);
  if (!w || w.guest) throw new ApiError(403, "Only the workspace owner can share it");
  let code = String(w.share_code || "");
  if (body.regenerate || !code) {
    const raw = Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
    if (code) await deleteDoc(doc(db, "codes", code)).catch(() => {});
    code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    await setDoc(doc(db, "codes", code), { ws: id, owner: w.owner });
  }
  await updateDoc(doc(db, "workspaces", id), { share_on: body.on ?? true, share_code: code });
  cache = null;
}

/** Join a workspace with its access code. Rules only let you add yourself, and only with the live code. */
export async function join(code: string) {
  const u = uid();
  const c = await getDoc(doc(db, "codes", code.toUpperCase())).catch(() => null);
  if (!c?.exists()) throw new ApiError(404, "That code didn't work. It may have been changed or sharing was turned off.");
  const ws = String(c.data().ws);
  try { await updateDoc(doc(db, "workspaces", ws), { members: arrayUnion(u), joinCode: code.toUpperCase() }); }
  catch { throw new ApiError(403, "That code didn't work. It may have been changed or sharing was turned off."); }
  cache = null;
  session.setWs(ws);
  return ws;
}

// ---------- settings ----------
async function getSettings() {
  const [u, w] = [await getDoc(doc(db, "users", uid())), await current()];
  if (!u.data()?.seeded) await seedUser();
  return { ...DEFAULT_SETTINGS, ...(u.data()?.settings ?? {}), ...pick(w, [...PROFILE, "kind"]) };
}
async function putSettings(body: Record<string, unknown>) {
  const prof = pick(body, PROFILE);
  const rest = Object.fromEntries(Object.entries(body).filter(([k, v]) => k in DEFAULT_SETTINGS && !PROFILE.includes(k) && v !== undefined));
  if (Object.keys(rest).length) await setDoc(doc(db, "users", uid()), { settings: rest }, { merge: true });
  if (Object.keys(prof).length) { await updateDoc(doc(db, "workspaces", (await current()).id), prof); cache = null; }
  return getSettings();
}

/** First sign-in: copy the clause bank, procedure cards and motion bank into the user's own collections. */
async function seedUser() {
  const u = uid(), b = writeBatch(db);
  for (const k of PERSONAL) for (const [i, x] of (seed as unknown as Record<string, object[]>)[k].entries())
    b.set(doc(collection(db, "users", u, k)), { ...DEFAULTS[k], ...x, created: `${now()}-${String(i).padStart(3, "0")}` });
  b.set(doc(db, "users", u), { seeded: true }, { merge: true });
  await b.commit();
}

// ---------- documents ----------
async function uploadDocs(fd: FormData) {
  const p = await wsPath("documents"), out = [];
  for (const f of fd.getAll("files") as File[]) {
    try {
      const md = (await parseFile(f)).trim();
      if (!md) throw new Error("No extractable text (scanned PDF? run OCR first)");
      const parts = Math.ceil(md.length / MAX_DOC);
      for (let i = 0; i < parts; i++) {
        const name = parts > 1 ? `${f.name} (part ${i + 1}/${parts})` : f.name;
        const markdown = md.slice(i * MAX_DOC, (i + 1) * MAX_DOC);
        const ref = await addDoc(collection(db, p.join("/")), { name, markdown, chars: markdown.length, created: now() });
        out.push({ name, id: ref.id });
      }
    } catch (e) { out.push({ name: f.name, error: String((e as Error).message).slice(0, 300) }); }
  }
  docsCache = null;
  return out;
}

let docsCache: { ws: string; docs: Row[] } | null = null;
/** Every document in the active workspace, with text (used by Research Hub search). */
export async function workspaceDocs(): Promise<Row[]> {
  const w = (await current()).id;
  if (docsCache?.ws !== w) docsCache = { ws: w, docs: await rows(["workspaces", w, "documents"]) };
  return docsCache.docs;
}

// ---------- router ----------
export async function handle(path: string, method: string, body?: unknown): Promise<unknown> {
  const [, , res, id, sub] = path.split("?")[0].split("/");
  const b = (body ?? {}) as Record<string, unknown>;
  const u = uid();

  if (res === "health") return { ok: true };
  if (res === "workspace") { const w = await current(); session.setWs(w.id); return w; }
  if (res === "workspaces") {
    if (!id) return method === "POST" ? createWorkspace(b) : Promise.all((await myWorkspaces(true)).map(withCounts));
    if (sub === "share") return share(id, b);
    if (sub === "leave") { await updateDoc(doc(db, "workspaces", id), { members: arrayRemove(u) }); cache = null; return { ok: true }; }
    if (method === "DELETE") return deleteWorkspace(id).then(() => ({ ok: true }));
    await updateDoc(doc(db, "workspaces", id), pick(b, WS_FIELDS.filter((k) => k !== "kind")));
    cache = null;
    return { ok: true };
  }
  if (res === "join") return { id: await join(String(b.code ?? "")) };
  if (res === "settings") {
    if (id === "reset") { await updateDoc(doc(db, "users", u), { settings: {} }); return getSettings(); }
    return method === "PUT" ? putSettings(b) : getSettings();
  }
  if (res === "research" && id === "sources") return { domains: trusted };

  const col = SCOPED[res], personal = PERSONAL.includes(res);
  if (!col && !personal) throw new ApiError(404, `Unknown endpoint ${path}`);
  const p = personal ? ["users", u, res] : await wsPath(col);
  if (res === "docs" && method === "POST") return uploadDocs(body as FormData);

  if (!id) {
    if (method === "POST") {
      const data: Record<string, unknown> = { ...DEFAULTS[col ?? res], ...pick(b, Object.keys(DEFAULTS[col ?? res] ?? {})), created: now() };
      if (col === "drafts") data.updated = now();
      if (col === "tasks") data.position = Math.max(0, ...(await rows(p)).map((t) => Number(t.position) || 0)) + 1;
      const ref = await addDoc(collection(db, p.join("/")), data);
      return { ...data, id: ref.id };
    }
    const list = await rows(p);
    if (res === "docs") return list.map(({ markdown, ...d }) => ({ ...d, chars: d.chars ?? String(markdown ?? "").length })).sort(by("created", true));
    if (res === "tasks") return list.sort((a, b) => Number(a.position) - Number(b.position));
    if (res === "drafts") return list.sort(by("updated", true));
    if (res === "clauses") { const o = { preambulatory: 0, operative: 1 } as Record<string, number>; return list.sort((a, b) => (o[String(a.kind)] ?? 2) - (o[String(b.kind)] ?? 2) || String(a.phrase).localeCompare(String(b.phrase))); }
    if (res === "flashcards") return list.sort((a, b) => String(a.deck).localeCompare(String(b.deck)) || by("created")(a, b));
    return list.sort(by("created", res === "rounds" || res === "flows"));
  }

  const ref = doc(db, [...p, id].join("/"));
  if (method === "DELETE") { await deleteDoc(ref); if (res === "docs") docsCache = null; return { ok: true }; }
  if (method === "GET") { const d = await getDoc(ref); if (!d.exists()) throw new ApiError(404, "Not found"); return { ...d.data(), id }; }
  const patch: Record<string, unknown> = pick(b, Object.keys(DEFAULTS[col ?? res] ?? {}));
  if (col === "drafts") patch.updated = now();
  await updateDoc(ref, patch);
  return { ...patch, id };
}
