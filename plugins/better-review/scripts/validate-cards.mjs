#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const VALID_LEVELS = new Set([1, 2, 3]);
const VALID_RISKS = new Set(["low", "medium", "high"]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
const VALID_STATUS = new Set(["unreviewed", "approved", "flagged", "needs-change"]);

function parseArgs(argv) {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const args = {
    cardsDir: path.resolve(cwd, argv[2] ?? "examples/review")
  };

  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--cards-dir") {
      args.cardsDir = path.resolve(cwd, argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function parseScalar(value) {
  if (value === "[]") {
    return [];
  }

  if (value === "null") {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return value.replace(/^"(.*)"$/, "$1");
}

function parseFrontmatter(source, fileName) {
  if (!source.startsWith("---\n")) {
    throw new Error(`${fileName}: missing YAML frontmatter`);
  }

  const end = source.indexOf("\n---", 4);

  if (end === -1) {
    throw new Error(`${fileName}: frontmatter is not closed`);
  }

  const frontmatter = source.slice(4, end).split("\n");
  const data = {};
  let currentArrayKey = null;

  for (const rawLine of frontmatter) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      continue;
    }

    const arrayItem = line.match(/^\s+-\s+(.+)$/);

    if (arrayItem) {
      if (!currentArrayKey) {
        throw new Error(`${fileName}: array item appears before an array key`);
      }

      data[currentArrayKey].push(parseScalar(arrayItem[1].trim()));
      continue;
    }

    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);

    if (!pair) {
      throw new Error(`${fileName}: unsupported frontmatter line "${line}"`);
    }

    const [, key, value] = pair;
    currentArrayKey = null;

    if (value === "") {
      if (key === "labels" || key === "children") {
        data[key] = [];
        currentArrayKey = key;
      } else {
        data[key] = null;
      }
      continue;
    }

    data[key] = parseScalar(value.trim());
  }

  return data;
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function validateCard(card, fileName, errors) {
  assert(typeof card.id === "string" && card.id.length > 0, `${fileName}: id is required`, errors);
  assert(VALID_LEVELS.has(card.level), `${fileName}: level must be 1, 2, or 3`, errors);
  assert(typeof card.title === "string" && card.title.length > 0, `${fileName}: title is required`, errors);
  assert(typeof card.order === "number", `${fileName}: order must be a number`, errors);
  assert(VALID_RISKS.has(card.risk), `${fileName}: risk must be low, medium, or high`, errors);
  assert(VALID_CONFIDENCE.has(card.confidence), `${fileName}: confidence must be low, medium, or high`, errors);
  assert(VALID_STATUS.has(card.status), `${fileName}: status is invalid`, errors);
  assert(Array.isArray(card.labels), `${fileName}: labels must be an array`, errors);
  assert(Array.isArray(card.children), `${fileName}: children must be an array`, errors);

  if (card.level === 1) {
    assert(!card.parent, `${fileName}: level 1 cards must not have a parent`, errors);
  } else {
    assert(typeof card.parent === "string" && card.parent.length > 0, `${fileName}: level ${card.level} cards need a parent`, errors);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const cardsDir = args.cardsDir;
  const entries = await readdir(cardsDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name.toLowerCase() !== "readme.md"
    )
    .map((entry) => entry.name)
    .sort();

  if (markdownFiles.length === 0) {
    throw new Error(`No markdown cards found in ${cardsDir}`);
  }

  const errors = [];
  const cards = new Map();

  for (const fileName of markdownFiles) {
    const source = await readFile(path.join(cardsDir, fileName), "utf8");
    const card = parseFrontmatter(source, fileName);

    validateCard(card, fileName, errors);

    if (cards.has(card.id)) {
      errors.push(`${fileName}: duplicate card id "${card.id}"`);
    }

    cards.set(card.id, { card, fileName });
  }

  const overviewCards = [...cards.values()].filter(({ card }) => card.level === 1);
  assert(overviewCards.length === 1, `expected exactly one level 1 overview card, found ${overviewCards.length}`, errors);

  for (const { card, fileName } of cards.values()) {
    if (card.parent && !cards.has(card.parent)) {
      errors.push(`${fileName}: parent "${card.parent}" does not exist`);
    }

    for (const childId of card.children ?? []) {
      const child = cards.get(childId);

      if (!child) {
        errors.push(`${fileName}: child "${childId}" does not exist`);
        continue;
      }

      if (child.card.parent !== card.id) {
        errors.push(`${fileName}: child "${childId}" does not point back to "${card.id}"`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`BetterReview card validation failed for ${cardsDir}`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validated ${markdownFiles.length} BetterReview cards in ${cardsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
