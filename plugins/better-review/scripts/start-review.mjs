#!/usr/bin/env node
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MODEL = process.env.BETTER_REVIEW_MODEL ?? "gpt-5.4";
const SERVICE_TIER = "fast";
const EFFORT = "low";
const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SESSION_DIR_NAME = ".better-review";
const OUTPUT_LIMIT = 8 * 1024 * 1024;

function parseArgs(argv) {
  const args = {
    target:
      process.env.BETTER_REVIEW_TARGET ?? process.env.INIT_CWD ?? process.cwd(),
    base: null,
    dryRun: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target") {
      args.target = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--base") {
      args.base = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 20_000,
    maxBuffer: OUTPUT_LIMIT,
  });

  return stdout.trim();
}

async function gitOrNull(cwd, args) {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveGitRoot(target) {
  const targetPath = path.resolve(target);
  return git(targetPath, ["rev-parse", "--show-toplevel"]);
}

async function resolveBase(gitRoot, requestedBase) {
  const candidates = [];

  if (requestedBase) {
    candidates.push({
      label: requestedBase,
      ref: requestedBase,
      required: true,
    });
  } else {
    const upstream = await gitOrNull(gitRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);

    if (upstream) {
      candidates.push({
        label: `upstream ${upstream}`,
        ref: upstream,
        required: false,
      });
    }

    candidates.push(
      { label: "origin/main", ref: "origin/main", required: false },
      { label: "main", ref: "main", required: false },
    );
  }

  for (const candidate of candidates) {
    const mergeBase = await gitOrNull(gitRoot, [
      "merge-base",
      candidate.ref,
      "HEAD",
    ]);

    if (mergeBase) {
      return {
        baseRef: candidate.ref,
        baseLabel: candidate.label,
        mergeBase,
      };
    }

    if (candidate.required) {
      break;
    }
  }

  throw new Error(
    "Could not determine the branch diff base. Run again with --base <branch-or-sha>.",
  );
}

async function ensureIgnored(gitRoot) {
  const gitignorePath = path.join(gitRoot, ".gitignore");
  let current = "";

  if (await pathExists(gitignorePath)) {
    current = await readFile(gitignorePath, "utf8");
  }

  if (
    current.split(/\r?\n/).some((line) => line.trim() === ".better-review/")
  ) {
    return;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await writeFile(gitignorePath, `${current}${prefix}.better-review/\n`);
}

function timestampId() {
  return new Date()
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

async function prepareSession(gitRoot) {
  const betterReviewRoot = path.join(gitRoot, SESSION_DIR_NAME);
  const currentDir = path.join(betterReviewRoot, "current");
  const sessionsDir = path.join(betterReviewRoot, "sessions");

  await mkdir(sessionsDir, { recursive: true });

  if (await pathExists(currentDir)) {
    await rename(currentDir, path.join(sessionsDir, timestampId()));
  }

  await mkdir(currentDir, { recursive: true });

  return {
    betterReviewRoot,
    currentDir,
    reviewHtml: path.join(currentDir, "review.html"),
  };
}

async function collectReviewContext(gitRoot, mergeBase) {
  const range = `${mergeBase}...HEAD`;
  const logRange = `${mergeBase}..HEAD`;

  const [headRef, headSha, diffStat, nameStatus, commits, diff] =
    await Promise.all([
      gitOrNull(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      git(gitRoot, ["rev-parse", "HEAD"]),
      gitOrNull(gitRoot, [
        "diff",
        "--stat",
        "--no-color",
        "--no-ext-diff",
        range,
      ]),
      gitOrNull(gitRoot, [
        "diff",
        "--name-status",
        "--no-color",
        "--no-ext-diff",
        range,
      ]),
      gitOrNull(gitRoot, ["log", "--oneline", "--decorate=short", logRange]),
      gitOrNull(gitRoot, ["diff", "--no-color", "--no-ext-diff", range]),
    ]);

  return {
    headRef: headRef ?? "HEAD",
    headSha,
    diffStat: diffStat ?? "",
    nameStatus: nameStatus ?? "",
    commits: commits ?? "",
    diff: diff ?? "",
  };
}

async function buildPrompt({ gitRoot, session, base, context }) {
  const templatePath = path.join(
    REPO_ROOT,
    "examples",
    "BetterReview-Template.html",
  );
  const templateHtml = await readFile(templatePath, "utf8");
  const prd = await readFile(path.join(REPO_ROOT, "docs", "prd.md"), "utf8");

  return `You are the BetterReview review-output generator.

Your job: produce a single self-contained HTML file that renders a human-friendly,
swipeable review of the current branch's diff. You do this by COPYING an existing
template and editing only two clearly-marked regions inside it.

# Output

Write exactly one file: ${session.reviewHtml}

The file MUST be a copy of the template at ${templatePath}, with two regions
replaced (and ONLY those two regions). The regions are HTML-comment marked:

  <!-- BEGIN PR_DATA -->
    <script type="text/babel" data-presets="env,react" data-type="module" id="pr-data">
      ... your new PR_DATA goes here ...
    </script>
  <!-- END PR_DATA -->

  <!-- BEGIN DIAGRAMS -->
    <script type="text/babel" data-presets="env,react" data-type="module" id="diagrams">
      ... your new diagrams registry goes here ...
    </script>
  <!-- END DIAGRAMS -->

Everything outside those two regions — the CSS, the React App component, the
Babel/React script tags — MUST be byte-for-byte identical to the template.
Treat the rest of the file as immutable.

# What to put in PR_DATA

\`window.PR_DATA\` is the single object that drives the entire review UI. Its shape
is documented by the example PR_DATA already in the template. Match it exactly:

\`\`\`js
window.PR_DATA = {
  meta: {
    repo: "<owner/repo>",
    branch: "<head branch name>",
    base: "<base ref>",
    title: "<short PR title — synthesize from commits/diff>",
    author: "codex-agent",
    authorKind: "agent",
    runId: "<short opaque id>",
    createdAt: "just now",
    filesChanged: <n>,
    additions: <n>,
    deletions: <n>,
    commits: <n>,
    intent: "<2-3 sentence framing of what the agent was asked to do>"
  },
  summary: {
    headline: "<one-sentence overall description>",
    bullets: [ "<5 short bullets — what's in this PR>" ],
    risks:   [ { level: "low|med|high", text: "<one risk per line>" } ]
  },
  changes: [ /* 3 to 6 conceptual changes — see prescription below */ ]
};
\`\`\`

## The change prescription (read carefully — this is non-negotiable)

Every entry in \`changes\` MUST have EXACTLY these four \`depths\` in this order:

  depths[0] — kind: "summary"     — one sentence, plain English, ≤ 200 chars.
                                    Tone: "what does this conceptual change do?".
  depths[1] — kind: "diagram"     — set \`schema: "<unique-name>"\`. The DIAGRAMS
                                    region MUST then export a function for that
                                    schema name returning JSX. Diagrams are how
                                    the reviewer sees the change in context;
                                    favour sequence diagrams, before/after,
                                    architecture sketches, state machines.
  depths[2] — kind: "pseudocode"  — array under \`files\`, NOT a string under
                                    \`body\`. Each entry is { file, text } where
                                    \`text\` is one or two NATURAL-LANGUAGE
                                    English sentences describing what changed
                                    in that file. Like:
                                       { file: "src/agent/index.ts",
                                         text: "Attach the new tool into the
                                                agent so it shows up in the UI." }
                                    One entry per file actually touched in this
                                    conceptual change. Do NOT cram multiple
                                    files into one entry. Do NOT include code.
  depths[3] — kind: "diff"        — exactly one \`file\` plus a \`hunks\` array.
                                    Each hunk has a header and a \`lines\` array
                                    of { t, n } where \`t\` is "add" | "del" |
                                    "ctx". Keep hunks tight — the most
                                    illustrative slice, not the entire file.
                                    20-40 lines max per hunk.

Each change's frontmatter:
  id: "<kebab-case>"     - stable id used in the lattice
  title: "<3-6 words>"   - shown on the rail
  tag: "<2 words>"       - e.g. "new module", "behaviour change", "removal"
  scope: "<dir/>"        - dominant directory affected
  filesTouched: <n>      - count
  additions: <n>         - additions in this conceptual change only
  deletions: <n>         - deletions in this conceptual change only

Order changes by the order a human should review them: foundations / data
shape first, behaviour shifts in the middle, removals / cleanup last.

# What to put in DIAGRAMS

The DIAGRAMS region defines \`window.Diagram\`, a React component that switches
on a \`schema\` string and returns JSX. Reuse the template's helper components
(\`DiagramFrame\`, \`Box\`, \`Arrow\`) — they're declared inside the same region in
the template, copy them through unchanged. After the helpers, define one
function PER UNIQUE \`schema\` value referenced in your PR_DATA's diagram depths,
and end with:

  function Diagram({ schema }) {
    switch (schema) {
      case "<schema-1>": return <YourSchemaOne />;
      case "<schema-2>": return <YourSchemaTwo />;
      // one case per change
      default: return <DiagramFrame caption="diagram" />;
    }
  }
  window.Diagram = Diagram;

The diagrams ARE the visual punch of this review surface. Make them matter.
Use the existing template's diagrams (TenantFifoQueue, BeforeAfterDispatch,
AttemptStateMachine) as the bar — boxes labelled with file names, arrows
labelled with verbs, before/after splits divided by a dashed line, schema
tables for migrations. Keep them at viewBox="0 0 720 420". No clipart, no
emoji, no decorative gradients. Schematic and clean.

# What you must NOT do

- Do NOT edit any other files — not source code, not docs, not configs.
- Do NOT touch anything outside the two BEGIN/END marker regions.
- Do NOT replace the template's React App component or its CSS.
- Do NOT introduce new <script> tags. If you need helpers, define them inside
  one of the two existing inline scripts.
- Do NOT use external image URLs. Diagrams are inline SVG only.
- Do NOT escape the JSX — the template uses Babel-standalone, so JSX is the
  authoring language for both inline scripts. Do NOT pre-compile.

# Workflow

1. Read the template file at: ${templatePath}
2. Read the diff context provided below to understand what changed.
3. Identify 3 to 6 conceptual changes. For each, plan its 4 depths
   (summary sentence, diagram schema, file-by-file pseudocode, illustrative
   diff hunk).
4. Write the new PR_DATA literal.
5. Write the new DIAGRAMS region (helpers + one function per schema +
   window.Diagram switch).
6. Produce the final file: copy the template byte-for-byte, then substitute
   ONLY the contents between the two BEGIN/END marker pairs with your new
   versions. Save to: ${session.reviewHtml}
7. After saving, do not write anything else.

# Review target

- Git root: ${gitRoot}
- Base ref: ${base.baseRef}
- Base label: ${base.baseLabel}
- Merge base: ${base.mergeBase}
- Head ref: ${context.headRef}
- Head sha: ${context.headSha}

Branch commits:
\`\`\`
${context.commits || "No commits found in range."}
\`\`\`

Changed files:
\`\`\`
${context.nameStatus || "No changed files found."}
\`\`\`

Diff stat:
\`\`\`
${context.diffStat || "No diff stat found."}
\`\`\`

Full branch diff:
\`\`\`diff
${context.diff || "No diff found."}
\`\`\`

# Product context (BetterReview's PRD — for tone + intent)

\`\`\`md
${prd}
\`\`\`

# The template (canonical source — copy this, then edit only the marked regions)

\`\`\`html
${templateHtml}
\`\`\`
`;
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const gitRoot = await resolveGitRoot(args.target);
  const base = await resolveBase(gitRoot, args.base);
  const context = await collectReviewContext(gitRoot, base.mergeBase);
  const dryRunSession = {
    currentDir: path.join(gitRoot, SESSION_DIR_NAME, "current"),
    reviewHtml: path.join(gitRoot, SESSION_DIR_NAME, "current", "review.html"),
  };
  const prompt = await buildPrompt({
    gitRoot,
    session: dryRunSession,
    base,
    context,
  });

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          gitRoot,
          base,
          headRef: context.headRef,
          headSha: context.headSha,
          model: MODEL,
          serviceTier: SERVICE_TIER,
          effort: EFFORT,
          promptBytes: Buffer.byteLength(prompt, "utf8"),
          reviewHtml: dryRunSession.reviewHtml,
        },
        null,
        2,
      ),
    );
    return;
  }

  await ensureIgnored(gitRoot);
  const session = await prepareSession(gitRoot);
  const requestPath = path.join(session.currentDir, "review-request.md");
  const manifestPath = path.join(session.currentDir, "manifest.json");
  const logPath = path.join(session.currentDir, "worker.log");
  const finalPrompt = await buildPrompt({ gitRoot, session, base, context });

  await writeFile(requestPath, finalPrompt);
  await writeJson(manifestPath, {
    status: "starting",
    target: {
      gitRoot,
      baseRef: base.baseRef,
      baseLabel: base.baseLabel,
      mergeBase: base.mergeBase,
      headRef: context.headRef,
      headSha: context.headSha,
    },
    model: MODEL,
    serviceTier: SERVICE_TIER,
    effort: EFFORT,
    reviewHtml: session.reviewHtml,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const logFd = openSync(logPath, "a");
  const worker = spawn(
    process.execPath,
    [
      path.join(PLUGIN_ROOT, "scripts", "review-worker.mjs"),
      "--session",
      session.currentDir,
      "--target",
      gitRoot,
    ],
    {
      cwd: gitRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );

  worker.unref();

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "BetterReview generation started.",
        pid: worker.pid,
        sessionDir: session.currentDir,
        reviewHtml: session.reviewHtml,
        manifestPath,
        logPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
