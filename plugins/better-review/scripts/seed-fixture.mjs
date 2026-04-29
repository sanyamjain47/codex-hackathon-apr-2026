#!/usr/bin/env node
// seed-fixture.mjs
//
// Drop a fixture review.html into .better-review/current/ so the launcher
// renders something without needing a live Codex run. Useful for iterating
// on the UI / launcher without burning App Server time.
//
// Strategy: copy the editable template (which already ships with a sample
// PR_DATA mock) into the session dir as review.html. The launcher serves it.

import { access, copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");

function timestampId() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const templatePath = path.join(REPO_ROOT, "examples", "BetterReview-Template.html");
  const betterReviewRoot = path.join(REPO_ROOT, ".better-review");
  const currentDir = path.join(betterReviewRoot, "current");
  const sessionsDir = path.join(betterReviewRoot, "sessions");
  const reviewHtml = path.join(currentDir, "review.html");

  await mkdir(sessionsDir, { recursive: true });

  if (await pathExists(currentDir)) {
    await rename(currentDir, path.join(sessionsDir, timestampId()));
  }

  await mkdir(currentDir, { recursive: true });
  await copyFile(templatePath, reviewHtml);

  await writeFile(
    path.join(currentDir, "manifest.json"),
    `${JSON.stringify(
      {
        status: "completed",
        target: {
          gitRoot: REPO_ROOT,
          baseRef: "fixture",
          baseLabel: "examples/BetterReview-Template.html",
          mergeBase: "fixture",
          headRef: "fixture",
          headSha: "fixture"
        },
        model: "fixture",
        serviceTier: "fixture",
        effort: "fixture",
        reviewHtml,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "Seeded BetterReview fixture session.",
        reviewHtml
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
