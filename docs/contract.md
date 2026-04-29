# BetterReview review-output contract

This is the contract the **review-worker agent** must satisfy when it produces
a BetterReview review. It is designed to be cheap to obey and easy to verify —
the validator (`plugins/better-review/scripts/validate-review.mjs`) checks the
mechanical bits, the viewer renders what the agent wrote.

## TL;DR

- The agent's output is a single self-contained file: `.better-review/current/review.html`.
- That file is a copy of `examples/BetterReview-Template.html` with **only two
  regions edited**, each marked with HTML comments:
  - `<!-- BEGIN PR_DATA --> ... <!-- END PR_DATA -->`
  - `<!-- BEGIN DIAGRAMS --> ... <!-- END DIAGRAMS -->`
- Everything outside those two regions (CSS, the React App component, the
  React/ReactDOM/Babel `<script>` tags) is byte-for-byte identical to the template.
- The agent never edits any other file. The sandbox enforces this.

## Why this shape

We tried a Markdown card tree first. It worked but produced text-heavy review
output that didn't fit the swipeable canvas the UI is built around. Switching
to "edit the template directly" gave us:

- **Visual flexibility**: the agent can author arbitrary inline SVG diagrams,
  not just pick from a fixed set of card types.
- **One artifact**: the file the agent writes IS the rendered page. No parser,
  no client-side Markdown-to-HTML, no per-card fetch. Open it in any browser
  with internet (for the React/Babel CDN tags) and it just renders.
- **Simpler validator**: a few text-level checks instead of a YAML/Markdown
  parse + tree integrity check.
- **Smaller blast radius for agent mistakes**: the marked regions constrain
  what can break.

## The PR_DATA region

The first region defines `window.PR_DATA`, a JS object that drives the entire
UI. Shape:

```js
window.PR_DATA = {
  meta: {
    repo:          "<owner/repo>",
    branch:        "<head branch name>",
    base:          "<base ref>",
    title:         "<short PR title>",
    author:        "codex-agent",
    authorKind:    "agent",
    runId:         "<short opaque id>",
    createdAt:     "just now",
    filesChanged:  <int>,
    additions:     <int>,
    deletions:     <int>,
    commits:       <int>,
    intent:        "<2-3 sentence framing of the original ask>"
  },
  summary: {
    headline: "<one-sentence overall description>",
    bullets:  [ "<5 short bullets — what's in this PR>" ],
    risks:    [ { level: "low" | "med" | "high", text: "<one risk per line>" } ]
  },
  changes: [ /* 3 to 6 conceptual changes, each shaped as below */ ]
};
```

Each `changes[i]` carries rail metadata plus exactly four ordered depth
entries:

```js
{
  id:           "<kebab-case unique slug>",
  title:        "<3-6 words>",
  tag:          "<2 words — e.g. 'new module', 'behaviour change', 'removal'>",
  scope:        "<dominant directory affected, e.g. 'workers/queue/'>",
  filesTouched: <int>,
  additions:    <int>,
  deletions:    <int>,
  depths: [
    /* depth[0] */ { kind: "summary",    label: "...", body:  "..." },
    /* depth[1] */ { kind: "diagram",    label: "...", schema: "..." },
    /* depth[2] */ { kind: "pseudocode", label: "...", files: [ {file, text}, ... ] },
    /* depth[3] */ { kind: "diff",       label: "...", file: "...", hunks: [...] }
  ]
}
```

### The four prescribed depths (read carefully — order is fixed)

Every change in the lattice has these four depths in this order. No exceptions.

#### depths[0] — summary

```js
{ kind: "summary", label: "<short label>", body: "<one English sentence, ≤200 chars>" }
```

The reviewer sees this first when they swipe to the change. Lead with the
verb. Not "What this does is..." — just the thing it does.

#### depths[1] — diagram

```js
{ kind: "diagram", label: "<short label>", schema: "<unique-name>" }
```

`schema` is a string identifier. The DIAGRAMS region (below) must export a
React component for that exact schema name. The viewer's `Diagram` registry
looks it up. Diagrams are how the reviewer sees the change in context — favour
sequence diagrams, before/after splits, architecture sketches, state machines,
schema tables. No clipart. No emoji. Schematic and clean.

#### depths[2] — pseudocode

```js
{
  kind: "pseudocode",
  label: "What changed file by file",
  files: [
    { file: "src/agent/index.ts", text: "Attach the new tool into the agent so it shows up in the UI." },
    { file: "src/agent/index.test.ts", text: "Cover the new tool in the existing agent test scaffold." },
    /* one entry per file actually touched in this conceptual change */
  ]
}
```

`files` is an **array, not a string**. Each entry is `{ file, text }` where
`text` is one or two **natural-language English sentences** describing what
changed in that file. Not pseudo-code in the algorithm sense — pseudo-code in
the "imagine the diff was narrated by a thoughtful engineer" sense. One entry
per file actually touched in this conceptual change. Do not cram multiple
files into one entry. Do not include code.

#### depths[3] — diff

```js
{
  kind: "diff",
  label: "Diff · <filename>",
  file: "<single primary file affected>",
  hunks: [
    {
      header: "@@ -42,7 +42,11 @@",
      lines: [
        { t: "ctx", n: "  unchanged context line" },
        { t: "del", n: "  removed line" },
        { t: "add", n: "  added line" }
      ]
    }
    /* 1-3 hunks, ≤30 changed lines total */
  ]
}
```

`t` is `"add"` | `"del"` | `"ctx"`. Keep hunks tight — show the most
illustrative slice, not the entire file.

## The DIAGRAMS region

The second region defines `window.Diagram`, a React component that switches
on `schema` and returns JSX. Required structure:

```jsx
/* helpers — copy from the template; they handle the visual style */
function DiagramFrame({ children, caption }) { /* ... */ }
function Box({ x, y, w, h, label, sub, kind }) { /* ... */ }
function Arrow({ x1, y1, x2, y2, label, dashed }) { /* ... */ }

/* one function per schema referenced in PR_DATA's diagram depths */
function YourSchemaOne() { return <DiagramFrame caption="..."> /* SVG */ </DiagramFrame>; }
function YourSchemaTwo() { return <DiagramFrame caption="..."> /* SVG */ </DiagramFrame>; }

function Diagram({ schema }) {
  switch (schema) {
    case "your-schema-one": return <YourSchemaOne />;
    case "your-schema-two": return <YourSchemaTwo />;
    default: return <DiagramFrame caption="diagram" />;
  }
}
window.Diagram = Diagram;
```

Helpers (`DiagramFrame`, `Box`, `Arrow`) are reusable building blocks defined
in the existing template — copy them through unchanged unless you have a
specific reason. Diagrams render at viewBox `0 0 720 420`. The CSS provides
useful classes (`dgm-label`, `dgm-sub`, `dgm-edge`, `dgm-section`,
`dgm-mono`).

## What the agent must NOT do

- Do not edit the file outside the two BEGIN/END marker pairs.
- Do not introduce new top-level `<script>` tags. If you need helpers, define
  them inside one of the two existing inline scripts.
- Do not strip the React/ReactDOM/Babel CDN script tags.
- Do not pre-compile JSX. Babel-standalone compiles it at load time.
- Do not use external image URLs. All visuals are inline SVG.
- Do not edit any source files in the repo. The sandbox is configured to
  forbid writes outside `.better-review/current/`.

## Validation

The worker runs `validate-review.mjs` automatically after writing
`review.html`. It checks:

1. The file exists and is at least 10KB.
2. Both BEGIN/END marker pairs are present, ordered, and each appears once.
3. The PR_DATA region assigns `window.PR_DATA` and is at least 500 chars.
4. The DIAGRAMS region assigns `window.Diagram` and is at least 500 chars.
5. The CDN library tags and `ReactDOM.createRoot` mount call are still
   present.

If validation fails, the manifest flips to `status: "failed"` with the error.
The viewer surfaces this state, and `worker.log` has the full trace.
