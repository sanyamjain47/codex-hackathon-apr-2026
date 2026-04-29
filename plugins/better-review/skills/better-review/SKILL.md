---
name: better-review
description: Turn the current branch's diff into a card-based, swipeable code review surface using a separate Codex worker. Use this skill whenever the user invokes `/better-review`, says "BetterReview this branch", asks to review a PR or branch diff with BetterReview, wants a Codex-generated review tree, or asks to launch the BetterReview viewer. Triggers any time the user wants human-friendly review cards rendered in a local viewer instead of a flat file diff. The skill orchestrates a viewer process and a fire-and-forget review worker — do not attempt to review the code yourself when this skill is available.
---

# BetterReview

## Why this skill exists

Coding agents now produce large branch diffs in minutes. The default review surface — a flat list of file diffs — was already a poor fit for human-authored PRs and is actively hostile for agent-authored ones. BetterReview replaces that flat list with a three-level card tree:

1. **Level 1 (Overview)** — one card that orients the reviewer and recommends the order to read the changes in.
2. **Level 2 (Change cards)** — 3–6 cards, one per conceptual change, written for a human deciding whether they agree with the change.
3. **Level 3 (Evidence cards)** — short cards under each change with the actual code snippets, diagrams, or pseudocode that prove the Level 2 claims.

The cards are Markdown files with frontmatter, written into `.better-review/current/cards/` by a Codex worker, and rendered by a single-file React+Babel app at `examples/BetterReview-Sample-UI.html` served on `http://127.0.0.1:3020`.

## Your role: orchestrator, not reviewer

You are the **host agent**. You do **not** review the code yourself. You set up the runtime, launch the viewer, kick off the worker, and hand control back to the user. The actual review is done by a **second** Codex agent — the **worker agent** — that BetterReview spawns by talking JSON-RPC to `codex app-server`. Two Codex sessions, two roles:

| Role | Process | Job |
| --- | --- | --- |
| Host agent (you) | This Codex thread | Orchestrate: verify runtime, launch viewer, kick off worker, report status |
| Worker agent | Spawned by `review-worker.mjs` via `codex app-server --listen stdio://` | Read the diff, write Markdown cards into `.better-review/current/cards/`, then exit |

This split exists because card generation can take 1–3 minutes and writes many files. If you tried to do it inside the user's main thread, the user would be locked out the whole time. Fire-and-forget is the whole point.

## What lives where

The plugin ships these scripts in `plugins/better-review/scripts/`:

- **`launch-viewer.mjs`** — tiny Node HTTP server. Idempotent: detects an existing BetterReview server on `127.0.0.1:3020` (via `GET /api/health` returning `{ok:true,app:"better-review"}`) and exits cleanly if one is already up. Otherwise, it starts a server that serves `examples/BetterReview-Sample-UI.html` and exposes:
  - `GET /api/health` — liveness probe used for idempotency.
  - `GET /api/review-status` — the manifest plus the list of card filenames.
- **`start-review.mjs`** — prepares a review session and spawns the worker:
  1. Resolves the git root from `--target` (defaults to cwd).
  2. Resolves the diff base: `--base <ref>` if provided, else upstream merge-base, else `origin/main`, else `main`. Fails loudly if none have a common ancestor with HEAD.
  3. Rotates the previous `.better-review/current/` into `.better-review/sessions/<timestamp>/` so old runs are preserved.
  4. Writes `manifest.json` with `status: "starting"` and the prompt request file.
  5. Spawns `review-worker.mjs` detached with stdout+stderr piped into `worker.log`, then **exits immediately** with the session paths printed as JSON.
- **`review-worker.mjs`** — the bridge to Codex App Server. You do not invoke this directly; `start-review.mjs` does. It connects to `codex app-server`, validates the model, starts an ephemeral thread restricted to writing only inside the session directory, sends one turn with the full prompt, waits for completion, runs the card validator, and updates `manifest.json` to `completed` (or `failed` with an error message).

## The session directory contract

Every review run lives at `<repo-root>/.better-review/current/`:

```
.better-review/current/
├── manifest.json        # lifecycle state (read by the viewer's /api/review-status)
├── review-request.md    # the full prompt sent to the worker (debug aid)
├── worker.log           # detached worker's stdout + stderr
└── cards/
    ├── overview.md
    ├── change-01-*.md
    ├── change-02-*.md
    ├── evidence-01a-*.md
    └── ...
```

`manifest.json` moves through these states: `starting → running → completed` (or `failed`). Anything reading session state — including the viewer — should poll `manifest.json` rather than try to infer state from card count alone.

`.better-review/` is gitignored. Never commit anything inside it.

## Workflow

Run these steps in order. Most are one shell command each.

### 1. Verify the Codex CLI is installed

The worker depends on `codex app-server`. Check:

```bash
command -v codex >/dev/null && codex --version
```

If `codex` is missing, **stop and tell the user** they need to install it before BetterReview can run. Do not attempt to install it yourself — installation paths vary (Homebrew, bun, npm, direct download) and the user knows their setup. Once they confirm install, continue.

### 2. Launch (or reuse) the viewer

From the repo root:

```bash
npm run dev:app
```

This is the user-facing root script for `npm run launch --workspace better-review`, which runs `node plugins/better-review/scripts/launch-viewer.mjs`. The launcher is idempotent — if a BetterReview viewer is already on `127.0.0.1:3020`, it prints the existing URL and exits with code 0.

Two stdout markers matter:

- `BETTER_REVIEW_URL=http://127.0.0.1:<port>` — capture this; it's the URL to open.
- `BetterReview is already running at ...` — means a server was already there. Same URL, no new process.

The default port is 3020. If it's taken by something else, the launcher walks up to 20 adjacent ports. Read the URL from the actual stdout, don't hardcode it.

### 3. Open the viewer in the user's browser

Open the captured `BETTER_REVIEW_URL` in the Codex browser (or whichever browser surface the host environment provides). Doing this *before* starting the worker means the user watches cards land in real time as the worker writes them.

### 4. Kick off the review worker (fire-and-forget)

From the repo root:

```bash
npm run start-review --workspace better-review
```

This runs `node plugins/better-review/scripts/start-review.mjs` and **returns within a second** with JSON like:

```json
{
  "ok": true,
  "message": "BetterReview generation started.",
  "pid": 12345,
  "sessionDir": ".../.better-review/current",
  "cardsDir":   ".../.better-review/current/cards",
  "manifestPath": ".../.better-review/current/manifest.json",
  "logPath": ".../.better-review/current/worker.log"
}
```

Do **not** wait for completion. The worker is detached. The viewer is already polling `/api/review-status` and will update as cards appear.

### 5. Tell the user what's happening

After step 4, send the user a short message that includes:

- The viewer URL.
- That a worker is generating cards in the background.
- An estimated time (typically 1–3 minutes for a small branch).
- That cards will appear in the viewer as they're written.

Then yield. Do not block on the worker. The user may keep working in this thread; if they ask "is it done?", read `manifest.json` and report the status.

## Error recovery

Most failures surface in `manifest.json` as `status: "failed"` plus an `error` string. The frequent ones:

- **`Could not determine the branch diff base`** — the script could not find a merge base between HEAD and upstream / `origin/main` / `main`. This happens when the branch is detached, when there's no remote, or when HEAD is identical to all candidate bases. Re-run with an explicit base:

  ```bash
  npm run start-review --workspace better-review -- --base <branch-or-sha>
  ```

  Use the trailing `--` so npm forwards the flag to the script, not to itself.

- **`Codex App Server does not list model "<id>"`** — the model id baked into the worker isn't available on this machine's Codex App Server. Override with the env var:

  ```bash
  BETTER_REVIEW_MODEL=<model-id> npm run start-review --workspace better-review
  ```

  If you don't know which models are available, ask the user or have them check `codex` config.

- **`thread/start.<flag> requires experimentalApi capability`** — a future Codex App Server protocol mismatch. The worker file is in `plugins/better-review/scripts/review-worker.mjs`; the offending param will be near the `thread/start` request. Surface the exact error to the user before changing the worker.

- **Worker stops writing cards mid-run** — the agent may have crashed; check `worker.log` for stack traces, and `manifest.json` for `status: "failed"`. The detached worker has a 20-minute hard timeout in `waitForCompletion`.

## Operational discipline

These rules exist because earlier sessions blew them — keep them tight.

- **Do not block** on the review worker. Step 4 returns in under a second by design.
- **Do not edit cards** in `.better-review/current/cards/` by hand. The worker owns that directory; manual edits race the validator.
- **Do not commit** `.better-review/`. It's gitignored. If you see it staged, unstage it.
- **Do not build review prompts** inside this skill. Prompt construction lives in `start-review.mjs#buildPrompt`. If the user asks you to "tweak the review style", point them at that function rather than rewriting it inline.
- **Do not invent ports**. Read the actual `BETTER_REVIEW_URL` line from the launcher's output.

## Useful environment variables

- `BETTER_REVIEW_MODEL` — override the model id sent to `codex app-server`. Default is whatever's hardcoded in `review-worker.mjs` and `start-review.mjs`.
- `BETTER_REVIEW_TARGET` — override the git work tree path. Default is `cwd`. Use this when reviewing a different repo from where the host agent is running.
- `PORT` — override the launcher's preferred port (default 3020). Rarely needed.
- `BETTER_REVIEW_PORT_ATTEMPTS` — how many adjacent ports the launcher tries before giving up (default 20).

## Example session

A typical end-to-end invocation, condensed:

```
> /better-review
[host agent verifies codex CLI]
[host agent runs `npm run dev:app`, captures BETTER_REVIEW_URL=http://127.0.0.1:3020]
[host agent opens that URL in the browser]
[host agent runs `npm run start-review --workspace better-review`]
[host agent reports: "Viewer's open at http://127.0.0.1:3020. Worker pid 12345 is generating cards;
  expect 1–3 minutes. Watch the viewer — cards appear as they're written."]
[host agent yields]
```

If the user later asks "how's it going?", the host agent reads `manifest.json` and reports `status` + card count. It does not re-trigger the worker.
