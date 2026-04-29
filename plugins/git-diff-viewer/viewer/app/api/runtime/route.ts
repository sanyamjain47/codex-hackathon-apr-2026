import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

async function getGitRoot(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: directory,
        timeout: 5_000,
        maxBuffer: 256 * 1024
      }
    );

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cwd = process.cwd();

  return NextResponse.json({
    cwd,
    defaultDirectory: (await getGitRoot(cwd)) ?? cwd
  });
}
