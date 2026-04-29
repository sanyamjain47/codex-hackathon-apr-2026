import markdownit from "https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/+esm";
import taskLists from "https://cdn.jsdelivr.net/npm/markdown-it-task-lists@2.1.1/+esm";
import jsyaml from "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/core/+esm";
import diffLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/diff/+esm";
import jsLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/javascript/+esm";
import tsLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/typescript/+esm";
import bashLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/bash/+esm";
import pythonLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/python/+esm";
import sqlLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/sql/+esm";
import jsonLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/json/+esm";
import yamlLang from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/yaml/+esm";

hljs.registerLanguage("diff", diffLang);
hljs.registerLanguage("javascript", jsLang);
hljs.registerLanguage("js", jsLang);
hljs.registerLanguage("typescript", tsLang);
hljs.registerLanguage("ts", tsLang);
hljs.registerLanguage("bash", bashLang);
hljs.registerLanguage("sh", bashLang);
hljs.registerLanguage("shell", bashLang);
hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("py", pythonLang);
hljs.registerLanguage("sql", sqlLang);
hljs.registerLanguage("json", jsonLang);
hljs.registerLanguage("yaml", yamlLang);
hljs.registerLanguage("yml", yamlLang);

const POLL_MS = 1500;

const STATUS_TONE = {
  approved: "good",
  unreviewed: "warn",
  "needs-change": "bad",
  flagged: "bad",
};

const RISK_TONE = { low: "good", medium: "warn", high: "bad" };
const CONFIDENCE_TONE = { high: "good", medium: "warn", low: "bad" };

const STATUS_CYCLE = ["unreviewed", "approved", "needs-change", "flagged"];

const md = markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch (e) {
        /* ignore */
      }
    }
    return md.utils.escapeHtml(str);
  },
}).use(taskLists, { enabled: false, label: false });

const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const src = t.attrGet("src") || "";
  if (!/^(https?:|\/)/.test(src)) {
    t.attrSet("src", "/images/" + src.replace(/^images\//, ""));
  }
  return defaultImage(tokens, idx, opts, env, self);
};

const defaultLink = md.renderer.rules.link_open ||
  ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const href = t.attrGet("href") || "";
  if (/^https?:/i.test(href)) {
    t.attrJoin("target", "_blank");
    t.attrJoin("rel", "noopener noreferrer");
  } else if (href && !href.startsWith("#")) {
    const id = href.replace(/\.md$/, "").replace(/^\.?\//, "");
    t.attrSet("href", "#card=" + encodeURIComponent(id));
    t.attrJoin("class", "internal");
    t.attrSet("data-internal-id", id);
  }
  return defaultLink(tokens, idx, opts, env, self);
};

function renderHtmlInto(el, htmlString) {
  el.replaceChildren();
  const range = document.createRange();
  range.selectNodeContents(el);
  const frag = range.createContextualFragment(htmlString);
  el.appendChild(frag);
}

const reviewDirHash = btoa(location.host + location.pathname).slice(0, 10);
const lsKey = (k, ...rest) => ["gdv", k, reviewDirHash, ...rest].join(":");

const state = {
  cards: new Map(),
  byParent: new Map(),
  rootId: "overview",
  currentId: null,
  lastChildOf: new Map(),
  agentState: "running",
  batch: loadJSON(lsKey("batch"), []),
  status: new Map(loadJSON(lsKey("statusMap"), [])),
  warnings: [],
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function persistBatch() { saveJSON(lsKey("batch"), state.batch); }
function persistStatus() { saveJSON(lsKey("statusMap"), Array.from(state.status.entries())); }
function persistCurrent() { saveJSON(lsKey("currentId"), state.currentId); }
function persistLastChild() {
  saveJSON(lsKey("lastChildOf"), Array.from(state.lastChildOf.entries()));
}

state.lastChildOf = new Map(loadJSON(lsKey("lastChildOf"), []));

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return null;
  const yaml = raw.slice(3, end).replace(/^\n/, "");
  const bodyStart = raw.indexOf("\n", end + 4);
  const body = bodyStart === -1 ? "" : raw.slice(bodyStart + 1);
  try {
    const fm = jsyaml.load(yaml) || {};
    return { fm, body };
  } catch {
    return null;
  }
}

function buildTree(cards) {
  const map = new Map();
  state.warnings = [];
  for (const card of cards) {
    const parsed = parseFrontmatter(card.raw);
    if (!parsed || !parsed.fm.id) continue;
    const fm = parsed.fm;
    if (map.has(fm.id)) {
      state.warnings.push(`Duplicate id: ${fm.id}`);
      continue;
    }
    map.set(fm.id, {
      id: fm.id,
      filename: card.filename,
      mtime: card.mtime,
      raw: card.raw,
      frontmatter: fm,
      body: parsed.body,
    });
  }
  const byParent = new Map();
  for (const card of map.values()) {
    const parent = card.frontmatter.parent || null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(card);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      const ao = a.frontmatter.order ?? 9999;
      const bo = b.frontmatter.order ?? 9999;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
  }
  return { map, byParent };
}

function pickRoot(map, byParent) {
  if (map.has("overview")) return "overview";
  const roots = byParent.get(null) || byParent.get(undefined) || [];
  if (roots.length) return roots[0].id;
  const first = map.values().next().value;
  return first ? first.id : null;
}

function getSiblings(id) {
  const card = state.cards.get(id);
  if (!card) return [];
  const parent = card.frontmatter.parent || null;
  return state.byParent.get(parent) || [];
}

function getChildren(id) {
  return state.byParent.get(id) || [];
}

function getAncestors(id) {
  const path = [];
  let cur = id;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const card = state.cards.get(cur);
    if (!card) break;
    path.unshift(card);
    cur = card.frontmatter.parent || null;
  }
  return path;
}

function setCurrent(id, opts = {}) {
  if (!state.cards.has(id)) return;
  const prev = state.currentId;
  state.currentId = id;
  persistCurrent();
  if (prev) {
    const prevCard = state.cards.get(prev);
    if (prevCard) {
      const parent = prevCard.frontmatter.parent || null;
      if (parent) {
        state.lastChildOf.set(parent, prev);
        persistLastChild();
      }
    }
  }
  render();
  const cardEl = document.getElementById("card");
  if (cardEl && opts.direction) {
    cardEl.classList.remove("bump-left", "bump-right", "dir-up", "dir-down");
    void cardEl.offsetWidth;
    const map = {
      right: "bump-right",
      left: "bump-left",
      up: "dir-up",
      down: "dir-down",
    };
    const cls = map[opts.direction];
    if (cls) cardEl.classList.add(cls);
  }
}

function moveSibling(delta) {
  const sibs = getSiblings(state.currentId);
  const idx = sibs.findIndex((c) => c.id === state.currentId);
  if (idx < 0) return;
  const target = idx + delta;
  if (target < 0 || target >= sibs.length) {
    // Right edge: drill into first child if available, so `→` keeps moving forward.
    if (delta > 0 && getChildren(state.currentId).length > 0) {
      drillDown();
      return;
    }
    const cardEl = document.getElementById("card");
    cardEl.classList.remove("bump-left", "bump-right");
    void cardEl.offsetWidth;
    cardEl.classList.add(delta > 0 ? "bump-right" : "bump-left");
    return;
  }
  setCurrent(sibs[target].id, { direction: delta > 0 ? "right" : "left" });
}

function drillDown() {
  const kids = getChildren(state.currentId);
  if (!kids.length) return;
  const memo = state.lastChildOf.get(state.currentId);
  const target = memo && kids.some((c) => c.id === memo) ? memo : kids[0].id;
  setCurrent(target, { direction: "down" });
}

function goParent() {
  const card = state.cards.get(state.currentId);
  if (!card) return;
  const parent = card.frontmatter.parent;
  if (!parent) return;
  state.lastChildOf.set(parent, state.currentId);
  persistLastChild();
  setCurrent(parent, { direction: "up" });
}

function setStatus(value) {
  if (!state.currentId) return;
  state.status.set(state.currentId, value);
  persistStatus();
  renderCard();
  renderMinimap();
  renderCounters();
  renderDockActions();
  updateProgress();
}

function cycleStatus() {
  const cur = state.status.get(state.currentId) ||
    (state.cards.get(state.currentId)?.frontmatter.status) || "unreviewed";
  const idx = STATUS_CYCLE.indexOf(cur);
  setStatus(STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]);
}

function effectiveStatus(card) {
  return state.status.get(card.id) || card.frontmatter.status || "unreviewed";
}

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.on) {
    for (const [k, v] of Object.entries(opts.on)) node.addEventListener(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function badge(label, value, tone, { interactive, onClick } = {}) {
  const node = el("span", { className: `badge tone-${tone}` + (interactive ? " interactive" : "") });
  node.appendChild(el("span", { className: "badge-label", text: label }));
  node.appendChild(el("span", { className: "badge-value", text: value }));
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function renderBreadcrumb() {
  const root = document.getElementById("breadcrumb");
  root.replaceChildren();
  if (!state.currentId) return;
  const ancestors = getAncestors(state.currentId);
  ancestors.forEach((card, i) => {
    if (i > 0) root.appendChild(el("span", { className: "sep", text: "›" }));
    const isCurrent = i === ancestors.length - 1;
    const seg = el("span", {
      className: "seg" + (isCurrent ? " current" : ""),
      on: { click: () => setCurrent(card.id) },
    });
    seg.appendChild(el("span", {
      className: "seg-title",
      text: card.frontmatter.title || card.id,
    }));
    const parent = card.frontmatter.parent || null;
    const sibs = state.byParent.get(parent) || [];
    if (sibs.length > 1) {
      const pos = sibs.findIndex((c) => c.id === card.id) + 1;
      seg.appendChild(document.createTextNode(" "));
      seg.appendChild(el("span", { className: "pos", text: `${pos}/${sibs.length}` }));
    }
    root.appendChild(seg);
  });
}

function renderCard() {
  const root = document.getElementById("card");
  root.replaceChildren();

  const inner = el("div", { className: "card-inner" });

  if (state.warnings.length) {
    for (const w of state.warnings) {
      inner.appendChild(el("div", { className: "banner", text: w }));
    }
  }

  if (!state.currentId) {
    inner.appendChild(el("div", {
      className: "placeholder",
      text: state.cards.size === 0
        ? "No review cards yet. Waiting for the producer…"
        : "No card selected.",
    }));
    root.appendChild(inner);
    return;
  }

  const card = state.cards.get(state.currentId);
  if (!card) {
    inner.appendChild(el("div", { className: "placeholder", text: "Card not found." }));
    root.appendChild(inner);
    return;
  }

  const body = el("div", { className: "body" });
  renderHtmlInto(body, md.render(card.body || ""));
  body.querySelectorAll("a[data-internal-id]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("data-internal-id");
      if (state.cards.has(id)) {
        e.preventDefault();
        setCurrent(id);
      }
    });
  });
  inner.appendChild(body);

  root.appendChild(inner);
  root.scrollTop = 0;
  updateAnchor();
}

function renderSide() {
  const card = state.cards.get(state.currentId);
  const $ = (id) => document.getElementById(id);
  const pos = $("side-pos"), title = $("side-title");
  const anchor = $("side-anchor"), meta = $("side-meta");
  const path = $("side-path"), rel = $("side-relatives");
  if (!card) {
    [pos, title, anchor, meta, path, rel].forEach((n) => n && n.replaceChildren());
    if (title) title.textContent = "";
    return;
  }

  const fm = card.frontmatter;
  const all = Array.from(state.cards.values());
  const idxAll = all.findIndex((c) => c.id === card.id) + 1;
  pos.replaceChildren();
  pos.appendChild(el("b", { text: String(idxAll).padStart(2, "0") }));
  pos.appendChild(document.createTextNode(` / ${String(all.length).padStart(2, "0")}`));

  title.textContent = fm.title || fm.id;
  anchor.textContent = card.filename;

  // Compact stat row: risk · conf · status
  meta.replaceChildren();
  const stat = (label, value, tone, opts = {}) => {
    const node = el("div", { className: `side-stat tone-${tone}` + (opts.onClick ? " is-clickable" : "") });
    node.appendChild(el("div", { className: "k", text: label }));
    const v = el("div", { className: "v", text: value });
    if (opts.onClick) v.addEventListener("click", opts.onClick);
    node.appendChild(v);
    return node;
  };
  if (fm.risk) meta.appendChild(stat("risk", fm.risk, RISK_TONE[fm.risk] || "warn"));
  if (fm.confidence) meta.appendChild(stat("conf", fm.confidence, CONFIDENCE_TONE[fm.confidence] || "warn"));
  const status = effectiveStatus(card);
  meta.appendChild(stat("status", status.replace("-", " "), STATUS_TONE[status] || "warn", { onClick: cycleStatus }));

  // Path (ancestors as a vertical breadcrumb)
  path.replaceChildren();
  path.appendChild(el("div", { className: "side-section-h", text: "Path" }));
  const ancestors = getAncestors(card.id);
  ancestors.forEach((a, i) => {
    const row = el("div", {
      className: "side-path-row" + (i === ancestors.length - 1 ? " current" : ""),
      on: { click: () => setCurrent(a.id) },
    });
    if (i > 0) row.appendChild(el("span", { className: "indent", text: "  ".repeat(i - 1) + "↳ " }));
    row.appendChild(el("span", { text: a.frontmatter.title || a.id }));
    path.appendChild(row);
  });

  // Children if present, otherwise siblings (only useful at leaves)
  rel.replaceChildren();
  const children = state.byParent.get(card.id) || [];
  let listItems = null;
  let header = null;
  if (children.length > 0) {
    header = `Children · ${children.length}`;
    listItems = children;
  } else {
    const siblings = getSiblings(card.id);
    if (siblings.length > 1) {
      header = `Siblings · ${siblings.findIndex((c) => c.id === card.id) + 1} of ${siblings.length}`;
      listItems = siblings;
    }
  }
  if (listItems) {
    rel.appendChild(el("div", { className: "side-section-h", text: header }));
    const ol = el("ol", { className: "side-sibs" });
    listItems.forEach((s, i) => {
      const st = effectiveStatus(s);
      const li = el("li", {
        className: "side-sib" + (s.id === card.id ? " current" : ""),
        on: { click: () => setCurrent(s.id) },
      });
      li.appendChild(el("span", { className: "num", text: String(i + 1) }));
      li.appendChild(el("span", { className: `pip s-${st}` }));
      li.appendChild(el("span", {
        className: "label",
        text: s.frontmatter.title || s.id,
      }));
      ol.appendChild(li);
    });
    rel.appendChild(ol);
  }

  // Up/down disable state
  const up = document.querySelector('.side-nav-btn[data-act="up"]');
  const dn = document.querySelector('.side-nav-btn[data-act="down"]');
  if (up) up.disabled = !card.frontmatter.parent;
  if (dn) dn.disabled = (state.byParent.get(card.id) || []).length === 0;
}

function renderQueue() {
  const list = document.getElementById("queue-list");
  list.replaceChildren();
  state.batch.forEach((item, i) => {
    const li = el("li", { className: "queue-item" });
    const bubble = el("div", { className: "bubble" });
    bubble.appendChild(el("div", { className: "text", text: item.comment }));
    bubble.appendChild(el("button", {
      className: "remove",
      text: "×",
      attrs: { "aria-label": "Remove" },
      on: {
        click: () => {
          state.batch.splice(i, 1);
          persistBatch();
          renderQueue();
        },
      },
    }));
    li.appendChild(bubble);
    li.appendChild(el("div", { className: "filename", text: item.review_file }));
    list.appendChild(li);
  });
  updateSendButton();
}

function updateSendButton() {
  document.getElementById("send-batch").disabled = state.batch.length === 0;
  const count = document.getElementById("queue-count");
  if (count) {
    count.textContent = String(state.batch.length);
    count.classList.toggle("has-items", state.batch.length > 0);
  }
}

function updateAnchor() {
  const anchor = document.getElementById("comment-anchor");
  const card = state.cards.get(state.currentId);
  anchor.textContent = card ? `Anchor: ${card.filename}` : "";
}

function render() {
  renderBreadcrumb();
  renderCard();
  renderSide();
  renderRails();
  renderAgentState();
  renderMinimap();
  renderCounters();
  renderDockActions();
  updateProgress();
  focusCardArea();
}

function updateProgress() {
  const elProg = document.getElementById("tree-progress");
  if (!elProg) return;
  let total = 0;
  let done = 0;
  for (const card of state.cards.values()) {
    total += 1;
    const st = effectiveStatus(card);
    if (st === "approved" || st === "needs-change" || st === "flagged") done += 1;
  }
  elProg.textContent = total ? `${done}/${total}` : "";
}

function renderRails() {
  const sibs = getSiblings(state.currentId);
  const idx = sibs.findIndex((c) => c.id === state.currentId);
  const prev = document.getElementById("rail-prev");
  const next = document.getElementById("rail-next");
  const up = document.getElementById("rail-up");
  const down = document.getElementById("rail-down");
  if (prev && next) {
    if (idx <= 0) prev.setAttribute("disabled", ""); else prev.removeAttribute("disabled");
    if (idx === -1 || idx >= sibs.length - 1) next.setAttribute("disabled", "");
    else next.removeAttribute("disabled");
  }
  const card = state.cards.get(state.currentId);
  if (up) {
    if (card && card.frontmatter.parent) up.removeAttribute("disabled");
    else up.setAttribute("disabled", "");
  }
  if (down) {
    if ((state.byParent.get(state.currentId) || []).length > 0) down.removeAttribute("disabled");
    else down.setAttribute("disabled", "");
  }
}

function renderMinimap() {
  const root = document.getElementById("minimap");
  if (!root) return;
  root.replaceChildren();
  if (!state.cards.size || !state.rootId) return;

  const pathSet = new Set(getAncestors(state.currentId).map((c) => c.id));

  const buildBranch = (cardId) => {
    const card = state.cards.get(cardId);
    if (!card) return null;
    const status = effectiveStatus(card);
    const branch = el("div", { className: "branch" });
    const btn = el("button", {
      className:
        "mm-seg" +
        ` s-${status}` +
        (card.id === state.currentId ? " current" : "") +
        (pathSet.has(card.id) ? " on-path" : ""),
      attrs: {
        title: `${card.frontmatter.title || card.id}${status !== "unreviewed" ? ` · ${status}` : ""}`,
      },
      on: { click: () => setCurrent(card.id) },
    });
    btn.appendChild(el("span", {
      className: "mm-label",
      text: card.frontmatter.title || card.id,
    }));
    branch.appendChild(btn);
    const kids = state.byParent.get(cardId) || [];
    if (kids.length) {
      const kidRow = el("div", { className: "branch-children" });
      for (const k of kids) {
        const sub = buildBranch(k.id);
        if (sub) kidRow.appendChild(sub);
      }
      branch.appendChild(kidRow);
    }
    return branch;
  };

  const tree = buildBranch(state.rootId);
  if (tree) root.appendChild(tree);

  // Depth labels
  const labels = document.getElementById("depth-labels");
  if (labels) {
    labels.replaceChildren();
    let maxDepth = 0;
    const measureDepth = (id, d) => {
      maxDepth = Math.max(maxDepth, d);
      for (const k of state.byParent.get(id) || []) measureDepth(k.id, d + 1);
    };
    measureDepth(state.rootId, 0);
    const names = ["PR", "Changes", "Evidence", "Detail"];
    for (let d = 0; d <= maxDepth; d++) {
      labels.appendChild(el("span", { className: "dl", text: names[d] || `L${d}` }));
    }
  }

  let total = 0;
  let reviewed = 0;
  for (const card of state.cards.values()) {
    total += 1;
    const st = effectiveStatus(card);
    if (st === "approved" || st === "needs-change" || st === "flagged") reviewed += 1;
  }
  const txt = document.getElementById("dock-progress-text");
  if (txt) txt.textContent = `${reviewed} / ${total} reviewed`;
  const finish = document.getElementById("finish-btn");
  if (finish) finish.disabled = !(total > 0 && reviewed >= total);
}

function renderDockActions() {
  const card = state.cards.get(state.currentId);
  const cur = card ? effectiveStatus(card) : null;
  const map = {
    approve: "approved",
    changes: "needs-change",
    flag: "flagged",
    reset: "unreviewed",
  };
  document.querySelectorAll("#dock .status-chip").forEach((btn) => {
    const act = btn.getAttribute("data-act");
    btn.classList.toggle("active", cur === map[act]);
  });
}

function renderCounters() {
  const counts = { approved: 0, "needs-change": 0, flagged: 0 };
  for (const card of state.cards.values()) {
    const s = effectiveStatus(card);
    if (s in counts) counts[s] += 1;
  }
  const set = (id, n, container) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
    const wrap = document.getElementById(container);
    if (wrap) wrap.classList.toggle("has", n > 0);
  };
  set("n-approved", counts.approved, "count-approved");
  set("n-changes", counts["needs-change"], "count-changes");
  set("n-flagged", counts.flagged, "count-flagged");
}

function renderAgentState() {
  const node = document.getElementById("agent-state");
  if (!node) return;
  node.textContent = state.agentState;
  node.classList.remove("running", "done", "failed");
  node.classList.add(state.agentState);
}

function showToast(message, kind = "info") {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.classList.toggle("error", kind === "error");
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function sendBatch() {
  if (!state.batch.length) return;
  const payload = {
    comments: state.batch.map(({ comment, review_file }) => ({ comment, review_file })),
  };
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      showToast(body.message || `Send failed (${res.status})`, "error");
      return;
    }
    showToast(`Sent batch — ${body.received} comment${body.received === 1 ? "" : "s"}`);
    state.batch = [];
    persistBatch();
    renderQueue();
  } catch (err) {
    showToast(err.message || "Network error", "error");
  }
}

function addComment() {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  const card = state.cards.get(state.currentId);
  if (!card) return;
  state.batch.push({
    id: crypto.randomUUID(),
    comment: text,
    review_file: card.filename,
  });
  persistBatch();
  input.value = "";
  renderQueue();
  input.focus();
}

let lastG = 0;

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

function onKeyDown(e) {
  if (e.key === "?") {
    if (!isEditableTarget(e.target)) {
      e.preventDefault();
      toggleHelp();
      return;
    }
  }

  if (e.key === "Escape") {
    const help = document.getElementById("help");
    if (!help.hidden) { help.hidden = true; return; }
    if (isEditableTarget(e.target)) e.target.blur();
    return;
  }

  if (e.key === "Enter" && e.target && e.target.id === "comment-input") {
    if (!e.shiftKey) {
      e.preventDefault();
      addComment();
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    sendBatch();
    return;
  }

  if (isEditableTarget(e.target)) return;

  switch (e.key) {
    case "ArrowRight":
    case "l":
      e.preventDefault(); moveSibling(1); break;
    case "ArrowLeft":
    case "h":
      e.preventDefault(); moveSibling(-1); break;
    case "ArrowDown":
    case "j":
      e.preventDefault(); drillDown(); break;
    case "ArrowUp":
    case "k":
      e.preventDefault(); goParent(); break;
    case "0":
      e.preventDefault(); setStatus("unreviewed"); break;
    case "1":
      e.preventDefault(); setStatus("approved"); break;
    case "2":
      e.preventDefault(); setStatus("needs-change"); break;
    case "3":
      e.preventDefault(); setStatus("flagged"); break;
    case "c":
    case "/":
      e.preventDefault();
      document.getElementById("comment-input").focus();
      break;
    case "g": {
      const now = Date.now();
      if (now - lastG < 500) {
        e.preventDefault();
        setCurrent(state.rootId);
        lastG = 0;
      } else {
        lastG = now;
      }
      break;
    }
  }
}

function toggleHelp() {
  const help = document.getElementById("help");
  help.hidden = !help.hidden;
}

async function fetchCards() {
  try {
    const res = await fetch("/api/cards", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    applyCards(data);
  } catch {
    /* swallow; will retry */
  }
}

function applyCards(data) {
  const cards = data.cards || [];
  const { map, byParent } = buildTree(cards);
  const oldFingerprints = new Map();
  for (const [id, c] of state.cards) oldFingerprints.set(id, c.mtime + "|" + c.raw.length);
  state.cards = map;
  state.byParent = byParent;
  state.agentState = data.state || "running";
  state.rootId = pickRoot(map, byParent) || state.rootId;
  if (!state.currentId || !map.has(state.currentId)) {
    const restored = loadJSON(lsKey("currentId"), null);
    state.currentId = (restored && map.has(restored)) ? restored : state.rootId;
  }
  let changed = oldFingerprints.size !== map.size;
  if (!changed) {
    for (const c of map.values()) {
      const prev = oldFingerprints.get(c.id);
      if (!prev || prev !== c.mtime + "|" + c.raw.length) { changed = true; break; }
    }
  }
  if (changed) render();
}

async function pollLoop() {
  await fetchCards();
  if (state.agentState !== "done") {
    setTimeout(pollLoop, POLL_MS);
  }
}

function focusCardArea() {
  const card = document.getElementById("card");
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable)) {
    return;
  }
  if (card) card.focus({ preventScroll: true });
}

function bind() {
  // Listen on document (capture) so arrow keys are caught even when the
  // webview would otherwise scroll natively.
  document.addEventListener("keydown", onKeyDown, true);
  // Refocus card area after click so subsequent arrow keys work.
  document.addEventListener("click", (e) => {
    if (e.target.closest("textarea, input, button, a")) return;
    focusCardArea();
  });
  document.getElementById("comment-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addComment();
  });
  document.getElementById("send-batch").addEventListener("click", sendBatch);
  document.getElementById("help-close").addEventListener("click", () => {
    document.getElementById("help").hidden = true;
  });
  document.getElementById("help-toggle").addEventListener("click", toggleHelp);
  document.getElementById("help").addEventListener("click", (e) => {
    if (e.target.id === "help") e.target.hidden = true;
  });
  document.getElementById("rail-prev").addEventListener("click", () => moveSibling(-1));
  document.getElementById("rail-next").addEventListener("click", () => moveSibling(1));
  const railUp = document.getElementById("rail-up");
  const railDn = document.getElementById("rail-down");
  if (railUp) railUp.addEventListener("click", goParent);
  if (railDn) railDn.addEventListener("click", drillDown);
  document.querySelectorAll(".side-nav-btn").forEach((b) => {
    const act = b.getAttribute("data-act");
    b.addEventListener("click", () => {
      if (act === "up") goParent();
      else if (act === "down") drillDown();
    });
  });
  document.querySelectorAll("#dock .dock-actions .chip").forEach((btn) => {
    const act = btn.getAttribute("data-act");
    btn.addEventListener("click", () => {
      switch (act) {
        case "prev": moveSibling(-1); break;
        case "next": moveSibling(1); break;
        case "up": goParent(); break;
        case "down": drillDown(); break;
        case "approve": setStatus("approved"); break;
        case "changes": setStatus("needs-change"); break;
        case "flag": setStatus("flagged"); break;
        case "reset": setStatus("unreviewed"); break;
        case "comment": document.getElementById("comment-input").focus(); break;
      }
    });
  });
  document.getElementById("finish-btn").addEventListener("click", sendBatch);
  window.addEventListener("hashchange", () => {
    const m = location.hash.match(/^#card=(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (state.cards.has(id)) setCurrent(id);
    }
  });
}

bind();
renderQueue();
pollLoop().then(() => focusCardArea());
// Initial nudge: refocus card area shortly after load so keystrokes work
// even if the webview doesn't auto-focus the document body.
setTimeout(focusCardArea, 200);
setTimeout(focusCardArea, 800);
