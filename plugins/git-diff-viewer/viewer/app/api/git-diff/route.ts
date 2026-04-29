import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 1024 * 1024;
const TIMEOUT_MS = 10_000;

export const runtime = "nodejs";

type GitDiffRequest = {
  directory?: unknown;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      message,
      command: "git diff --no-color --no-ext-diff",
      stdout: "",
      stderr: ""
    },
    { status }
  );
}

function validateDirectory(directory: unknown): string | NextResponse {
  if (typeof directory !== "string" || directory.trim().length === 0) {
    return jsonError("Enter an absolute directory path.");
  }

  const resolvedDirectory = path.resolve(directory.trim());

  if (!path.isAbsolute(directory.trim())) {
    return jsonError("Directory must be an absolute path.");
  }

  if (!existsSync(resolvedDirectory)) {
    return jsonError("Directory does not exist.");
  }

  if (!statSync(resolvedDirectory).isDirectory()) {
    return jsonError("Path exists, but it is not a directory.");
  }

  return resolvedDirectory;
}

async function getGitRoot(directory: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--show-toplevel"],
    {
      cwd: directory,
      timeout: TIMEOUT_MS,
      maxBuffer: OUTPUT_LIMIT
    }
  );

  return stdout.trim();
}

export async function POST(request: NextRequest) {
  let body: GitDiffRequest;

  try {
    body = (await request.json()) as GitDiffRequest;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const directory = validateDirectory(body.directory);

  if (directory instanceof NextResponse) {
    return directory;
  }

  let gitRoot: string;

  try {
    gitRoot = await getGitRoot(directory);
  } catch {
    return jsonError("Directory is not inside a git work tree.");
  }

  const command = "git diff --no-color --no-ext-diff";

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["diff", "--no-color", "--no-ext-diff"],
      {
        cwd: directory,
        timeout: TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT
      }
    );

    return NextResponse.json({
      ok: true,
      message: stdout.trim().length
        ? "Diff returned output."
        : "Working tree has no unstaged diff.",
      directory,
      gitRoot,
      command,
      stdout,
      stderr
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    return NextResponse.json(
      {
        ok: false,
        message: failure.killed
          ? "git diff timed out."
          : failure.message || "git diff failed.",
        directory,
        gitRoot,
        command,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? ""
      },
      { status: 500 }
    );
  }
}
