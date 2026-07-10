#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const file = path.resolve(args.file || path.join(root, ".codex-html-live-preview/live.html"));
const port = Number(args.port || 45731);
const stateDir = path.join(root, ".codex-html-live-preview");
const adjustmentsPath = path.join(stateDir, "adjustments.json");
const initialHtmlPath = path.join(stateDir, "initial.html");
const clients = new Set();

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
if (!fs.existsSync(file)) fs.writeFileSync(file, "<!doctype html><title>Live HTML Preview</title>", "utf8");
if (!fs.existsSync(adjustmentsPath)) fs.writeFileSync(adjustmentsPath, JSON.stringify(defaultAdjustments(), null, 2), "utf8");
if (!fs.existsSync(initialHtmlPath)) fs.writeFileSync(initialHtmlPath, fs.readFileSync(file, "utf8"), "utf8");

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      parsed[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
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

function readJson(target, fallback) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return fallback;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, payload) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function broadcast(event = "reload") {
  for (const res of clients) {
    res.write(`event: ${event}\ndata: ${Date.now()}\n\n`);
  }
}

function adjustmentCss() {
  const a = readJson(adjustmentsPath, defaultAdjustments());
  return `:root {
  --hlp-max-width: ${Number(a.maxWidth || 1120)}px;
  --hlp-radius: ${Number(a.radius || 8)}px;
  --hlp-accent: ${cssColor(a.accent, "#2563eb")};
  --hlp-background: ${cssColor(a.background, "#f7f8fb")};
  --hlp-text: ${cssColor(a.text, "#18202f")};
}
body {
  background: var(--hlp-background);
  color: var(--hlp-text);
}
body, a, button, input, progress {
  accent-color: var(--hlp-accent);
}`;
}

function cssColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function injectAdjustments(html) {
  const style = `<style id="html-live-preview-adjustments">\n${adjustmentCss()}\n</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${style}\n</head>`);
  return `${style}\n${html}`;
}

function previewShell() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HTML Live Preview</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      grid-template-rows: 56px minmax(0, 1fr);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f4ee;
      color: #2f2a24;
    }
    .topbar {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border-bottom: 1px solid #ddd8cf;
      background: rgba(255, 255, 255, .88);
      backdrop-filter: blur(14px);
    }
    .topbar strong { font-size: 14px; }
    .topbar .actions { display: flex; gap: 8px; align-items: center; }
    .pill {
      height: 32px;
      padding: 0 12px;
      border: 1px solid #ded8ce;
      border-radius: 8px;
      background: #fffaf2;
      color: #51483d;
      font-size: 13px;
      font-weight: 650;
    }
    aside {
      grid-column: 1;
      grid-row: 1 / span 2;
      display: flex;
      flex-direction: column;
      border-right: 1px solid #ddd8cf;
      background: #fbfaf7;
      overflow: hidden;
    }
    .side-head {
      padding: 14px 14px 10px;
      border-bottom: 1px solid #e6e1d8;
    }
    .side-title { font-size: 14px; font-weight: 760; }
    .sidebar-scroll { padding: 0 10px 14px; overflow: auto; }
    h1 { margin: 0; font-size: 16px; line-height: 1.25; }
    h2 { margin: 16px 0 8px; color: #5f574d; font-size: 12px; font-weight: 760; letter-spacing: 0; }
    label { display: grid; gap: 6px; margin: 9px 0; font-size: 12px; color: #6d6459; }
    input, select, textarea { width: 100%; border: 1px solid #ded8ce; border-radius: 8px; background: #fffdfa; color: #342f29; font: inherit; }
    input, select { height: 34px; padding: 0 9px; }
    textarea { min-height: 72px; padding: 8px; resize: vertical; line-height: 1.45; }
    input[type="range"] { padding: 0; accent-color: #d96540; }
    input[type="color"] { width: 44px; height: 28px; padding: 0; border: 1px solid #ded8ce; border-radius: 7px; background: transparent; }
    input[type="file"] { height: auto; padding: 8px; border-style: dashed; }
    input[type="checkbox"] { width: auto; height: auto; justify-self: end; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .value { color: #8b8174; font-variant-numeric: tabular-nums; }
    button { width: 100%; height: 34px; margin-top: 8px; border: 1px solid #ded8ce; border-radius: 8px; color: #3f382f; background: #fffaf2; cursor: pointer; font-weight: 650; }
    button:hover { border-color: #d1c6b7; background: #f4eee4; }
    button.active { border-color: #d96540; background: #d96540; color: white; }
    .danger { border-color: #edd2c9; background: #fff1ec; color: #a44830; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .selected { color: #3f382f; font-size: 13px; line-height: 1.35; word-break: break-word; padding: 9px 10px; border: 1px solid #ded8ce; border-radius: 8px; background: #f3ede3; }
    .empty { padding: 16px; border: 1px dashed #d8d0c3; border-radius: 9px; color: #8d8174; font-size: 13px; line-height: 1.45; background: #fffdfa; }
    .control-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .control-grid label { margin: 0; }
    .control-grid .wide { grid-column: 1 / -1; }
    .segmented { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #e5ded4; border-radius: 9px; overflow: hidden; background: #fffdfa; }
    .segmented button {
      height: 34px;
      margin: 0;
      border: 0;
      border-right: 1px solid #eee7dc;
      border-radius: 0;
      background: transparent;
      color: #6d6459;
      font-size: 14px;
    }
    .segmented button:last-child { border-right: 0; }
    .segmented button.active { background: #f0e6d9; color: #2f2a24; }
    .inspector-group { padding: 11px 0 12px; border-top: 1px solid #e8e2d9; }
    .inspector-group:first-child { border-top: 0; }
    #inspector label {
      grid-template-columns: minmax(72px, .55fr) minmax(0, 1fr);
      align-items: center;
      min-height: 38px;
      padding: 5px 8px;
      border: 1px solid #e5ded4;
      border-radius: 9px;
      background: #fffdfa;
    }
    #inspector textarea { grid-column: 1 / -1; margin-top: 4px; }
    #inspector .control-grid textarea { min-height: 58px; }
    #inspector input[type="range"] { height: 28px; }
    .hint { margin: 10px 0 0; font-size: 12px; line-height: 1.4; color: #8d8174; }
    iframe { grid-column: 2; grid-row: 2; width: 100%; height: 100%; border: 0; background: white; }
    @media (max-width: 760px) {
      body { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }
      .topbar { grid-column: 1; grid-row: 1; }
      aside { grid-column: 1; grid-row: 2; max-height: 320px; border-right: 0; border-bottom: 1px solid #ddd8cf; }
      iframe { grid-column: 1; grid-row: 3; height: 100%; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <strong>Live Preview</strong>
    <div class="actions">
      <button class="pill" id="topEditMode">Edit</button>
    </div>
  </header>
  <aside>
    <div class="side-head">
      <div class="side-title">Selection</div>
    </div>
    <div class="sidebar-scroll">
    <section id="elementPanel">
      <p class="selected" id="selectedLabel">No element selected.</p>
      <div id="inspector" class="empty">Turn on Edit mode, then click text, images, buttons, cards, or layout containers in the page.</div>
    </section>
    <section id="globalPanel">
      <h2>Page</h2>
      ${control("maxWidth", "Max width", "720", "1440", "10")}
      ${control("radius", "Radius", "0", "28", "1")}
      ${colorControl("accent", "Accent")}
      ${colorControl("background", "Background")}
      ${colorControl("text", "Text")}
      <button id="copy">Copy adjustments</button>
    </section>
    <h2>History</h2>
    <div class="split">
      <button id="setBaseline">Set baseline</button>
      <button id="resetInitial" class="danger">Reset initial</button>
    </div>
    <p class="hint" id="status">Preview updates save into the live HTML file.</p>
    </div>
  </aside>
  <iframe id="frame" src="/content"></iframe>
  <script>
    const frame = document.getElementById("frame");
    const inputs = [...document.querySelectorAll("[data-key]")];
    const status = document.getElementById("status");
    const topEditMode = document.getElementById("topEditMode");
    const selectedLabel = document.getElementById("selectedLabel");
    const inspector = document.getElementById("inspector");
    let editMode = false;
    let selectedEl = null;
    let dirty = false;
    let undoStack = [];
    let redoStack = [];
    let restoring = false;
    let mutationObserver = null;
    let mutationTimer = 0;
    const source = new EventSource("/events");
    source.addEventListener("reload", () => reloadFrame());
    source.addEventListener("adjustments", () => load());
    function reloadFrame() {
      frame.removeAttribute("srcdoc");
      frame.src = "/content?t=" + Date.now();
    }
    async function load() {
      const res = await fetch("/api/adjustments");
      const data = await res.json();
      for (const input of inputs) {
        if (data[input.dataset.key] !== undefined) input.value = data[input.dataset.key];
        input.closest("label")?.querySelector(".value")?.replaceChildren(String(input.value));
      }
    }
    async function save() {
      const adjustments = {};
      for (const input of inputs) {
        adjustments[input.dataset.key] = input.type === "range" ? Number(input.value) : input.value;
        input.closest("label")?.querySelector(".value")?.replaceChildren(String(input.value));
      }
      await fetch("/api/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(adjustments) });
      reloadFrame();
    }
    function setEditMode(enabled) {
      if (!enabled && editMode) {
        cleanupInlineEditor(selectedEl);
        selectedEl?.removeAttribute("data-hlp-selected");
        selectedEl = null;
        selectedLabel.textContent = "No element selected.";
        renderInspector(null);
      }
      if (!enabled && editMode && dirty) {
        savePage();
      }
      editMode = enabled;
      topEditMode.classList.toggle("active", enabled);
      topEditMode.textContent = enabled ? "Done" : "Edit";
      status.textContent = enabled ? editModeStatus() : "Preview updates save into the live HTML file.";
    }
    function attachPicker() {
      const doc = frame.contentDocument;
      if (!doc) return;
      if (doc.__hlpPickerAttached) {
        observeDynamicDom(doc);
        return;
      }
      doc.__hlpPickerAttached = true;
      doc.addEventListener("mouseover", event => {
        if (!editMode) return;
        event.target?.setAttribute("data-hlp-hover", "true");
      }, true);
      doc.addEventListener("mouseout", event => {
        event.target?.removeAttribute("data-hlp-hover");
      }, true);
      doc.addEventListener("click", event => {
        if (!editMode) return;
        if (selectedEl && selectedEl.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        selectElement(event.target, event);
      }, true);
      observeDynamicDom(doc);
    }
    function observeDynamicDom(doc) {
      if (!doc?.documentElement) return;
      mutationObserver?.disconnect();
      mutationObserver = new doc.defaultView.MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => handleDynamicDomChange(doc), 80);
      });
      mutationObserver.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "src", "alt", "href", "value"]
      });
    }
    async function handleDynamicDomChange(doc) {
      if (restoring || !doc?.documentElement) return;
      await injectAdjustmentStyle();
      injectEditorStyle();
      if (selectedEl && !doc.documentElement.contains(selectedEl)) {
        cleanupInlineEditor(selectedEl);
        selectedEl = null;
        selectedLabel.textContent = "Selection changed by script.";
        renderInspector(null);
        status.textContent = "The selected element was replaced by page script. Click it again to edit.";
      }
    }
    function editModeStatus() {
      const doc = frame.contentDocument;
      const hasPageScripts = Boolean(doc?.querySelector("script[src], script:not(#html-live-preview-adjustments):not(#html-live-preview-editor-style)"));
      return hasPageScripts
        ? "Editing dynamic DOM locally. Click Done to sync the current rendered snapshot."
        : "Editing locally. Click Done to sync changes.";
    }
    function selectElement(el, event) {
      if (!el || el === frame.contentDocument?.documentElement) return;
      selectedEl?.removeAttribute("data-hlp-selected");
      cleanupInlineEditor(selectedEl);
      selectedEl = el;
      selectedEl.setAttribute("data-hlp-selected", "true");
      selectedLabel.textContent = elementLabel(el);
      if (hasEditableText(el)) enableInlineEditor(el, event);
      renderInspector(el);
      status.textContent = "Element selected. Type directly in the page or use the controls.";
    }
    function hasEditableText(el) {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      const isMedia = ["img", "video", "canvas", "svg"].includes(tag);
      const isForm = ["input", "textarea", "select", "button"].includes(tag);
      const textTags = ["a", "button", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "input", "label", "li", "p", "span", "strong", "textarea"];
      const hasDirectText = [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
      return !isMedia && getElementText(el).trim().length > 0 && (isForm || textTags.includes(tag) || el.childElementCount === 0 || hasDirectText);
    }
    function elementLabel(el) {
      const bits = [el.tagName.toLowerCase()];
      if (el.id) bits.push("#" + el.id);
      if (el.className && typeof el.className === "string") bits.push("." + el.className.trim().split(/\\s+/).slice(0, 3).join("."));
      return bits.join("");
    }
    function getElementText(el) {
      if ("value" in el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return el.value;
      return el.innerText || el.textContent || "";
    }
    function setElementText(el, value) {
      if ("value" in el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        el.value = value;
        el.setAttribute("value", value);
      } else {
        el.textContent = value;
      }
    }
    function enableInlineEditor(el, event) {
      if (!el) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        el.focus();
        el.addEventListener("beforeinput", recordBeforeInput);
        el.addEventListener("input", syncInlineText);
        el.addEventListener("change", syncInlineText);
        return;
      }
      if (!el.hasAttribute("contenteditable")) {
        el.setAttribute("contenteditable", "true");
        el.setAttribute("data-hlp-made-editable", "true");
      }
      el.setAttribute("spellcheck", "true");
      el.addEventListener("beforeinput", recordBeforeInput);
      el.addEventListener("input", syncInlineText);
      frame.contentWindow?.focus();
      el.focus();
      placeCaretFromPoint(el, event);
    }
    function cleanupInlineEditor(el) {
      if (!el) return;
      el.removeEventListener("beforeinput", recordBeforeInput);
      el.removeEventListener("input", syncInlineText);
      el.removeEventListener("change", syncInlineText);
      if (el.getAttribute("data-hlp-made-editable") === "true") {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-hlp-made-editable");
        el.removeAttribute("spellcheck");
      }
    }
    function syncInlineText() {
      if (!selectedEl) return;
      const contentField = inspector.querySelector("[data-content-key='text']");
      if (contentField) contentField.value = getElementText(selectedEl);
      markDirty();
    }
    function recordBeforeInput() {
      pushHistory();
    }
    function placeCaretFromPoint(el, event) {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) return;
      let range = null;
      if (event && typeof doc.caretRangeFromPoint === "function") {
        range = doc.caretRangeFromPoint(event.clientX, event.clientY);
      } else if (event && typeof doc.caretPositionFromPoint === "function") {
        const pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
        if (pos) {
          range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (!range || !el.contains(range.startContainer)) {
        range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    function renderInspector(el) {
      if (!el) {
        inspector.className = "empty";
        inspector.textContent = "Turn on Edit mode, then click text, images, buttons, cards, or layout containers in the page.";
        return;
      }
      inspector.className = "";
      const style = frame.contentWindow.getComputedStyle(el);
      const groups = [];
      const tag = el.tagName.toLowerCase();
      const isMedia = ["img", "video", "canvas", "svg"].includes(tag);
      const isForm = ["input", "textarea", "select", "button"].includes(tag);
      const hasText = hasEditableText(el);
      const isLink = tag === "a";
      const isContainer = !isMedia && (el.childElementCount > 0 || ["flex", "grid"].includes(style.display));
      if (hasText) {
        const lineHeight = parseFloat(style.lineHeight) / (parseFloat(style.fontSize) || 16) || 1.2;
        groups.push(group("Text", [
          '<div class="control-grid">',
          textArea("Content", "text", getElementText(el), "wide"),
          isForm && "placeholder" in el ? textInput("Placeholder", "placeholder", el.getAttribute("placeholder") || "", "wide") : "",
          isLink ? textInput("Href", "href", el.getAttribute("href") || "", "wide") : "",
          select("Font", "fontFamily", style.fontFamily, [
            ["", "Keep"], ["system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", "System"],
            ["Inter, system-ui, sans-serif", "Inter"], ["Arial, Helvetica, sans-serif", "Arial"],
            ["Georgia, serif", "Georgia"], ["'SF Mono', Consolas, monospace", "Mono"]
          ], "wide"),
          range("Size", "fontSize", 8, 160, 1, "px", parseFloat(style.fontSize) || 16),
          color("Color", "color", rgbToHex(style.color)),
          select("Weight", "fontWeight", style.fontWeight, [["", "Keep"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["900", "Black"]]),
          select("Style", "fontStyle", style.fontStyle, [["", "Keep"], ["normal", "Regular"], ["italic", "Italic"]]),
          select("Decor", "textDecorationLine", style.textDecorationLine, [["", "Keep"], ["none", "None"], ["underline", "Underline"], ["line-through", "Strike"]]),
          select("Align", "textAlign", style.textAlign, [["", "Keep"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]]),
          range("Leading", "lineHeight", 0.8, 2.6, 0.05, "", Number(lineHeight.toFixed(2))),
          range("Tracking", "letterSpacing", -2, 12, 0.1, "px", parseFloat(style.letterSpacing) || 0),
          select("Case", "textTransform", style.textTransform, [["", "Keep"], ["none", "None"], ["uppercase", "Upper"], ["lowercase", "Lower"], ["capitalize", "Title"]]),
          '</div>'
        ]));
      }
      if (tag === "img" || tag === "video") {
        const accept = tag === "img" ? "image/*" : "video/*";
        groups.push(group("Media", [
          mediaFileInput("Replace file", accept),
          textInput("Source URL", "src", mediaSource(el), "wide"),
          tag === "img" ? textInput("Alt", "alt", el.getAttribute("alt") || "", "wide") : "",
          tag === "video" ? textInput("Poster", "poster", el.getAttribute("poster") || "", "wide") : "",
          tag === "video" ? checkbox("Controls", "controls", el.hasAttribute("controls")) : "",
          range("Object fit", "objectFit", "", "", "", [
            ["", "Keep"], ["cover", "Cover"], ["contain", "Contain"], ["fill", "Fill"], ["none", "None"]
          ])
        ]));
        groups.push(group("Media size", [
          range("Width", "width", 5, 100, 1, "%", percentOfParent(el, "width")),
          range("Height", "height", 40, 900, 4, "px", Math.round(el.getBoundingClientRect().height) || 180),
          range("Radius", "borderRadius", 0, 80, 1, "px", parseFloat(style.borderRadius) || 0),
          select("Position", "objectPosition", style.objectPosition, [["", "Keep"], ["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]])
        ]));
      }
      if (!hasText || ["button", "input", "textarea", "select"].includes(tag) || isContainer) groups.push(group("Appearance", [
        color("Background", "backgroundColor", rgbToHex(style.backgroundColor)),
        color("Border", "borderColor", rgbToHex(style.borderColor)),
        range("Radius", "borderRadius", 0, 64, 1, "px", parseFloat(style.borderRadius) || 0),
        range("Opacity", "opacity", 0, 1, 0.05, "", parseFloat(style.opacity) || 1)
      ]));
      if (!isMedia && (!hasText || ["button", "input", "textarea", "select"].includes(tag) || isContainer)) groups.push(group("Spacing and Size", [
        range("Padding", "padding", 0, 120, 1, "px", parseFloat(style.paddingTop) || 0),
        range("Margin", "margin", 0, 120, 1, "px", parseFloat(style.marginTop) || 0),
        range("Width", "width", 0, 100, 1, "%", percentOfParent(el, "width")),
        range("Min height", "minHeight", 0, 800, 4, "px", parseFloat(style.minHeight) || 0)
      ]));
      if (isContainer) {
        groups.push(group("Layout", [
          select("Display", "display", style.display, [["", "Keep"], ["block", "Block"], ["inline-block", "Inline block"], ["flex", "Flex"], ["grid", "Grid"], ["none", "Hidden"]]),
          select("Direction", "flexDirection", style.flexDirection, [["", "Keep"], ["row", "Row"], ["column", "Column"], ["row-reverse", "Row reverse"], ["column-reverse", "Column reverse"]]),
          select("Justify", "justifyContent", style.justifyContent, [["", "Keep"], ["flex-start", "Start"], ["center", "Center"], ["space-between", "Space between"], ["flex-end", "End"]]),
          select("Align", "alignItems", style.alignItems, [["", "Keep"], ["stretch", "Stretch"], ["flex-start", "Start"], ["center", "Center"], ["flex-end", "End"]]),
          range("Gap", "gap", 0, 96, 1, "px", parseFloat(style.gap) || 0)
        ]));
      }
      inspector.innerHTML = groups.join("");
      inspector.querySelectorAll("[data-content-key]").forEach(input => input.addEventListener("input", applyContentEdit));
      inspector.querySelectorAll("[data-style-key]").forEach(input => input.addEventListener(input.type === "color" || input.type === "range" ? "input" : "change", applyStyleEdit));
      inspector.querySelectorAll("[data-media-file]").forEach(input => input.addEventListener("change", applyMediaFile));
    }
    function group(title, fields) {
      return '<section class="inspector-group"><h2>' + escapeHtml(title) + '</h2>' + fields.filter(Boolean).join("") + '</section>';
    }
    function textArea(label, key, value, className = "") {
      return '<label class="' + escapeAttr(className) + '">' + escapeHtml(label) + '<textarea data-content-key="' + escapeAttr(key) + '">' + escapeHtml(value) + '</textarea></label>';
    }
    function textInput(label, key, value, className = "") {
      return '<label class="' + escapeAttr(className) + '">' + escapeHtml(label) + '<input data-content-key="' + escapeAttr(key) + '" value="' + escapeAttr(value) + '"></label>';
    }
    function mediaFileInput(label, accept) {
      return '<label class="wide">' + escapeHtml(label) + '<input data-media-file="src" type="file" accept="' + escapeAttr(accept) + '"></label>';
    }
    function checkbox(label, key, checked) {
      return '<label>' + escapeHtml(label) + '<input data-content-key="' + escapeAttr(key) + '" type="checkbox"' + (checked ? " checked" : "") + '></label>';
    }
    function color(label, key, value, className = "") {
      return '<label class="' + escapeAttr(className) + '">' + escapeHtml(label) + '<input data-style-key="' + escapeAttr(key) + '" type="color" value="' + escapeAttr(value || "#000000") + '"></label>';
    }
    function range(label, key, min, max, step, unit, value, className = "") {
      if (Array.isArray(unit)) return select(label, key, value, unit, className);
      const shown = value ?? min;
      return '<label class="' + escapeAttr(className) + '"><span class="row"><span>' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(shown) + '</span></span><input data-style-key="' + escapeAttr(key) + '" data-unit="' + escapeAttr(unit) + '" type="range" min="' + escapeAttr(min) + '" max="' + escapeAttr(max) + '" step="' + escapeAttr(step) + '" value="' + escapeAttr(shown) + '"></label>';
    }
    function select(label, key, value, options, className = "") {
      const items = options.map(([val, text]) => '<option value="' + escapeAttr(val) + '"' + (String(val) === String(value) ? " selected" : "") + '>' + escapeHtml(text) + '</option>').join("");
      return '<label class="' + escapeAttr(className) + '">' + escapeHtml(label) + '<select data-style-key="' + escapeAttr(key) + '">' + items + '</select></label>';
    }
    function applyContentEdit(event) {
      if (!selectedEl) {
        return;
      }
      pushHistory();
      const key = event.target.dataset.contentKey;
      if (key === "text") setElementText(selectedEl, event.target.value);
      else if (key === "src") setMediaSource(selectedEl, event.target.value);
      else if (key === "alt") selectedEl.setAttribute("alt", event.target.value);
      else if (key === "href") selectedEl.setAttribute("href", event.target.value);
      else if (key === "placeholder") selectedEl.setAttribute("placeholder", event.target.value);
      else if (key === "poster") selectedEl.setAttribute("poster", event.target.value);
      else if (key === "controls") {
        if (event.target.checked) selectedEl.setAttribute("controls", "");
        else selectedEl.removeAttribute("controls");
      }
      markDirty();
    }
    function applyMediaFile(event) {
      if (!selectedEl || !event.target.files?.length) return;
      const file = event.target.files[0];
      pushHistory();
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setMediaSource(selectedEl, String(reader.result || ""));
        const sourceField = inspector.querySelector("[data-content-key='src']");
        if (sourceField) sourceField.value = String(reader.result || "");
        markDirty();
        status.textContent = "Media replaced locally. Click Done to sync.";
      });
      reader.readAsDataURL(file);
    }
    function mediaSource(el) {
      if (!el) return "";
      return el.getAttribute("src") || el.querySelector?.("source")?.getAttribute("src") || "";
    }
    function setMediaSource(el, value) {
      if (!el) return;
      if (el.tagName === "VIDEO") {
        const source = el.querySelector("source");
        if (source) source.setAttribute("src", value);
        el.setAttribute("src", value);
        el.load?.();
      } else {
        el.setAttribute("src", value);
      }
    }
    function applyStyleEdit(event) {
      if (!selectedEl) return;
      pushHistory();
      const input = event.target;
      const key = input.dataset.styleKey;
      const unit = input.dataset.unit || "";
      selectedEl.style[key] = input.type === "range" ? input.value + unit : input.value;
      input.closest("label")?.querySelector(".value")?.replaceChildren(String(input.value));
      if (["display", "flexDirection", "justifyContent", "alignItems"].includes(key)) {
        setTimeout(() => renderInspector(selectedEl), 0);
      }
      markDirty();
    }
    function serializeFrame() {
      const doc = frame.contentDocument;
      if (!doc) return "";
      const clone = doc.documentElement.cloneNode(true);
      clone.querySelectorAll("[data-hlp-hover], [data-hlp-selected]").forEach(el => {
        el.removeAttribute("data-hlp-hover");
        el.removeAttribute("data-hlp-selected");
      });
      clone.querySelectorAll("[data-hlp-made-editable='true']").forEach(el => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-hlp-made-editable");
        el.removeAttribute("spellcheck");
      });
      clone.querySelector("#html-live-preview-adjustments")?.remove();
      clone.querySelector("#html-live-preview-editor-style")?.remove();
      return "<!doctype html>\\n" + clone.outerHTML;
    }
    function pushHistory() {
      if (restoring) return;
      const html = serializeFrame();
      if (!html) return;
      if (undoStack[undoStack.length - 1] === html) return;
      undoStack.push(html);
      if (undoStack.length > 80) undoStack.shift();
      redoStack = [];
    }
    function restoreSnapshot(html, label) {
      if (!html) return;
      restoring = true;
      selectedEl = null;
      selectedLabel.textContent = "No element selected.";
      renderInspector(null);
      const finishRestore = async () => {
        frame.removeEventListener("load", finishRestore);
        await injectAdjustmentStyle();
        injectEditorStyle();
        attachPicker();
        restoring = false;
        dirty = true;
        status.textContent = label + ". Click Done to sync.";
      };
      frame.addEventListener("load", finishRestore);
      frame.srcdoc = html;
    }
    function undoEdit() {
      if (!undoStack.length) {
        status.textContent = "Nothing to undo.";
        return;
      }
      const current = serializeFrame();
      if (current) redoStack.push(current);
      restoreSnapshot(undoStack.pop(), "Undo applied");
    }
    function redoEdit() {
      if (!redoStack.length) {
        status.textContent = "Nothing to redo.";
        return;
      }
      const current = serializeFrame();
      if (current) undoStack.push(current);
      restoreSnapshot(redoStack.pop(), "Redo applied");
    }
    function handleUndoKey(event) {
      const isUndoKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      if (!isUndoKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redoEdit();
      else undoEdit();
    }
    async function savePage() {
      const html = serializeFrame();
      if (!html) return;
      await fetch("/api/html?quiet=1", { method: "POST", headers: { "content-type": "text/html; charset=utf-8" }, body: html });
      dirty = false;
      status.textContent = "Changes synced.";
    }
    function markDirty() {
      dirty = true;
      status.textContent = "Unsynced edits. Click Done to sync.";
    }
    function rgbToHex(value) {
      const match = String(value).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!match) return "#000000";
      return "#" + match.slice(1, 4).map(n => Number(n).toString(16).padStart(2, "0")).join("");
    }
    function percentOfParent(el, axis) {
      const parent = el.parentElement;
      if (!parent) return 100;
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const size = axis === "width" ? rect.width : rect.height;
      const parentSize = axis === "width" ? parentRect.width : parentRect.height;
      return parentSize ? Math.round((size / parentSize) * 100) : 100;
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function escapeAttr(value) {
      return escapeHtml(value);
    }
    for (const input of inputs) input.addEventListener("input", save);
    topEditMode.addEventListener("click", () => setEditMode(!editMode));
    window.addEventListener("keydown", handleUndoKey, true);
    document.getElementById("setBaseline").addEventListener("click", async () => {
      await savePage();
      await fetch("/api/baseline", { method: "POST" });
      status.textContent = "Baseline updated.";
    });
    document.getElementById("resetInitial").addEventListener("click", async () => {
      pushHistory();
      await fetch("/api/reset", { method: "POST" });
      selectedEl = null;
      selectedLabel.textContent = "No element selected.";
      renderInspector(null);
      reloadFrame();
      load();
      status.textContent = "Restored initial preview.";
    });
    frame.addEventListener("load", () => {
      injectAdjustmentStyle();
      injectEditorStyle();
      attachPicker();
      frame.contentDocument?.addEventListener("keydown", handleUndoKey, true);
    });
    document.getElementById("copy").addEventListener("click", async () => {
      const res = await fetch("/api/adjustments");
      await navigator.clipboard.writeText(JSON.stringify(await res.json(), null, 2));
    });
    async function injectAdjustmentStyle() {
      const doc = frame.contentDocument;
      if (!doc) return;
      let style = doc.getElementById("html-live-preview-adjustments");
      if (!style) {
        style = doc.createElement("style");
        style.id = "html-live-preview-adjustments";
        (doc.head || doc.documentElement).append(style);
      }
      const res = await fetch("/api/adjustment-css");
      style.textContent = await res.text();
    }
    function injectEditorStyle() {
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById("html-live-preview-editor-style")) return;
      const style = doc.createElement("style");
      style.id = "html-live-preview-editor-style";
      style.textContent = "[data-hlp-hover='true']{outline:2px dashed #0ea5e9!important;outline-offset:3px!important;cursor:crosshair!important}[data-hlp-selected='true']{outline:3px solid #2563eb!important;outline-offset:4px!important}";
      doc.head.append(style);
    }
    load();
  </script>
</body>
</html>`;
}

function control(key, label, min, max, step) {
  return `<label><span class="row"><span>${label}</span><span class="value"></span></span><input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
}

function colorControl(key, label) {
  return `<label><span class="row"><span>${label}</span><span class="value"></span></span><input data-key="${key}" type="color"></label>`;
}

function elementControl(key, label, min, max, step, unit) {
  return `<label><span class="row"><span>${label}</span><span class="value"></span></span><input data-style-key="${key}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
}

function elementColor(key, label) {
  return `<label><span class="row"><span>${label}</span><span class="value"></span></span><input data-style-key="${key}" type="color"></label>`;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (req.method === "HEAD" && parsed.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/") {
      const body = previewShell();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/favicon.ico") {
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/content") {
      const body = injectAdjustments(fs.readFileSync(file, "utf8"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/api/state") {
      sendJson(res, { root, file, adjustmentsPath, initialHtmlPath, url: `http://127.0.0.1:${port}`, serverVersion: "0.1.0" });
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/api/adjustments") {
      sendJson(res, readJson(adjustmentsPath, defaultAdjustments()));
      return;
    }
    if (req.method === "GET" && parsed.pathname === "/api/adjustment-css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      res.end(adjustmentCss());
      return;
    }
    if (req.method === "POST" && parsed.pathname === "/api/adjustments") {
      const incoming = JSON.parse(await readBody(req));
      const next = { ...readJson(adjustmentsPath, defaultAdjustments()), ...incoming, updatedAt: new Date().toISOString() };
      fs.writeFileSync(adjustmentsPath, JSON.stringify(next, null, 2), "utf8");
      broadcast("adjustments");
      sendJson(res, next);
      return;
    }
    if (req.method === "POST" && parsed.pathname === "/api/html") {
      fs.writeFileSync(file, await readBody(req), "utf8");
      if (parsed.searchParams.get("quiet") !== "1") {
        broadcast("reload");
      }
      sendJson(res, { file, ok: true });
      return;
    }
    if (req.method === "POST" && parsed.pathname === "/api/baseline") {
      fs.writeFileSync(initialHtmlPath, fs.readFileSync(file, "utf8"), "utf8");
      sendJson(res, { initialHtmlPath, ok: true });
      return;
    }
    if (req.method === "POST" && parsed.pathname === "/api/reset") {
      fs.writeFileSync(file, fs.readFileSync(initialHtmlPath, "utf8"), "utf8");
      fs.writeFileSync(adjustmentsPath, JSON.stringify(defaultAdjustments(), null, 2), "utf8");
      broadcast("adjustments");
      broadcast("reload");
      sendJson(res, { file, adjustmentsPath, initialHtmlPath, ok: true });
      return;
    }
    notFound(res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

fs.watchFile(file, { interval: 300 }, () => broadcast("reload"));
server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`HTML Live Preview: http://127.0.0.1:${port}\n`);
});
