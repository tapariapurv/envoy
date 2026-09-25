#!/usr/bin/env node
// One command to run Envoy: `npm run dev` from the project root.
// First run bootstraps everything (Python venv + deps, frontend node_modules), then starts
// the FastAPI backend (:8000) and Next.js frontend (:3000) together, moving to the next free port if taken. Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const backend = join(root, "backend"), frontend = join(root, "frontend");
const venv = join(backend, ".venv"), py = join(venv, "bin", "python");
const marker = join(venv, ".installed");
const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const log = (s) => console.log(c(36, "envoy ›"), s);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) { console.error(c(31, `\n✗ Failed: ${cmd} ${args.join(" ")}`)); process.exit(1); }
}
const has = (cmd) => spawnSync("which", [cmd]).status === 0;

// 1. Python backend deps (re-run when requirements.txt changes)
if (!existsSync(py)) {
  // chromadb/onnxruntime wheels lag new Python releases: prefer 3.12 / 3.13.
  const pick = ["python3.12", "python3.13", "python3.11", "python3"].find(has);
  if (!pick) { console.error(c(31, "Python 3 not found. Install it: brew install python@3.12")); process.exit(1); }
  log(`Creating Python virtualenv with ${pick}…`);
  run(pick, ["-m", "venv", venv]);
}
if (!existsSync(marker) || statSync(join(backend, "requirements.txt")).mtimeMs > statSync(marker).mtimeMs) {
  log("Installing Python dependencies (first run takes a few minutes)…");
  run(py, ["-m", "pip", "install", "-q", "--upgrade", "pip"]);
  run(py, ["-m", "pip", "install", "-r", join(backend, "requirements.txt")]);
  writeFileSync(marker, new Date().toISOString());
}

// 2. Frontend deps
if (!existsSync(join(frontend, "node_modules"))) {
  log("Installing frontend dependencies…");
  run("npm", ["install", "--no-fund", "--no-audit"], { cwd: frontend });
}

// 3. Ollama (optional: cloud providers work without it)
async function ollamaModels() {
  try { const r = await fetch("http://localhost:11434/api/tags"); return (await r.json()).models.map((m) => m.name); }
  catch { return null; }
}
let models = await ollamaModels();
if (!models && has("ollama")) {
  log("Starting Ollama…");
  spawn("ollama", ["serve"], { stdio: "ignore", detached: true }).unref();
  for (let i = 0; i < 20 && !models; i++) { await new Promise((r) => setTimeout(r, 500)); models = await ollamaModels(); }
}
if (!models) log(c(33, "Ollama isn't running — local AI is unavailable. Install from https://ollama.com or pick a cloud provider in Settings."));
else {
  if (!models.some((m) => !m.includes("embed"))) log(c(33, "No chat model installed. Run: ollama pull llama3.2"));
  if (!models.some((m) => m.startsWith("nomic-embed-text")) && !process.env.ENVOY_NO_PULL) {
    log("Pulling embedding model nomic-embed-text (≈270 MB, one time) in the background…");
    spawn("ollama", ["pull", "nomic-embed-text"], { stdio: "ignore" });
  }
}

// 4. Pick free ports (another app may already hold 3000/8000)
// A port is free only if we can bind it on IPv4 loopback AND all interfaces (macOS lets these overlap).
const bind = (port, host) => new Promise((ok) => {
  const srv = createServer().once("error", () => ok(false)).once("listening", () => srv.close(() => ok(true)));
  srv.listen(port, host);
});
// ...and nothing answers on it: macOS can let a test bind succeed while another server is listening.
const answers = (port) => new Promise((ok) => {
  const s = connect(port, "127.0.0.1").once("connect", () => { s.destroy(); ok(true); }).once("error", () => ok(false));
});
const free = async (port) => !(await answers(port)) && (await bind(port, "127.0.0.1")) && (await bind(port));
async function port(start) { for (let p = start; p < start + 20; p++) if (await free(p)) return p; throw new Error(`No free port near ${start}`); }
const apiPort = await port(8000), webPort = await port(3000);
const webUrl = `http://localhost:${webPort}`;
// `npm run share`: expose on the local network so teammates can join a workspace with its access code.
const share = process.argv.includes("--share");
const lan = Object.values(networkInterfaces()).flat().find((i) => i?.family === "IPv4" && !i.internal)?.address;
const shareUrl = share && lan ? `http://${lan}:${webPort}` : "";
if (apiPort !== 8000 || webPort !== 3000) log(c(33, `Default ports busy — using API :${apiPort}, app :${webPort}`));

// 5. Launch both servers with prefixed output
const procs = [];
function start(name, color, cmd, args, cwd, env, onLine) {
  // detached: Ctrl+C is handled by stop() below, which signals the whole process tree in order
  const p = spawn(cmd, args, { cwd, detached: true, env: { ...process.env, FORCE_COLOR: "1", PYTHONUNBUFFERED: "1", ...env } });
  const tag = c(color, name.padEnd(4));
  for (const stream of [p.stdout, p.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d; const lines = buf.split("\n"); buf = lines.pop();
      for (const l of lines) { console.log(`${tag} │ ${l}`); onLine?.(l); }
    });
  }
  p.on("exit", (code) => { if (!stopping) { console.log(c(31, `${name} exited (${code}). Stopping.`)); stop(); } });
  procs.push(p);
}
let stopping = false, opened = false;
// Next.js runs `next-server` in its own process group, so signal every descendant PID, not just our groups.
function descendants(root) {
  const rows = spawnSync("ps", ["-A", "-o", "pid=,ppid="]).stdout.toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const out = [], queue = [root];
  while (queue.length) {
    const pid = queue.shift();
    for (const [child, parent] of rows) if (parent === pid) { out.push(child); queue.push(child); }
  }
  return out;
}
const signal = (pids, sig) => pids.forEach((pid) => { try { process.kill(pid, sig); } catch {} });
function stop() {
  if (stopping) return;
  stopping = true;
  const pids = procs.flatMap((p) => [p.pid, ...descendants(p.pid)]);
  signal(pids, "SIGTERM");
  setTimeout(() => { signal(pids, "SIGKILL"); process.exit(0); }, 2500);
}
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);

start("api", 35, py, ["-m", "uvicorn", "app.main:app", "--host", share ? "0.0.0.0" : "127.0.0.1", "--port", String(apiPort), "--reload"], backend, {
  ENVOY_ORIGINS: `${webUrl},http://127.0.0.1:${webPort}`,
  ...(share && { ENVOY_SHARE: "1", ENVOY_SHARE_URL: shareUrl, ENVOY_ORIGIN_REGEX: `^https?://[^/]+:${webPort}$` }),
});
start("web", 32, join(frontend, "node_modules", ".bin", "next"), ["dev", "-p", String(webPort)], frontend,
  { NEXT_PUBLIC_API_PORT: String(apiPort), ...(share && lan && { ENVOY_LAN_HOST: lan }) }, (l) => {
  if (!opened && /Ready|Local:/.test(l)) {
    opened = true;
    log(c(1, `Envoy is running → ${webUrl}`));
    if (shareUrl) log(c(1, `Sharing on your network → ${shareUrl}  (teammates join with a workspace access code)`));
    if (process.platform === "darwin" && !process.env.ENVOY_NO_OPEN) spawn("open", [webUrl]);
  }
});
