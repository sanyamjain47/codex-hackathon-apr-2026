#!/usr/bin/env node
// validate-review.mjs
//
// Sanity-check the review.html the worker agent produces. We are deliberately
// loose here — the file is JSX (Babel-compiled at runtime in the browser), so
// node cannot syntax-check it directly. The checks below catch the failure
// modes that would actually break the demo:
//
//   1. The file exists and is non-trivial.
//   2. The four BEGIN/END marker comments are present, ordered, and unique.
//   3. The two inlined <script type="text/babel"> blocks are non-empty.
//   4. PR_DATA-region body contains "window.PR_DATA" and DIAGRAMS-region body
//      contains "window.Diagram".
//   5. The CDN <script> tags for React/ReactDOM/Babel are still present —
//      catches the case where the agent accidentally removed library tags.
//
// Anything more sophisticated (full JSX parse, runtime smoke) is left to the
// browser. The file failing in the browser is also fine — the user can SEE it
// fail in the viewer and the worker.log will surface the manifest's "failed"
// state.

import { readFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { reviewHtml: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--review-html") {
      args.reviewHtml = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fail(msg) {
  console.error(`validate-review: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.reviewHtml) {
    fail("missing --review-html <path>");
  }

  const filePath = path.resolve(args.reviewHtml);
  let html;
  try {
    html = await readFile(filePath, "utf8");
  } catch (err) {
    fail(`cannot read ${filePath}: ${err.message}`);
  }

  if (html.length < 10_000) {
    fail(`${filePath} is suspiciously small (${html.length} bytes)`);
  }

  const markers = [
    "<!-- BEGIN PR_DATA -->",
    "<!-- END PR_DATA -->",
    "<!-- BEGIN DIAGRAMS -->",
    "<!-- END DIAGRAMS -->"
  ];
  const positions = markers.map((m) => html.indexOf(m));
  for (let i = 0; i < markers.length; i += 1) {
    if (positions[i] === -1) {
      fail(`marker missing: ${markers[i]}`);
    }
    if (html.indexOf(markers[i], positions[i] + markers[i].length) !== -1) {
      fail(`marker appears more than once: ${markers[i]}`);
    }
  }
  if (!(positions[0] < positions[1] && positions[1] < positions[2] && positions[2] < positions[3])) {
    fail("markers are out of order — expected PR_DATA region then DIAGRAMS region");
  }

  const prDataBody = html.slice(positions[0] + markers[0].length, positions[1]).trim();
  const diagramsBody = html.slice(positions[2] + markers[2].length, positions[3]).trim();

  if (!prDataBody.includes("window.PR_DATA")) {
    fail("PR_DATA region does not assign window.PR_DATA");
  }
  if (!diagramsBody.includes("window.Diagram")) {
    fail("DIAGRAMS region does not assign window.Diagram");
  }
  if (prDataBody.length < 500) {
    fail(`PR_DATA region is too short (${prDataBody.length} chars) — likely empty or stub`);
  }
  if (diagramsBody.length < 500) {
    fail(`DIAGRAMS region is too short (${diagramsBody.length} chars) — likely empty or stub`);
  }

  // Library tags must still be present; the agent must not have stripped them.
  for (const lib of ["react.production.min.js", "react-dom@18", "@babel/standalone"]) {
    if (!html.includes(lib)) {
      fail(`library reference missing: ${lib}`);
    }
  }

  // Sanity: the App entrypoint mount call must still be present.
  if (!html.includes("ReactDOM.createRoot")) {
    fail("App entrypoint missing — ReactDOM.createRoot call not found");
  }

  console.log(
    `validate-review: ok (${html.length} bytes; PR_DATA region ${prDataBody.length} chars; DIAGRAMS region ${diagramsBody.length} chars)`
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
