#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODEL = process.env.BETTER_REVIEW_MODEL ?? "gpt-5.5";
const SERVICE_TIER = "fast";
const EFFORT = "low";

function parseArgs(argv) {
  const args = {
    session: null,
    target: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--session") {
      args.session = argv[index + 1];
      index += 1;
      continue;
    }

    if (argv[index] === "--target") {
      args.target = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argv[index]}`);
  }

  if (!args.session || !args.target) {
    throw new Error("Usage: review-worker.mjs --session <dir> --target <git-root>");
  }

  args.session = path.resolve(args.session);
  args.target = path.resolve(args.target);
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function updateManifest(sessionDir, patch) {
  const manifestPath = path.join(sessionDir, "manifest.json");
  const current = await readJson(manifestPath);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  await writeJson(manifestPath, next);
  return next;
}

class AppServerClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.onNotification = () => {};

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk;

    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);

      if (!line) {
        continue;
      }

      let message;

      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write(`Ignoring non-JSON app-server output: ${line}\n`);
        continue;
      }

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        } else {
          resolve(message.result);
        }
        continue;
      }

      this.onNotification(message);
    }
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;

    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  stop() {
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}

async function validateModel(client) {
  const response = await client.request("model/list", {
    includeHidden: true,
    limit: 200
  });
  const models = response?.data ?? [];
  const selectedModel = models.find((model) => model.model === MODEL || model.id === MODEL);

  if (!selectedModel) {
    throw new Error(`Codex App Server does not list model "${MODEL}".`);
  }

  if (
    SERVICE_TIER === "fast" &&
    Array.isArray(selectedModel.additionalSpeedTiers) &&
    !selectedModel.additionalSpeedTiers.includes("fast")
  ) {
    throw new Error(`Codex App Server model "${MODEL}" does not advertise fast service tier.`);
  }
}

async function validateCards(cardsDir) {
  await execFileAsync(
    process.execPath,
    [path.join(PLUGIN_ROOT, "scripts", "validate-cards.mjs"), "--cards-dir", cardsDir],
    {
      cwd: path.resolve(PLUGIN_ROOT, "../.."),
      timeout: 20_000,
      maxBuffer: 1024 * 1024
    }
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.join(args.session, "manifest.json");
  const requestPath = path.join(args.session, "review-request.md");
  const manifest = await updateManifest(args.session, {
    status: "running",
    error: null
  });
  const prompt = await readFile(requestPath, "utf8");
  const appServer = spawn("codex", ["app-server", "--listen", "stdio://"], {
    cwd: args.target,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new AppServerClient(appServer);

  try {
    await client.request("initialize", {
      clientInfo: {
        name: "better-review",
        version: "0.1.0"
      },
      capabilities: null
    });

    await validateModel(client);

    const threadResponse = await client.request("thread/start", {
      model: MODEL,
      serviceTier: SERVICE_TIER,
      cwd: args.target,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      serviceName: "BetterReview",
      developerInstructions:
        "You are running as the BetterReview card generator. You must write only review card Markdown files inside the requested .better-review/current/cards directory and must never edit source code.",
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });

    const threadId = threadResponse.thread.id;

    await client.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: []
        }
      ],
      cwd: args.target,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [args.session],
        readOnlyAccess: {
          type: "restricted",
          includePlatformDefaults: true,
          readableRoots: [args.target]
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      },
      model: MODEL,
      serviceTier: SERVICE_TIER,
      effort: EFFORT,
      summary: "none"
    });

    await waitForCompletion(client, threadId);
    await validateCards(manifest.cardsDir);
    await updateManifest(args.session, {
      status: "completed",
      error: null,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    await writeJson(manifestPath, {
      ...manifest,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    });
    process.exitCode = 1;
  } finally {
    client.stop();
  }
}

function waitForCompletion(client, threadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Codex review generation to finish."));
    }, 20 * 60 * 1000);

    client.onNotification = (message) => {
      if (message.method === "turn/completed" && message.params?.threadId === threadId) {
        clearTimeout(timeout);
        resolve();
        return;
      }

      if (message.method === "error" && message.params?.threadId === threadId) {
        clearTimeout(timeout);
        reject(new Error(message.params.error?.message ?? "Codex review generation failed."));
      }
    };
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
