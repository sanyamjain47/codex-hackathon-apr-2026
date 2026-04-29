# Git Diff Viewer — Local UI Plan

This plan covers the **viewer UI and the local feedback-batching loop only**. It assumes someone else produces the markdown review tree under `examples/review/` (the existing fixture is enough to build against). No plugin wiring, no Codex thread management, no review generation. Those land in a follow-up.

The goal: a single-card, keyboard-driven reader for the review tree, with a small right-side queue where the reviewer composes feedback comments and explicitly sends them in a batch to the Python server.

## Scope

**In:**
- Static-friendly Python launcher that serves one HTML page and a tiny JSON API.
- Single-page HTML/JS/CSS reader that parses the markdown cards in `examples/review/` and renders one card at a time.
- Tree built from frontmatter (`parent`, `order`); arrow-key navigation across siblings, drill into children, climb to parent.
- Excellent markdown rendering: headings, tables, task lists, fenced code blocks (including `diff` highlighting), images.
- Right-pane comment **queue**: locally accumulated; user explicitly hits "Send batch" to POST to Python.
- Python persists each received batch to disk in a simple, downstream-friendly format.
- Local-only review status (approve / needs-change / flag / unreviewed) stored in `localStorage`.
- Polling-based card refresh so the same UI works whether files are present at boot or arrive over time.

**Out:**
- Plugin manifest, `.app.json`, `SKILL.md` updates.
- Spawning `codex app-server`, driving Codex threads, formatting feedback into prompts.
- Generating the review tree.
- Multi-user, persistence beyond the current machine, auth, deployment.
- Span/anchor-level comments (a comment can quote a card; it does not pin to a substring). Future-friendly comment shape leaves room for this.

## Architecture at a glance

```
                                          examples/review/
                                            overview.md
                                            change-01-….md
                                            evidence-01a-….md
                                            …
                                            images/*.svg
                                            feedback.jsonl   ← appended by Python
                                                  ▲
                                                  │ append
        Browser pane (Codex / any browser)        │
        ┌──────────────────────────────────┐      │
        │  index.html  +  app.js  +  app.css      │
        │   • renders one card, kbd nav    │      │
        │   • polls /api/cards (~1.5s)     │      │
        │   • holds local comment batch    │      │
        └──────────┬───────────────────────┘      │
                   │  HTTP (loopback only)        │
                   │   GET  /                     │
                   │   GET  /static/*             │
                   │   GET  /images/*             │
                   │   GET  /api/cards            │
                   │   POST /api/feedback ────────┘
                   ▼
        ┌──────────────────────────────────┐
        │  launch.py  (stdlib http.server) │
        │   • serves static + images       │
        │   • reads markdown on demand     │
        │   • appends feedback batches     │
        └──────────────────────────────────┘
```

One Python process, one HTML page, one filesystem directory. Everything is loopback, no auth, no external services.

## File layout

Replaces the current `viewer/` Next.js app. (We'll delete `viewer/` and the `launch-viewer.mjs` Node launcher in a final cleanup step; not part of the first PR.)

```
plugins/git-diff-viewer/
  app/
    launch.py                # ~80 lines, stdlib only
    static/
      index.html             # shell, mounts JS, loads CDN libs
      app.css                # typography, layout, badges, code panel
      app.js                 # ES module: tree, render, navigation, chat queue
```

The location is incidental — this plan does not touch any plugin files. `examples/review/` is the mount point.

## Python launcher (`launch.py`)

Stdlib only. No `pip install`. ~80 lines.

### Responsibilities

1. CLI: `--review-dir <path>` (default: `<repo>/examples/review`), `--port <n>` (default: 3000, fall back to next free).
2. Print one stdout line: `GIT_DIFF_VIEWER_URL=http://127.0.0.1:<port>`.
3. Start `http.server.ThreadingHTTPServer` bound to `127.0.0.1`.
4. Serve static files (`index.html`, `app.js`, `app.css`).
5. Serve images from `<review_dir>/images/` at `/images/*`.
6. Implement two JSON endpoints (`/api/cards`, `/api/feedback`).
7. On `SIGINT`/`SIGTERM`: shut down cleanly.

### HTTP endpoints

```
GET  /                       → static/index.html
GET  /static/<file>          → static/<file>      (app.js, app.css)
GET  /images/<file>          → <review_dir>/images/<file>

GET  /api/cards
→ 200 application/json
{
  "state": "running" | "done" | "failed",
  "cards": [
    { "filename": "overview.md", "raw": "---\nid: overview\n…\n---\n## What changed\n…", "mtime": 1746012345.0 },
    …
  ]
}

POST /api/feedback
   Content-Type: application/json
   Body: { "comments": [ { "comment": "…", "review_file": "evidence-02a-webhook-handler.md" }, … ] }
→ 200 application/json  { "ok": true, "batch_id": "<uuid>", "received": <n> }
→ 400 if body fails the minimal validation
```

### `/api/cards` behavior

On every call:
1. `glob("*.md")` in `<review_dir>`.
2. For each file:
   - `read_text(encoding="utf-8")`.
   - Quick sanity check: first line must be exactly `---`. If not, **skip silently** — file is mid-write. (Combined with the producer's `.tmp + rename` discipline, this is belt-and-braces. Not our concern in this PR; just don't crash.)
3. State derivation:
   - `_done` exists → `done`.
   - `_status.json` exists with `{state: "failed", …}` → `failed`.
   - Else → `running`.
   - For this milestone, `state` is mostly cosmetic. Today's fixture has neither file, so the API will report `running` indefinitely — which is fine; the UI handles it.
4. Return `{state, cards}`.

No filesystem watcher. No caching. Re-globs every call. Cost is negligible at 1.5s polling against ~12 files.

### `/api/feedback` behavior

1. Parse JSON body. Validate that `comments` is a list of `{comment: str, review_file: str}` objects. Trim whitespace. Reject empty list.
2. Generate `batch_id` (UUIDv4). Capture `sent_at` (ISO8601 UTC).
3. Append one line of JSON to `<review_dir>/feedback.jsonl`:

   ```json
   {"batch_id":"…","sent_at":"2026-04-29T13:45:12Z","comments":[{"comment":"…","review_file":"…"},…]}
   ```

4. Respond `{ok: true, batch_id, received: len(comments)}`.

`feedback.jsonl` is the contract for whoever (the friend's review agent) consumes batches. Append-only; one batch per line; trivial to tail.

### Concurrency

- `ThreadingHTTPServer` handles requests in threads.
- `/api/cards` is read-only on the filesystem; no synchronization needed.
- `/api/feedback` writes to one file. Use a module-level `threading.Lock` around the append. Open the file with `"a"` mode each call; rely on POSIX append-atomicity for short writes.

### Error model

- All errors return JSON: `{ok: false, message: "<reason>"}` with appropriate status code.
- Don't try to be clever about partial writes or producer crashes — the producer is out of scope. Just don't 500 on a file that fails to parse; skip it.

## Frontend (`static/`)

### `index.html`

Minimal shell. ~30 lines. Loads:

- `app.css` (linked).
- Three CDN ES modules from `https://cdn.jsdelivr.net/npm/`:
  - `markdown-it` (markdown → HTML)
  - `markdown-it-task-lists` (` - [ ] `, ` - [x] `)
  - `js-yaml` (parse frontmatter)
  - `highlight.js` core + the `diff` and `javascript`/`typescript`/`bash`/`python` languages
- `app.js` as `<script type="module">`.

DOM structure:

```html
<body>
  <div id="app">
    <header id="breadcrumb"></header>
    <main id="card"></main>
    <aside id="queue">
      <h2>Comments</h2>
      <ol id="queue-list"></ol>
      <form id="comment-form">
        <textarea placeholder="Comment on the current card…"></textarea>
        <div class="row">
          <span class="anchor"></span>
          <button type="submit">Add</button>
        </div>
      </form>
      <button id="send-batch">Send batch</button>
    </aside>
    <footer id="hud"></footer>
  </div>
  <div id="help" hidden></div>
</body>
```

### `app.css` principles

- Background: warm off-white, single deep-ink text color, one accent.
- Body: a centered reading column, max-width ~720px, generous line-height (1.6), font-size 17px.
- Right pane (`#queue`): fixed width 300px, sticky, soft border-left, paler background.
- HUD/footer: 12px monospaced keyboard hints (← → ↑ ↓, 1 2 3 0, c, /, ?, esc).
- Code panel: dark background, monospaced, `+` lines tinted green, `-` lines tinted red (target `.hljs-addition`, `.hljs-deletion` from highlight.js).
- Badges: small pills for risk/confidence/status, three colors total. No icons in v1.
- No animations beyond a 120ms fade on card swap and a tiny slide cue on sibling navigation (left or right by 6px).
- Single break-point at 1024px: below that, the queue collapses to a top-right toggle button + drawer.

### `app.js` architecture

Single ES module. Order of operations:

1. **Boot**: build `state` (see below). Render the empty/loading shell.
2. **First poll**: `fetch("/api/cards")` → parse cards → build tree → render.
3. **Polling loop**: every 1500ms while `agentState !== "done"`, re-fetch and reconcile. Stop when `done`. (The `done` signal is owned by the producer; for this milestone we'll often poll forever, which is fine.)
4. **Bind keyboard handlers** on `window`. Disable nav handlers when focus is inside an input/textarea.
5. **Bind chat handlers** on the form.

State (single object, kept simple):

```js
const state = {
  cards: new Map(),         // id -> { filename, frontmatter, body, raw, mtime }
  byParent: new Map(),      // parentId -> [childId, ordered by `order`]
  rootId: "overview",
  currentId: null,
  lastChildOf: new Map(),   // parentId -> last visited childId (drill-down memo)
  agentState: "running",
  batch: [],                // [{ id, comment, review_file }]
  status: new Map(),        // cardId -> "approved"|"needs-change"|"flagged"|"unreviewed"
};
```

`status` and `batch` are persisted to `localStorage` (see Local Persistence below); everything else is recomputed.

#### Tree construction

For each card:
1. Split `raw` at the second `---\n` to get frontmatter YAML and body markdown.
2. `jsyaml.load(frontmatter)` → object. Validate minimally: must have `id`, `level`, `title`. Warn (banner) on missing/duplicate ids.
3. Insert into `state.cards`.
4. Group by `parent`; sort each group by `order` ascending, then by `id` for stability.

If the overview card is missing, fall back to "first level-1 card" or the first card alphabetically; surface a banner warning.

#### Reconciliation on poll

- Diff the new card list against `state.cards` by `(filename, mtime)`.
- Update changed/new entries. Remove entries that are no longer present.
- If `state.currentId` no longer exists, fall back to `rootId` (or first available).
- Rebuild `byParent`. Re-render the current card if its content changed.
- Newly appeared cards get a 600ms highlight animation in the breadcrumb position dot.

#### Markdown rendering

```js
const md = markdownit({
  html: false,            // we don't trust raw HTML in card bodies
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; }
      catch {}
    }
    return md.utils.escapeHtml(str);
  },
}).use(window.markdownItTaskLists, { enabled: false });
```

Override the image renderer so a card body's `![](images/foo.svg)` resolves to `/images/foo.svg`:

```js
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const src = t.attrGet("src") || "";
  if (!/^(https?:|\/)/.test(src)) {
    t.attrSet("src", "/images/" + src.replace(/^images\//, ""));
  }
  return defaultImage(tokens, idx, opts, env, self);
};
```

External links open in a new tab via a renderer override; relative `[evidence-01a-…](evidence-01a-…)` style links in body text become **internal navigations** to the matching card id (custom link renderer).

## Card view

```
┌──────────────────────────────────────────────────────────────────────┬──────────┐
│  Overview › Stripe webhooks (2/3) › Webhook handler (1/3)            │ Comments │
│                                                                      │          │
│  Evidence: webhook handler                                           │  1. on   │
│  [risk: high] [confidence: high] [status: unreviewed]                │     evi… │
│                                                                      │     "Ad…"│
│                                                                      │  2. on   │
│  ## What this evidence shows                                         │     ove… │
│  …                                                                   │     "Re…"│
│                                                                      │          │
│  ## Relevant code                                                    │  ┌────┐  │
│                                                                      │  │ +  │  │
│  ```diff                                                             │  │new │  │
│  + case "invoice.payment_failed": …                                  │  └────┘  │
│  ```                                                                 │          │
│                                                                      │ ┌──────┐ │
│                                                                      │ │ Send │ │
│                                                                      │ │ batch│ │
│                                                                      │ └──────┘ │
├──────────────────────────────────────────────────────────────────────┴──────────┤
│  ← prev sibling   → next sibling   ↑ parent   ↓ drill in   c comment   ? help   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Breadcrumb

Path from root to current. Each segment shows `Title (i/N)` where `i` is the 1-indexed sibling position and `N` is the sibling count at that level. The current segment is bold; ancestors are clickable. Sibling position is the most orienting piece of UI here — it tells the reviewer how much is at this level without showing a tree.

### Badges

Three small pills under the title: `risk`, `confidence`, `status`. Three discrete colors:

- `low` / `approved` → muted green.
- `medium` / `unreviewed` → muted gray.
- `high` / `needs-change` / `flagged` → muted red.

Status pill is interactive: click cycles through (or use the 0/1/2/3 keys).

### Body

Rendered markdown. Reading column 720px max-width. Tables get horizontal scroll on overflow. Code blocks max-height 480px with vertical scroll.

## Keyboard navigation

All bindings on `window`, suppressed when focus is in an `<input>`, `<textarea>`, or `[contenteditable]`. `Esc` always returns focus to `body` (so navigation resumes).

| Key | Action |
|---|---|
| `↓` / `j` | Drill down: go to `lastChildOf[currentId]` if set, else first child. No-op if leaf. |
| `↑` / `k` | Go to parent. No-op at overview. Records the current card as `lastChildOf[parent]`. |
| `→` / `l` | Next sibling. No wrap; bumping the right edge plays a 6px slide-and-bounce. |
| `←` / `h` | Previous sibling. No wrap; same bump on the left edge. |
| `0` | Set status `unreviewed` for the current card. |
| `1` | Set status `approved`. |
| `2` | Set status `needs-change`. |
| `3` | Set status `flagged`. |
| `c` | Focus the comment textarea. The "anchor" line shows the current card's filename. |
| `/` | Same as `c` (familiar to vim/web users). |
| `Enter` (in textarea) | New line. |
| `⌘+Enter` / `Ctrl+Enter` (in textarea) | Add comment to batch. |
| `g g` | Jump to overview. |
| `?` | Toggle keyboard help overlay. |
| `Esc` | Close help / blur textarea. |

Card body scrolling uses the standard browser keys — `Space`, `PgUp`, `PgDn`, mouse wheel — so the arrow keys remain unambiguous for tree nav.

### Edge behavior

- Drilling down to a parent the user has already visited returns them to the **last child they were on**. This makes "up to compare, then back down" a single ↑↓ round-trip.
- Sibling moves at the edge play a soft bump animation rather than wrapping. Wrapping is disorienting in a tree.

## Side chat / feedback queue

The right-side pane (`#queue`) does three things:

1. Shows the current batch (`state.batch`) as a numbered list. Each item shows: the anchor filename (truncated, monospaced), the comment text, and a small × to remove.
2. Provides a textarea to add a new comment. The "anchor" line under it always shows: `Anchor: <currentCard.filename>`. Every comment is anchored to the currently-viewed card. There are no "general" comments — if a user wants to comment on the overall review, they navigate to overview first.
3. Provides a "Send batch" button. Disabled when `state.batch` is empty.

### Comment shape

```ts
type Comment = {
  id: string;          // local uuid, used only for list keys / removal
  comment: string;     // the user's text, trimmed
  review_file: string; // e.g., "evidence-02a-webhook-handler.md"
};
```

What gets POSTed to `/api/feedback` is just `{comments: Comment[]}` with the local `id` stripped.

### Adding a comment

- Triggered by clicking "Add" or pressing `⌘+Enter` in the textarea.
- Validates: text must be non-empty after trim.
- Pushes onto `state.batch`. Clears the textarea. Keeps focus in the textarea so the user can keep typing.
- Persists `state.batch` to `localStorage`.

### Editing a comment

For v1, an item can be **deleted** (×) but not edited inline. To edit, delete and re-add. Adding inline editing is ~20 lines but I'd skip it unless it's painful in dogfooding.

### Sending a batch

- Click "Send batch" or press `⌘+S` / `Alt+S`.
- POST `/api/feedback` with `{comments}`.
- On 200: clear `state.batch`, persist, flash a "Sent batch — N comments" toast for 2s.
- On error: keep the batch intact, show an error toast with the message; user can retry.
- Default cadence: never automatic. The user is in full control of when to send. The whole point of the queue is to compose multiple comments while reading.

### Queue persistence across reloads

Persisted to `localStorage` under `gdv:batch:<reviewDirHash>`. A reload restores the queue. Sending clears it.

## Local persistence summary

All keys scoped by a hash of `reviewDir` so multiple checkouts don't collide.

| Key | Value |
|---|---|
| `gdv:batch:<h>` | Current unsent batch (array of `Comment`). |
| `gdv:status:<h>:<cardId>` | Status override for one card. |
| `gdv:lastChildOf:<h>:<parentId>` | (Optional) drill-down memo. Cheap; recompute is fine too. |
| `gdv:currentId:<h>` | Last viewed card id, restored on reload. |

## Implementation order

Each step ends with something runnable.

1. **`launch.py` skeleton** — port discovery, prints `GIT_DIFF_VIEWER_URL=`, serves a hello-world `index.html`. Verify with `curl` and a browser.
2. **`/api/cards`** — globs `examples/review/*.md`, returns the JSON. Test by hand against the fixture; should see all 11 cards.
3. **`/images/*`** route — serve `<review_dir>/images/`. Verify in a browser.
4. **`index.html` + `app.css` + `app.js` boot** — load CDN libs, fetch `/api/cards`, parse frontmatter, render the overview card with markdown-it. No navigation yet.
5. **Tree + breadcrumb** — build `byParent`, render the breadcrumb with sibling position counts.
6. **Keyboard nav** — arrows + hjkl + last-child memo + edge bumps. Skip the status keys for now.
7. **Status pill + 0/1/2/3 keys** — wire to `localStorage`.
8. **Right pane queue (UI only)** — render `state.batch`, add and remove. No POST yet.
9. **`/api/feedback`** — append to `feedback.jsonl`. Test by `tail -f` while clicking Send.
10. **Wire "Send batch"** — POST, toast, clear, error path.
11. **Polling reconciliation** — every 1.5s, diff and update without losing `currentId`. (Will be a no-op against today's static fixture; sets the producer integration up for free.)
12. **Polish pass** — typography, code panel diff coloring, breadcrumb micro-interactions, help overlay.

## Open questions worth answering before step 1

1. **Internet at runtime, or vendored libs?** CDN ESM imports are simplest. Vendoring `markdown-it`, `js-yaml`, `markdown-it-task-lists`, and a slim `highlight.js` build is ~150KB and removes the "no network = blank page" failure mode. Recommend: CDN now, vendor before any demo.
2. **Comment editing inline?** Skipped above. If yes, pencil-icon → swap textarea for that item.
3. **Format of `feedback.jsonl`** — line-per-batch or line-per-comment? Recommendation above is line-per-batch with a `batch_id`. Easier for the consumer to attribute a turn to one user action.
4. **Are external `[link](url)` opens in a new tab?** Yes for v1.
5. **Status colors and pill density** — pinned in the CSS section; happy to revise after first dogfood.

## Out of scope (explicit)

- Generating the review tree.
- Sending feedback to a Codex thread or any agent.
- Any plugin manifest / `.app.json` / `SKILL.md` changes.
- Span-level / quoted-text comments.
- Multi-user, server-persisted, or cross-machine state.
- Offline / vendored static assets (deferred until before a demo).
