#!/usr/bin/env node
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
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
    target: process.env.BETTER_REVIEW_TARGET ?? process.env.INIT_CWD ?? process.cwd(),
    base: null,
    dryRun: false
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
    maxBuffer: OUTPUT_LIMIT
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
    candidates.push({ label: requestedBase, ref: requestedBase, required: true });
  } else {
    const upstream = await gitOrNull(gitRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}"
    ]);

    if (upstream) {
      candidates.push({ label: `upstream ${upstream}`, ref: upstream, required: false });
    }

    candidates.push(
      { label: "origin/main", ref: "origin/main", required: false },
      { label: "main", ref: "main", required: false }
    );
  }

  for (const candidate of candidates) {
    const mergeBase = await gitOrNull(gitRoot, ["merge-base", candidate.ref, "HEAD"]);

    if (mergeBase) {
      return {
        baseRef: candidate.ref,
        baseLabel: candidate.label,
        mergeBase
      };
    }

    if (candidate.required) {
      break;
    }
  }

  throw new Error(
    "Could not determine the branch diff base. Run again with --base <branch-or-sha>."
  );
}

async function ensureIgnored(gitRoot) {
  const gitignorePath = path.join(gitRoot, ".gitignore");
  let current = "";

  if (await pathExists(gitignorePath)) {
    current = await readFile(gitignorePath, "utf8");
  }

  if (current.split(/\r?\n/).some((line) => line.trim() === ".better-review/")) {
    return;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await writeFile(gitignorePath, `${current}${prefix}.better-review/\n`);
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
}

async function prepareSession(gitRoot) {
  const betterReviewRoot = path.join(gitRoot, SESSION_DIR_NAME);
  const currentDir = path.join(betterReviewRoot, "current");
  const sessionsDir = path.join(betterReviewRoot, "sessions");

  await mkdir(sessionsDir, { recursive: true });

  if (await pathExists(currentDir)) {
    await rename(currentDir, path.join(sessionsDir, timestampId()));
  }

  await mkdir(path.join(currentDir, "cards"), { recursive: true });

  return {
    betterReviewRoot,
    currentDir,
    cardsDir: path.join(currentDir, "cards")
  };
}

async function collectReviewContext(gitRoot, mergeBase) {
  const range = `${mergeBase}...HEAD`;
  const logRange = `${mergeBase}..HEAD`;

  const [headRef, headSha, diffStat, nameStatus, commits, diff] = await Promise.all([
    gitOrNull(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(gitRoot, ["rev-parse", "HEAD"]),
    gitOrNull(gitRoot, ["diff", "--stat", "--no-color", "--no-ext-diff", range]),
    gitOrNull(gitRoot, ["diff", "--name-status", "--no-color", "--no-ext-diff", range]),
    gitOrNull(gitRoot, ["log", "--oneline", "--decorate=short", logRange]),
    gitOrNull(gitRoot, ["diff", "--no-color", "--no-ext-diff", range])
  ]);

  return {
    headRef: headRef ?? "HEAD",
    headSha,
    diffStat: diffStat ?? "",
    nameStatus: nameStatus ?? "",
    commits: commits ?? "",
    diff: diff ?? ""
  };
}

async function buildPrompt({ gitRoot, session, base, context }) {
  const contract = await readFile(path.join(PLUGIN_ROOT, "docs", "contract.md"), "utf8");
  const prd = await readFile(path.join(PLUGIN_ROOT, "docs", "prd.md"), "utf8");

  return `You are the BetterReview review-card generator.

Your only job is to inspect the branch diff and write Markdown review cards for a human reviewer.

Hard rules:
- Write files only inside: ${session.cardsDir}
- Do not edit source code, docs, configs, package files, git metadata, or any file outside ${session.cardsDir}.
- Use the Markdown/frontmatter contract exactly as described below.
- Generate 3-6 Level 2 conceptual change cards unless the branch is genuinely smaller.
- Write cards sequentially by conceptual change: overview, then change 1 plus its evidence, then change 2 plus its evidence, and so on.
- Use filenames like overview.md, change-01-short-slug.md, evidence-01a-short-slug.md.
- Level 2 cards are conceptual changes, not file summaries.
- Level 3 evidence cards must include concrete code evidence with relevant diff snippets, why they matter, and what the reviewer should verify.
- Prefer fewer, higher-quality cards over many shallow cards.

Output directory:
${session.cardsDir}

Review target:
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

Product context:
\`\`\`md
${prd}
\`\`\`

Card contract:
\`\`\`md
${contract}
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
    cardsDir: path.join(gitRoot, SESSION_DIR_NAME, "current", "cards")
  };
  const prompt = await buildPrompt({
    gitRoot,
    session: dryRunSession,
    base,
    context
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
          cardsDir: dryRunSession.cardsDir
        },
        null,
        2
      )
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
      headSha: context.headSha
    },
    model: MODEL,
    serviceTier: SERVICE_TIER,
    effort: EFFORT,
    cardsDir: session.cardsDir,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const logFd = openSync(logPath, "a");
  const worker = spawn(
    process.execPath,
    [
      path.join(PLUGIN_ROOT, "scripts", "review-worker.mjs"),
      "--session",
      session.currentDir,
      "--target",
      gitRoot
    ],
    {
      cwd: gitRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd]
    }
  );

  worker.unref();

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "BetterReview generation started.",
        pid: worker.pid,
        sessionDir: session.currentDir,
        cardsDir: session.cardsDir,
        manifestPath,
        logPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
