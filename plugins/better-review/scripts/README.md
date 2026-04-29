# Scripts

Helper scripts for the BetterReview plugin. Two of them are run by the user
(directly or through the `/better-review` skill); the other two are internal.

## `launch-viewer.mjs` (user-facing)

Tiny static HTTP server on `127.0.0.1:3020` (idempotent — reuses an existing
server if one is already running). Serves the review at `/`:

- if `<repo-root>/.better-review/current/review.html` exists, that file is served
- otherwise the editable template `examples/BetterReview-Template.html` is served

It also exposes:

- `GET /api/health` — `{ok: true, app: "better-review"}` (used for idempotency)
- `GET /api/review-status` — manifest + `hasReview` flag

The first stdout line of the form `BETTER_REVIEW_URL=http://127.0.0.1:<port>`
is the URL the skill captures and opens.

## `start-review.mjs` (user-facing)

Resolves the branch diff base, prepares `.better-review/current/`, writes a
request file with the full prompt, persists `manifest.json` in `starting`
state, and spawns `review-worker.mjs` detached. Returns within ~1s with the
session paths printed as JSON.

Flags:

- `--target <path>` — git work tree to review. Defaults to cwd.
- `--base <ref|sha>` — diff base. Defaults to upstream merge-base, then
  `origin/main`, then `main`. Use this when the script can't infer a base.
- `--dry-run` — resolve base + build the prompt, but do NOT spawn the worker.
  Prints the resolved values as JSON. Useful for sanity checks.

## `review-worker.mjs` (internal)

Spawned by `start-review.mjs`. Talks JSON-RPC to `codex app-server --listen
stdio://`, validates the model is available, starts a thread restricted to
writing only inside the session directory, sends one turn with the full
prompt, waits for completion, runs `validate-review.mjs`, and updates
`manifest.json` to `completed` or `failed`.

You should never invoke this directly.

## `validate-review.mjs` (internal)

Sanity-check on the `review.html` the worker produces. Asserts:

- file exists and is non-trivial in size
- the four `<!-- BEGIN/END PR_DATA -->` and `<!-- BEGIN/END DIAGRAMS -->`
  marker comments are present, ordered, and unique
- the inlined PR_DATA region assigns `window.PR_DATA`
- the inlined DIAGRAMS region assigns `window.Diagram`
- the React/ReactDOM/Babel `<script>` tags weren't accidentally removed
- the `ReactDOM.createRoot` mount call is still present

Anything more sophisticated (full JSX parse, runtime smoke) is left to the
browser. The validator is run automatically by `review-worker.mjs` after the
worker turn completes.

## `seed-fixture.mjs` (developer aid)

Copies `examples/BetterReview-Template.html` (the canonical editable
template, complete with a sample PR_DATA mock) into `.better-review/current/`
as `review.html`, and writes a synthetic manifest. Lets you iterate on the
launcher / template / SKILL.md without burning Codex App Server calls.

```bash
npm run seed:review-fixture
```
