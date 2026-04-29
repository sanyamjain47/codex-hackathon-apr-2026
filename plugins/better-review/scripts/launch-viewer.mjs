#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? "3020", 10);
const MAX_PORT_ATTEMPTS = Number.parseInt(
  process.env.BETTER_REVIEW_PORT_ATTEMPTS ?? "20",
  10
);
const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");
const TARGET_ROOT = path.resolve(process.env.BETTER_REVIEW_TARGET ?? REPO_ROOT);
const VIEWER_INDEX = path.join(REPO_ROOT, "examples", "BetterReview-Sample-UI.html");
const REVIEW_ROOT = path.join(TARGET_ROOT, ".better-review", "current");
const CARDS_DIR = path.join(REVIEW_ROOT, "cards");

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, HOST);
  });
}

async function findAvailablePort(startPort) {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;

    if (await isBetterReviewRunning(port)) {
      return { port, reuse: true };
    }
  }

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;

    if (await isPortAvailable(port)) {
      return { port, reuse: false };
    }
  }

  throw new Error(
    `No available local port found from ${startPort} to ${
      startPort + MAX_PORT_ATTEMPTS - 1
    }.`
  );
}

async function isBetterReviewRunning(port) {
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1000)
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.json();

    return body?.app === "better-review";
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listCards() {
  try {
    const entries = await readdir(CARDS_DIR, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function buildReviewStatus() {
  const manifest = await readJsonIfPresent(path.join(REVIEW_ROOT, "manifest.json"));
  const cards = await listCards();

  return {
    ok: true,
    status: manifest?.status ?? "waiting",
    message: manifest
      ? "Review session found."
      : "No BetterReview session has started yet.",
    targetRoot: TARGET_ROOT,
    reviewRoot: REVIEW_ROOT,
    cardsDir: CARDS_DIR,
    cardCount: cards.length,
    cards,
    manifest
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, app: "better-review" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/review-status") {
    sendJson(response, 200, await buildReviewStatus());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(await readFile(VIEWER_INDEX, "utf8"));
    return;
  }

  sendJson(response, 404, {
    ok: false,
    message: "Not found."
  });
}

const { port, reuse } = await findAvailablePort(DEFAULT_PORT);
const url = `http://${HOST}:${port}`;

if (reuse) {
  console.log(`BetterReview is already running at ${url}`);
  console.log(`BETTER_REVIEW_URL=${url}`);
  process.exit(0);
}

console.log(`Starting BetterReview at ${url}`);
console.log(`BETTER_REVIEW_URL=${url}`);

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "Unexpected server error."
    });
  });
});

server.listen(port, HOST, () => {
  console.log(`BetterReview static viewer ready at ${url}`);
});
