#!/usr/bin/env node
import { copyFile, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
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
  const fixtureDir = path.join(PLUGIN_ROOT, "examples", "review");
  const betterReviewRoot = path.join(REPO_ROOT, ".better-review");
  const currentDir = path.join(betterReviewRoot, "current");
  const sessionsDir = path.join(betterReviewRoot, "sessions");
  const cardsDir = path.join(currentDir, "cards");

  await mkdir(sessionsDir, { recursive: true });

  if (await pathExists(currentDir)) {
    await rename(currentDir, path.join(sessionsDir, timestampId()));
  }

  await mkdir(cardsDir, { recursive: true });

  const entries = await readdir(fixtureDir, { withFileTypes: true });
  const cards = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name.toLowerCase() !== "readme.md"
    )
    .map((entry) => entry.name)
    .sort();

  for (const card of cards) {
    await copyFile(path.join(fixtureDir, card), path.join(cardsDir, card));
  }

  await writeFile(
    path.join(currentDir, "manifest.json"),
    `${JSON.stringify(
      {
        status: "completed",
        target: {
          gitRoot: REPO_ROOT,
          baseRef: "fixture",
          baseLabel: "examples/review",
          mergeBase: "fixture",
          headRef: "fixture",
          headSha: "fixture"
        },
        model: "fixture",
        serviceTier: "fixture",
        effort: "fixture",
        cardsDir,
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
        cardsDir,
        cardCount: cards.length
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
