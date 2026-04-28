import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Stable OpenClaw session key used by the main agent. */
export const MAIN_OPENCLAW_SESSION_KEY = "agent:main:main";

/** Main OpenClaw agent session metadata returned by `openclaw sessions --json --agent main`. */
export interface MainSessionInfo {
  /** Stable Gateway session key, normally `agent:main:main`. */
  sessionKey: string;
  /** Concrete OpenClaw session id. */
  sessionId: string;
  /** Optional model label reported by OpenClaw. */
  model?: string;
}

/** Options for resolving the main OpenClaw session. */
export interface ReadMainSessionOptions {
  /** OpenClaw CLI binary path. Defaults to `openclaw`. */
  openclawBinary?: string;
  /** Maximum time to wait for the sessions command. Defaults to 10 seconds. */
  timeoutMs?: number;
}

type SessionEntry = {
  key?: unknown;
  sessionId?: unknown;
  model?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStdout(stdout: string | Buffer): string {
  return typeof stdout === "string" ? stdout : stdout.toString("utf8");
}

function isExecTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    isRecord(error) &&
    error.killed === true &&
    typeof error.signal === "string"
  );
}

function parseSessions(stdout: string): SessionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("openclaw sessions returned invalid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) {
    throw new Error("openclaw sessions JSON missing sessions array");
  }
  return parsed.sessions.filter(isRecord);
}

/** Calls `openclaw sessions --json --agent main` and returns the `agent:main:main` session. */
export async function readMainSession(options: ReadMainSessionOptions = {}): Promise<MainSessionInfo> {
  const openclawBinary = options.openclawBinary ?? "openclaw";
  const timeoutMs = options.timeoutMs ?? 10_000;

  let stdout: string;
  try {
    const result = await execFileAsync(
      openclawBinary,
      ["sessions", "--json", "--agent", "main"],
      { timeout: timeoutMs, encoding: "utf8" }
    );
    stdout = normalizeStdout(result.stdout);
  } catch (error) {
    if (isExecTimeout(error)) {
      throw new Error(`openclaw sessions timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  const sessions = parseSessions(stdout);
  const main = sessions.find((session) => session.key === MAIN_OPENCLAW_SESSION_KEY);
  if (main === undefined || typeof main.sessionId !== "string") {
    throw new Error("no agent:main:main session found; run `openclaw` at least once first");
  }

  const result: MainSessionInfo = {
    sessionKey: MAIN_OPENCLAW_SESSION_KEY,
    sessionId: main.sessionId
  };
  if (typeof main.model === "string") {
    result.model = main.model;
  }
  return result;
}
