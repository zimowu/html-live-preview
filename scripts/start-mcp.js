#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const defaultPort = 45731;

function projectRoot(input) {
  return path.resolve(input || process.env.CODEX_WORKSPACE || process.cwd());
}

function stateDir(root) {
  return path.join(root, ".codex-html-live-preview");
}

function ensureState(root) {
  fs.mkdirSync(stateDir(root), { recursive: true });
}

function previewFile(root, file) {
  return path.resolve(root, file || ".codex-html-live-preview/live.html");
}

function metaFile(root) {
  return path.join(stateDir(root), "server.json");
}

function adjustmentsFile(root) {
  return path.join(stateDir(root), "adjustments.json");
}

function initialHtmlFile(root) {
  return path.join(stateDir(root), "initial.html");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      bytes: stat.size,
      mtime: stat.mtime.toISOString()
    };
  } catch {
    return { exists: false, bytes: 0, mtime: null };
  }
}

async function runningState(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 700);
    const res = await fetch(`${url}/api/state`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const state = await res.json();
    if (!state.serverVersion) return null;
    return state;
  } catch {
    return null;
  }
}

async function startPreview(args = {}) {
  const root = projectRoot(args.workspace);
  const requestedPort = Number(args.port || defaultPort);
  const file = previewFile(root, args.file);
  ensureState(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, starterHtml(), "utf8");
  }
  if (!fs.existsSync(adjustmentsFile(root))) {
    fs.writeFileSync(adjustmentsFile(root), JSON.stringify(defaultAdjustments(), null, 2), "utf8");
  }
  if (!fs.existsSync(initialHtmlFile(root))) {
    fs.writeFileSync(initialHtmlFile(root), fs.readFileSync(file, "utf8"), "utf8");
  }

  const requestedUrl = `http://127.0.0.1:${requestedPort}`;
  const existing = readJson(metaFile(root), null);
  const existingState = existing?.url ? await runningState(existing.url) : null;
  if (existingState?.file === file) {
    return writeMetaAndReturn(root, existingState, true);
  }

  const firstPort = args.port ? requestedPort : defaultPort;
  const lastPort = args.port ? requestedPort : defaultPort + 20;
  for (let port = firstPort; port <= lastPort; port += 1) {
    const candidateUrl = `http://127.0.0.1:${port}`;
    const candidateState = await runningState(candidateUrl);
    if (candidateState?.file === file) {
      return writeMetaAndReturn(root, candidateState, true);
    }
  }

  let port = requestedPort;
  if (!args.port) {
    for (let candidate = defaultPort; candidate <= defaultPort + 20; candidate += 1) {
      const candidateState = await runningState(`http://127.0.0.1:${candidate}`);
      if (!candidateState) {
        port = candidate;
        break;
      }
    }
  }

  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    path.join(pluginRoot, "scripts/live-preview-server.js"),
    "--root", root,
    "--file", file,
    "--port", String(port)
  ], {
    cwd: pluginRoot,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  fs.writeFileSync(metaFile(root), JSON.stringify({
    pid: child.pid,
    url,
    file,
    adjustmentsFile: adjustmentsFile(root),
    initialHtmlFile: initialHtmlFile(root),
    startedAt: new Date().toISOString()
  }, null, 2), "utf8");
  return { url, file, adjustmentsFile: adjustmentsFile(root), initialHtmlFile: initialHtmlFile(root), pid: child.pid, reused: false };
}

function writeMetaAndReturn(root, state, reused) {
  const meta = {
    pid: state.pid || null,
    url: state.url,
    file: state.file,
    adjustmentsFile: state.adjustmentsPath || state.adjustmentsFile || adjustmentsFile(root),
    initialHtmlFile: state.initialHtmlPath || state.initialHtmlFile || initialHtmlFile(root),
    startedAt: state.startedAt || new Date().toISOString()
  };
  fs.writeFileSync(metaFile(root), JSON.stringify(meta, null, 2), "utf8");
  return { ...meta, reused };
}

async function updatePreview(args = {}) {
  if (typeof args.html !== "string") {
    throw new Error("html must be a string");
  }
  const root = projectRoot(args.workspace);
  const file = previewFile(root, args.file);
  ensureState(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, args.html, "utf8");
  return { file, bytes: Buffer.byteLength(args.html, "utf8") };
}

async function writePreviewSource(args = {}) {
  if (typeof args.html !== "string") {
    throw new Error("html must be a string");
  }
  const root = projectRoot(args.workspace);
  const file = previewFile(root, args.file);
  ensureState(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, args.html, "utf8");
  return {
    file,
    quiet: Boolean(args.quiet),
    bytes: Buffer.byteLength(args.html, "utf8"),
    info: fileInfo(file)
  };
}

async function readPreviewSource(args = {}) {
  const root = projectRoot(args.workspace);
  const file = previewFile(root, args.file);
  const html = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return {
    file,
    html,
    info: fileInfo(file)
  };
}

async function readPreviewState(args = {}) {
  const root = projectRoot(args.workspace);
  const requestedFile = previewFile(root, args.file);
  const meta = readJson(metaFile(root), {});
  const requestedUrl = args.port ? `http://127.0.0.1:${Number(args.port)}` : null;
  let running = requestedUrl ? await runningState(requestedUrl) : null;
  if (running?.file !== requestedFile) running = null;
  if (!running) running = meta.url ? await runningState(meta.url) : null;
  if (running?.file !== requestedFile) {
    running = null;
    for (let port = defaultPort; port <= defaultPort + 20; port += 1) {
      const candidate = await runningState(`http://127.0.0.1:${port}`);
      if (candidate?.file === requestedFile) {
        running = candidate;
        break;
      }
    }
  }
  if (running) {
    writeMetaAndReturn(root, running, true);
  }
  const adjustments = readJson(adjustmentsFile(root), defaultAdjustments());
  return {
    root,
    url: running?.url || meta.url || `http://127.0.0.1:${defaultPort}`,
    file: running?.file || requestedFile,
    adjustmentsFile: adjustmentsFile(root),
    initialHtmlFile: running?.initialHtmlPath || meta.initialHtmlFile || initialHtmlFile(root),
    adjustments
  };
}

async function syncPreview(args = {}) {
  const root = projectRoot(args.workspace);
  const state = await readPreviewState(args);
  const file = state.file;
  const html = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return {
    ...state,
    html,
    sourceInfo: fileInfo(file),
    initialInfo: fileInfo(state.initialHtmlFile)
  };
}

async function setPreviewBaseline(args = {}) {
  const root = projectRoot(args.workspace);
  const file = previewFile(root, args.file);
  ensureState(root);
  if (!fs.existsSync(file)) {
    throw new Error(`Preview file does not exist: ${file}`);
  }
  fs.writeFileSync(initialHtmlFile(root), fs.readFileSync(file, "utf8"), "utf8");
  return {
    file,
    initialHtmlFile: initialHtmlFile(root),
    sourceInfo: fileInfo(file),
    initialInfo: fileInfo(initialHtmlFile(root))
  };
}

async function resetPreview(args = {}) {
  const root = projectRoot(args.workspace);
  const file = previewFile(root, args.file);
  ensureState(root);
  if (!fs.existsSync(initialHtmlFile(root))) {
    throw new Error(`Initial HTML snapshot does not exist: ${initialHtmlFile(root)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fs.readFileSync(initialHtmlFile(root), "utf8"), "utf8");
  fs.writeFileSync(adjustmentsFile(root), JSON.stringify(defaultAdjustments(), null, 2), "utf8");
  return {
    file,
    initialHtmlFile: initialHtmlFile(root),
    adjustmentsFile: adjustmentsFile(root),
    sourceInfo: fileInfo(file)
  };
}

async function setPreviewAdjustments(args = {}) {
  const root = projectRoot(args.workspace);
  ensureState(root);
  const current = readJson(adjustmentsFile(root), defaultAdjustments());
  const next = { ...current, ...(args.adjustments || {}), updatedAt: new Date().toISOString() };
  fs.writeFileSync(adjustmentsFile(root), JSON.stringify(next, null, 2), "utf8");
  return { adjustmentsFile: adjustmentsFile(root), adjustments: next };
}

function defaultAdjustments() {
  return {
    maxWidth: 1120,
    radius: 8,
    accent: "#2563eb",
    background: "#f7f8fb",
    text: "#18202f"
  };
}

function starterHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live HTML Preview</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fb; color: #18202f; }
    main { max-width: 960px; margin: 0 auto; padding: 64px 24px; }
    h1 { font-size: 44px; line-height: 1.05; margin: 0 0 16px; }
    p { font-size: 18px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Live HTML Preview</h1>
    <p>Codex can replace this file incrementally while you tune the preview controls.</p>
  </main>
</body>
</html>`;
}

const tools = [
  {
    name: "start_html_preview",
    description: "Start or reuse a local live HTML preview server for the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace root. Defaults to current process directory." },
        file: { type: "string", description: "HTML file path relative to workspace. Defaults to .codex-html-live-preview/live.html." },
        port: { type: "number", description: "Local port. Defaults to 45731." }
      }
    }
  },
  {
    name: "update_html_preview",
    description: "Write HTML into the live preview file. The preview page reloads automatically.",
    inputSchema: {
      type: "object",
      required: ["html"],
      properties: {
        html: { type: "string" },
        workspace: { type: "string" },
        file: { type: "string" }
      }
    }
  },
  {
    name: "write_html_preview_source",
    description: "Write the live HTML source. Use this when Codex is applying edits while preserving user changes from the preview.",
    inputSchema: {
      type: "object",
      required: ["html"],
      properties: {
        html: { type: "string" },
        workspace: { type: "string" },
        file: { type: "string" },
        quiet: { type: "boolean", description: "When true, indicates this write is intended as a quiet sync without interrupting in-page editing." }
      }
    }
  },
  {
    name: "read_html_preview_source",
    description: "Read the current live HTML source, including text and style edits made directly in the preview.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        file: { type: "string" }
      }
    }
  },
  {
    name: "read_html_preview_state",
    description: "Read the preview URL, live file path, and current visual adjustments.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        file: { type: "string" },
        port: { type: "number", description: "Preferred local preview port when multiple previews are running." }
      }
    }
  },
  {
    name: "sync_html_preview",
    description: "Read the complete current preview state plus live HTML source so Codex can continue from user-edited content.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        file: { type: "string" },
        port: { type: "number", description: "Preferred local preview port when multiple previews are running." }
      }
    }
  },
  {
    name: "set_html_preview_adjustments",
    description: "Set visual adjustment values used by the preview wrapper.",
    inputSchema: {
      type: "object",
      required: ["adjustments"],
      properties: {
        workspace: { type: "string" },
        adjustments: { type: "object" }
      }
    }
  },
  {
    name: "set_html_preview_baseline",
    description: "Set the current live HTML source as the reset baseline.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        file: { type: "string" }
      }
    }
  },
  {
    name: "reset_html_preview",
    description: "Restore the live HTML source and visual adjustments to the initial baseline snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        file: { type: "string" }
      }
    }
  }
];

async function callTool(name, args) {
  if (name === "start_html_preview") return startPreview(args);
  if (name === "update_html_preview") return updatePreview(args);
  if (name === "write_html_preview_source") return writePreviewSource(args);
  if (name === "read_html_preview_source") return readPreviewSource(args);
  if (name === "read_html_preview_state") return readPreviewState(args);
  if (name === "sync_html_preview") return syncPreview(args);
  if (name === "set_html_preview_adjustments") return setPreviewAdjustments(args);
  if (name === "set_html_preview_baseline") return setPreviewBaseline(args);
  if (name === "reset_html_preview") return resetPreview(args);
  throw new Error(`Unknown tool: ${name}`);
}

function send(id, result, error) {
  const response = error
    ? { jsonrpc: "2.0", id, error: { code: -32000, message: error.message || String(error) } }
    : { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(msg, "id")) return;
  try {
    if (msg.method === "initialize") {
      send(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "html-live-preview", version: "0.1.0" }
      });
    } else if (msg.method === "tools/list") {
      send(msg.id, { tools });
    } else if (msg.method === "tools/call") {
      const result = await callTool(msg.params?.name, msg.params?.arguments || {});
      send(msg.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      });
    } else {
      send(msg.id, {});
    }
  } catch (error) {
    send(msg.id, null, error);
  }
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
