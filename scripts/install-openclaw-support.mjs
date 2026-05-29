#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipVerify = args.has("--skip-verify");
const openclawHome = resolve(
  process.env.OPENCLAW_CONFIG_DIR ?? process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw")
);
const MIN_OPENCLAW_VERSION = "2026.4.15";
const MIN_OPENCLAW_VERSION_PARTS = [2026, 4, 15];
const TARGET_OPENCLAW_VERSION = "2026.5.22";
const DEFAULT_WEB_FETCH_MAX_CHARS = 60_000;
const DEFAULT_WEB_FETCH_MAX_CHARS_CAP = 60_000;
let openclawBin = "openclaw";

const REQUIRED_AGENTS = [
  { id: "koko", workspace: join(openclawHome, "agents", "koko", "workspace") },
  { id: "deeply", workspace: join(openclawHome, "agents", "deeply", "workspace") },
  { id: "tavern", workspace: join(openclawHome, "agents", "tavern", "workspace") },
  {
    id: "tavern-roleplay",
    workspace: join(openclawHome, "agents", "tavern-roleplay", "workspace")
  }
];

const SKILLS = [
  {
    id: "kokochat-pairing",
    source: join(REPO_ROOT, "openclaw", "skills", "kokochat-pairing"),
    workspaceFor: "default",
    verifyAgent: "default"
  },
  {
    id: "kokochat-tavern-search",
    source: join(
      REPO_ROOT,
      "miniapps",
      "tavern",
      "openclaw",
      "skills",
      "kokochat-tavern-search"
    ),
    workspaceFor: "tavern",
    verifyAgent: "tavern"
  },
  {
    id: "kokochat-tavern-roleplay",
    source: join(
      REPO_ROOT,
      "miniapps",
      "tavern",
      "openclaw",
      "skills",
      "kokochat-tavern-roleplay"
    ),
    workspaceFor: "tavern-roleplay",
    verifyAgent: "tavern-roleplay"
  },
  {
    id: "kokochat-deeply-research",
    source: join(
      REPO_ROOT,
      "miniapps",
      "deeply",
      "openclaw",
      "skills",
      "kokochat-deeply-research"
    ),
    workspaceFor: "deeply",
    verifyAgent: "deeply"
  },
  // kokochat-search lives on ClawHub as a standalone skill any OpenClaw user
  // can install for their own agent. KokoChat's own deeply agent does NOT
  // install it locally: deeply just calls `web_fetch` against the hosted
  // `https://deeply.plus/deeply/search` endpoint directly, which avoids the
  // exec-approval / allowlist dance for first-time pairings.
];
const RELAY_SOURCE = join(REPO_ROOT, "openclaw", "relay");
const RELAY_DAEMON_SERVICE = "kokochat-relay-connector.service";
const RELAY_DAEMON_UNIT_TEMPLATE = join(
  REPO_ROOT,
  "openclaw",
  "relay",
  "deploy",
  "kokochat-relay-connector.service"
);
const AGENT_DEFINITIONS = {
  tavern: {
    instructions: [
      "## KokoChat Tavern Mini-App",
      "",
      "This agent serves the KokoChat Tavern mini-app. Do not run the generic OpenClaw bootstrap/onboarding flow for KokoChat users.",
      "",
      "For concrete roleplay-card recommendation requests, run exactly this local search tool first:",
      "",
      "Do not inspect, show, cat, sed, grep, list, or otherwise read the skill files before searching. The skill text is already injected into your context. The exec approval allowlist only permits the search/fetch commands below; a combined operation like `show SKILL.md → run search-cards.mjs` will be denied.",
      "",
      "```bash",
      "{{TAVERN_SEARCH_BIN}} '<json>'",
      "```",
      "",
      "When calling the `exec` tool, the command must be one single command line beginning with `{{TAVERN_SEARCH_BIN}}`. Do not use shell chains, pipes, redirections, or preflight file-reading commands.",
      "Do not send visible prose before this tool call. Internal search notes, query plans, and tool-routing explanations must stay hidden.",
      "",
      "Use an English keyword `query`, `limit: 20`, and `includeNsfw: true` only when the user explicitly asks for adult/NSFW content. If the request is only a greeting or filler, reply briefly in Chinese without a fenced block.",
      "",
      "Internal card detail fetch: if the user message starts with `KokoChat Tavern internal card detail fetch request`, do not search or recommend. Run exactly this local fetch tool with the requested path:",
      "",
      "```bash",
      "{{TAVERN_FETCH_BIN}} '{\"path\":\"author/slug\"}'",
      "```",
      "",
      "Then return exactly one fenced block tagged `koko.tavern.card-detail` with JSON `{ \"version\": 1, \"card\": <the normalized card object from fetch-card> }`, and no prose outside the block.",
      "",
      "Recommendation output must be exactly one fenced block tagged `koko.tavern.recommendations`. The JSON must be v2:",
      "",
      "```json",
      "{",
      "  \"version\": 2,",
      "  \"query\": \"the original user request\",",
      "  \"items\": [",
      "    { \"kind\": \"text\", \"text\": \"短中文介绍\" },",
      "    {",
      "      \"kind\": \"card\",",
      "      \"card\": {",
      "        \"pageUrl\": \"https://character-tavern.com/character/<author>/<slug>\",",
      "        \"imageUrl\": \"https://cards.character-tavern.com/<author>/<slug>.png\",",
      "        \"name\": \"original name\",",
      "        \"nameZh\": \"中文名\",",
      "        \"tagline\": \"original tagline\",",
      "        \"taglineZh\": \"中文一句话\",",
      "        \"tags\": [\"original\", \"tags\"],",
      "        \"matchTags\": [\"最多\", \"四个\", \"中文\", \"标签\"],",
      "        \"safety\": \"sfw\"",
      "      }",
      "    }",
      "  ]",
      "}",
      "```",
      "",
      "Return 3-5 `kind: \"card\"` items. Copy `pageUrl`, `imageUrl`, `name`, `tagline`, and `tags` from the search tool output. Do not invent cards. Every card object must include `safety` with exactly `sfw`, `nsfw`, or `unknown`; never omit it. Do not use top-level `recommendations`, `cards`, `title`, `url`, `reason`, `why`, or `source` as the final schema."
    ].join("\n"),
    tools: {
      profile: "minimal",
      alsoAllow: ["exec", "process"],
      exec: {
        security: "allowlist",
        ask: "off",
        timeoutSec: 120
      }
    },
    execAutoAllowSkills: true,
    execAllowlist: [
      {
        skillId: "kokochat-tavern-search",
        relativePath: join("bin", "search-cards.mjs")
      },
      {
        skillId: "kokochat-tavern-search",
        relativePath: join("bin", "fetch-card.mjs")
      }
    ]
  },
  deeply: {
    instructions: [
      "## KokoChat Deeply Mini-App",
      "",
      "This agent serves the KokoChat Deeply mini-app: an explore (open-ended exploration) surface and a course (按目录推进的深度讲解) surface. KokoChat injects a fully-formed prompt on each user turn — persona, course outline, section-format constraints, recommendation instruction, etc. — so for ordinary turns you should just follow that per-turn prompt verbatim.",
      "",
      "## Deep-research course path",
      "",
      "If the user message matches the shape `请围绕「<topic>」做一份 N 节的深度调研课程`, switch into the procedure defined in the `kokochat-deeply-research` skill. In short: narrate the research process in flowing Chinese, run real web research via KokoChat's hosted search endpoint (called through `web_fetch`), then end with exactly one fenced block tagged `koko.deeply.research.notes` carrying synthesis + cited real-URL sources. KokoChat will run a separate Phase B inference to turn those notes into a course outline.",
      "",
      "The research tool available to this agent is the built-in `web_fetch`. There is no local exec wrapper to install. Call patterns:",
      "",
      "- KokoChat hosted search — `web_fetch({ url: \"https://deeply.plus/deeply/search?q=<urlencoded EN keywords>&count=<1-10>\", maxChars: 60000 })`. The response body is JSON of shape `{ ok: true, provider: \"brave\", query, count, results: [{ title, url, snippet }] }`. Parse `results` and cite the real `url` values. If `ok` is false (e.g. `search_not_configured`, `rate_limited`), narrate that honestly and cite fewer sources rather than fabricating any. Do not pass any other query parameters; the endpoint ignores them.",
      "- Page content — `web_fetch({ url: \"<https://...>\", maxChars: 60000 })`. Use at most twice per preparation turn, only for http(s) URLs returned by a successful KokoChat search; never fetch `file://`, skill files, workspace docs, or invented URLs. If one fetch fails, continue from search snippets instead of retrying lots of other URLs.",
      "",
      "Every URL in the final `sources` array MUST come from a real KokoChat search / `web_fetch` result — do not invent URLs. If a topic has no good hits, narrate that honestly and cite fewer sources rather than fabricating any.",
      "",
      "Before searching, infer a generic research plan from the user's topic itself: key subjects, time/scope, controversy structure, and best evidence types (primary text, interview, transcript, filing, paper, official data, high-quality secondary synthesis, etc.). Do not hard-code domain-specific people, organizations, industries, or examples into the procedure; only follow what the user's topic implies. Queries should first target the exact topic and key subjects, then expand to counterpoints, background, or more authoritative original evidence. Avoid filling sources with broad trend pages when narrower material exists.",
      "",
      "The final `koko.deeply.research.notes` block MUST contain a JSON object only: it starts with `{`, ends with `}`, and uses camelCase fields `version`, `topic`, `synthesis`, `sources`. Never emit YAML or a course outline from Phase A.",
      "",
      "Narration in this surface is REQUIRED and visible to the user (unlike the tavern skill which forbids visible prose). The user watches this stream during the 1–3 minute research run and needs to feel like you're doing real work. See the skill's `Narration Pattern (Required)` section. Each prose paragraph must end with the sentinel `〔KP〕` — the KokoChat client strips it and renders proper paragraph breaks; without it OpenClaw's wire-layer merge will visually flatten all prose into one block."
    ].join("\n"),
    tools: {
      // Deeply search and page fetch both go through the built-in web_fetch
      // tool now — Deeply just web_fetches https://deeply.plus/deeply/search
      // directly and parses the JSON. No exec wrapper, no allowlist, no
      // first-time approval dance.
      profile: "minimal",
      alsoAllow: ["web_fetch"]
    }
  }
};

main();

function main() {
  const openclawState = ensureOpenClawCli();
  ensureSkillSources();

  if (dryRun && openclawState.needsUpgrade) {
    log("");
    log(
      `Dry run stopped before agent/config changes: OpenClaw would be upgraded to ${TARGET_OPENCLAW_VERSION} first.`
    );
    return;
  }

  const agentsBefore = listAgents();
  const agents = new Map(agentsBefore.map((agent) => [agent.id, agent]));
  const defaultAgent = agentsBefore.find((agent) => agent.isDefault === true);
  const defaultWorkspace = defaultAgent?.workspace ?? join(openclawHome, "workspace");
  const defaultVerifyAgent = defaultAgent?.id ?? "main";
  installRelayConnector(defaultWorkspace);

  for (const desired of REQUIRED_AGENTS) {
    const current = agents.get(desired.id);
    if (current !== undefined) {
      log(`agent ${desired.id}: exists (${current.workspace})`);
      continue;
    }
    createAgent(desired);
  }

  const agentsAfter = listAgents();
  const workspaceByAgent = new Map(agentsAfter.map((agent) => [agent.id, agent.workspace]));
  const installed = [];

  for (const skill of SKILLS) {
    const workspace =
      skill.workspaceFor === "default"
        ? defaultWorkspace
        : workspaceByAgent.get(skill.workspaceFor) ?? agentFallbackWorkspace(skill.workspaceFor);
    installSkill(skill, workspace);
    installed.push({
      id: skill.id,
      agent:
        skill.verifyAgent === "default"
          ? defaultVerifyAgent
          : skill.verifyAgent,
      workspace
    });
  }

  installAgentDefinitions(workspaceByAgent);
  configureAgentOpenClawConfig(installed);
  configureExecApprovals(workspaceByAgent);

  if (!skipVerify) {
    for (const entry of installed) {
      verifySkill(entry.id, entry.agent);
    }
  }

  restartGatewayAfterUpgrade(openclawState);
  installRelayConnectorDaemon(defaultWorkspace);

  if (dryRun) {
    log("");
    log("Dry run completed: no files or agents were changed.");
  } else {
    log("");
    log("KokoChat OpenClaw support is installed.");
    log("Next: open KokoChat, copy the pairing request, and paste it into OpenClaw.");
  }
}

function ensureOpenClawCli() {
  const found = findOpenClawBin();
  if (found === null) {
    throw new Error(
      [
        "OpenClaw CLI was not found.",
        "Install OpenClaw first, then rerun:",
        "  node scripts/install-openclaw-support.mjs"
      ].join("\n")
    );
  }
  openclawBin = found;
  const before = readOpenClawVersion();
  log(before.output);

  if (compareOpenClawVersions(before.version.parts, MIN_OPENCLAW_VERSION_PARTS) >= 0) {
    return { needsUpgrade: false, upgraded: false, before, after: before };
  }

  log(
    `OpenClaw ${before.version.raw} is older than ${MIN_OPENCLAW_VERSION}; upgrading to ${TARGET_OPENCLAW_VERSION} before installing KokoChat support.`
  );
  if (dryRun) {
    log(
      `[dry-run] would run: ${openclawBin} update --yes --tag ${TARGET_OPENCLAW_VERSION} --no-restart --json`
    );
    return { needsUpgrade: true, upgraded: false, before, after: before };
  }

  updateOpenClawToTarget();
  refreshOpenClawBin();

  const afterUpdate = tryReadOpenClawVersion("checking OpenClaw after update");
  if (
    afterUpdate !== null &&
    compareOpenClawVersions(afterUpdate.version.parts, MIN_OPENCLAW_VERSION_PARTS) >= 0
  ) {
    log(`OpenClaw after update: ${afterUpdate.output}`);
    return { needsUpgrade: true, upgraded: true, before, after: afterUpdate };
  }

  log(
    `OpenClaw update did not reach ${MIN_OPENCLAW_VERSION}; falling back to npm install -g openclaw@${TARGET_OPENCLAW_VERSION}.`
  );
  installTargetOpenClawWithNpm();
  refreshOpenClawBin();
  const afterFallback = readOpenClawVersion();
  if (compareOpenClawVersions(afterFallback.version.parts, MIN_OPENCLAW_VERSION_PARTS) < 0) {
    throw new Error(
      `OpenClaw is still ${afterFallback.version.raw}; KokoChat requires ${MIN_OPENCLAW_VERSION} or newer.`
    );
  }
  log(`OpenClaw after npm fallback: ${afterFallback.output}`);
  return { needsUpgrade: true, upgraded: true, before, after: afterFallback };
}

function findOpenClawBin() {
  const candidates = [
    "openclaw",
    join(homedir(), ".local", "bin", "openclaw"),
    "/usr/local/bin/openclaw",
    "/opt/homebrew/bin/openclaw"
  ];
  for (const candidate of candidates) {
    if (candidate !== "openclaw" && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      env: childEnv(candidate)
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

function refreshOpenClawBin() {
  const found = findOpenClawBin();
  if (found !== null) {
    openclawBin = found;
  }
}

function readOpenClawVersion() {
  const result = spawnSync(openclawBin, ["--version"], {
    encoding: "utf8",
    env: childEnv(openclawBin)
  });
  if (result.error !== undefined || result.status !== 0) {
    const reason =
      result.error instanceof Error
        ? result.error.message
        : `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(
      [
        "OpenClaw CLI was not found.",
        reason.length > 0 ? `Reason: ${reason}` : null,
        "Install OpenClaw first, then rerun:",
        "  node scripts/install-openclaw-support.mjs"
      ].filter(Boolean).join("\n")
    );
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const version = parseOpenClawVersion(output);
  if (version === null) {
    throw new Error(
      `Could not parse OpenClaw version from: ${output}\nKokoChat requires OpenClaw ${MIN_OPENCLAW_VERSION} or newer.`
    );
  }
  return { output, version };
}

function tryReadOpenClawVersion(context) {
  try {
    return readOpenClawVersion();
  } catch (error) {
    log(`${context} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseOpenClawVersion(output) {
  const match = output.match(/\b(\d{4})\.(\d{1,2})\.(\d{1,2})(?:[-+][0-9A-Za-z.-]+)?\b/);
  if (match === null) return null;
  return {
    raw: match[0],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])]
  };
}

function compareOpenClawVersions(left, right) {
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i] - right[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

function updateOpenClawToTarget() {
  const command = ["update", "--yes", "--tag", TARGET_OPENCLAW_VERSION, "--no-restart", "--json"];
  log(`upgrade: ${openclawBin} ${command.join(" ")}`);
  const result = runOpenClaw(command, { capture: true, allowFailure: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const payload = parseFirstJsonObjectOrNull(output);
  if (payload !== null) {
    const status = typeof payload.status === "string" ? payload.status : "unknown";
    const reason = typeof payload.reason === "string" ? ` (${payload.reason})` : "";
    log(`upgrade status: ${status}${reason}`);
  } else if (output.length > 0) {
    log(`upgrade output: ${lastLines(output, 8)}`);
  }
  if (result.status !== 0) {
    log(
      `upgrade exited with ${result.status ?? "unknown"}; checking the installed OpenClaw version anyway.`
    );
  }
}

function installTargetOpenClawWithNpm() {
  const packageName = `openclaw@${TARGET_OPENCLAW_VERSION}`;
  log(`fallback: npm install -g ${packageName}`);
  const result = run(
    "npm",
    ["install", "-g", packageName, "--no-fund", "--no-audit", "--loglevel=error"],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(
      [
        `npm install -g ${packageName} failed with exit ${result.status ?? "unknown"}.`,
        `Please install OpenClaw ${TARGET_OPENCLAW_VERSION} manually, then rerun this script.`
      ].join("\n")
    );
  }
}

function ensureSkillSources() {
  for (const skill of SKILLS) {
    if (!existsSync(skill.source) || !statSync(skill.source).isDirectory()) {
      throw new Error(`missing skill source: ${skill.source}`);
    }
  }
  if (!existsSync(RELAY_SOURCE) || !statSync(RELAY_SOURCE).isDirectory()) {
    throw new Error(`missing relay connector source: ${RELAY_SOURCE}`);
  }
}

function listAgents() {
  const result = runOpenClaw(["agents", "list", "--json"], { capture: true });
  const stdout = result.stdout.trim();
  const parsed = parseFirstJsonArray(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("openclaw agents list --json returned a non-array payload");
  }
  return parsed.flatMap((agent) => {
    if (!isRecord(agent) || typeof agent.id !== "string" || typeof agent.workspace !== "string") {
      return [];
    }
    return [
      {
        id: agent.id,
        workspace: agent.workspace,
        isDefault: agent.isDefault === true
      }
    ];
  });
}

function parseFirstJsonArray(value) {
  let offset = 0;
  let lastError = null;
  while (offset < value.length) {
    const start = value.indexOf("[", offset);
    if (start < 0) break;
    try {
      const parsed = JSON.parse(extractJsonArrayAt(value, start));
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      lastError = error;
    }
    offset = start + 1;
  }
  const suffix = lastError instanceof Error ? `\nlast parse error: ${lastError.message}` : "";
  throw new Error(`openclaw agents list --json did not return a JSON array:\n${value}${suffix}`);
}

function parseFirstJsonObjectOrNull(value) {
  let offset = 0;
  while (offset < value.length) {
    const start = value.indexOf("{", offset);
    if (start < 0) break;
    try {
      const parsed = JSON.parse(extractJsonObjectAt(value, start));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Keep scanning: OpenClaw can print prose before the JSON payload.
    }
    offset = start + 1;
  }
  return null;
}

function extractJsonArrayAt(value, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }
  throw new Error(`openclaw agents list --json returned incomplete JSON:\n${value}`);
}

function extractJsonObjectAt(value, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }
  throw new Error(`OpenClaw returned incomplete JSON object:\n${value}`);
}

function createAgent(agent) {
  log(`agent ${agent.id}: creating (${agent.workspace})`);
  if (dryRun) return;
  mkdirSync(dirname(agent.workspace), { recursive: true });
  runOpenClaw([
    "agents",
    "add",
    agent.id,
    "--workspace",
    agent.workspace,
    "--non-interactive",
    "--json"
  ]);
}

function installSkill(skill, workspace) {
  const target = join(workspace, "skills", skill.id);
  log(`skill ${skill.id}: ${target}`);
  if (dryRun) return;
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(skill.source, target, { recursive: true });
}

function installRelayConnector(defaultWorkspace) {
  const target = join(defaultWorkspace, "relay");
  log(`relay connector: ${target}`);
  if (dryRun) return;
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(RELAY_SOURCE, target, { recursive: true });
}

/**
 * Install the relay connector as a self-healing systemd service so it
 * survives crashes / reboots and reconnects automatically — instead of
 * relying on the detached process the pairing skill spawns once.
 *
 * Only runs on Linux with a system systemd we can write to (root). On macOS
 * / non-root / non-systemd hosts we silently skip; the pairing-time spawn
 * remains the fallback. The connector self-bootstraps from
 * `${OPENCLAW_HOME}/kokochat-relay/relay.json`, so the unit needs no
 * per-relay config path.
 */
function installRelayConnectorDaemon(defaultWorkspace) {
  if (dryRun) return;
  if (process.platform !== "linux") {
    log("relay daemon: skipped (not Linux; pairing-time spawn remains the fallback)");
    return;
  }
  if (!commandExists("systemctl")) {
    log("relay daemon: skipped (systemctl not found)");
    return;
  }
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRoot) {
    log("relay daemon: skipped (needs root to install a system service; run installer with sudo to enable self-healing relay)");
    return;
  }
  if (!existsSync(RELAY_DAEMON_UNIT_TEMPLATE)) {
    log(`relay daemon: skipped (unit template missing at ${RELAY_DAEMON_UNIT_TEMPLATE})`);
    return;
  }

  const connector = join(defaultWorkspace, "relay", "kokochat-relay-connector.mjs");
  const nodeBin = process.execPath;
  const envFile = join(openclawHome, "openclaw.env");
  const unit = readFileSync(RELAY_DAEMON_UNIT_TEMPLATE, "utf8")
    .replaceAll("{{USER}}", userInfo().username)
    .replaceAll("{{NODE_BIN}}", nodeBin)
    .replaceAll("{{CONNECTOR}}", connector)
    .replaceAll("{{OPENCLAW_HOME}}", openclawHome)
    .replaceAll("{{ENV_FILE}}", envFile);

  const unitPath = join("/etc/systemd/system", RELAY_DAEMON_SERVICE);
  try {
    writeFileSync(unitPath, unit);
  } catch (error) {
    log(`relay daemon: could not write ${unitPath} (${error?.message ?? error}); skipped`);
    return;
  }
  log(`relay daemon: wrote ${unitPath}`);

  const reload = run("systemctl", ["daemon-reload"], { capture: true, allowFailure: true });
  if (reload.status !== 0) {
    log("relay daemon: systemctl daemon-reload failed; skipped enable");
    return;
  }
  const enable = run("systemctl", ["enable", "--now", RELAY_DAEMON_SERVICE], {
    capture: true,
    allowFailure: true
  });
  if (enable.status === 0) {
    log(`relay daemon: enabled + started ${RELAY_DAEMON_SERVICE} (self-healing)`);
  } else {
    const output = `${enable.stdout ?? ""}\n${enable.stderr ?? ""}`.trim();
    log(
      `relay daemon: enable --now returned ${enable.status ?? "unknown"}. ${output.length > 0 ? lastLines(output, 4) : ""}`
    );
  }
}

function commandExists(command) {
  const probe = run(process.platform === "win32" ? "where" : "which", [command], {
    capture: true,
    allowFailure: true
  });
  return probe.status === 0;
}

function installAgentDefinitions(workspaceByAgent) {
  for (const [agentId, definition] of Object.entries(AGENT_DEFINITIONS)) {
    const workspace = workspaceByAgent.get(agentId) ?? agentFallbackWorkspace(agentId);
    const target = join(workspace, "AGENTS.md");
    log(`agent instructions ${agentId}: ${target}`);
    if (dryRun) continue;
    mkdirSync(workspace, { recursive: true });
    upsertManagedBlock(
      target,
      `KOKOCHAT:${agentId}`,
      renderAgentInstructions(agentId, definition, workspace),
      { position: "top" }
    );
    installKokoChatIdentityFiles(agentId, workspace);
    removeDefaultOpenClawBootstrap(agentId, workspace);
  }
}

function renderAgentInstructions(agentId, definition, workspace) {
  let instructions = definition.instructions;
  if (agentId === "tavern") {
    instructions = instructions.replaceAll(
      "{{TAVERN_SEARCH_BIN}}",
      join(workspace, "skills", "kokochat-tavern-search", "bin", "search-cards.mjs")
    );
    instructions = instructions.replaceAll(
      "{{TAVERN_FETCH_BIN}}",
      join(workspace, "skills", "kokochat-tavern-search", "bin", "fetch-card.mjs")
    );
  }
  return [
    "## KokoChat Runtime Contract",
    "",
    "This workspace is already initialized for KokoChat mini-app use.",
    "Do not run the generic OpenClaw first-run / BOOTSTRAP.md identity onboarding flow in KokoChat sessions.",
    "Do not ask KokoChat users to name you or define your identity; follow the per-turn KokoChat prompt and the mini-app contract below.",
    "",
    instructions
  ].join("\n");
}

function installKokoChatIdentityFiles(agentId, workspace) {
  upsertManagedBlock(
    join(workspace, "IDENTITY.md"),
    `KOKOCHAT:${agentId}:IDENTITY`,
    renderKokoChatIdentity(agentId),
    { position: "top" }
  );
  upsertManagedBlock(
    join(workspace, "USER.md"),
    `KOKOCHAT:${agentId}:USER`,
    renderKokoChatUserContext(),
    { position: "top" }
  );
}

function renderKokoChatIdentity(agentId) {
  return [
    "## KokoChat Managed Identity",
    "",
    `- Name: KokoChat ${agentId} agent`,
    "- Role: task-specific runtime agent for the KokoChat app",
    "- Startup state: already initialized; never ask the app user to configure identity",
    "- Interaction rule: follow KokoChat's injected per-turn prompt"
  ].join("\n");
}

function renderKokoChatUserContext() {
  return [
    "## KokoChat Managed User Context",
    "",
    "- The human is the current KokoChat app user.",
    "- Treat each app turn as task context supplied by KokoChat.",
    "- Do not ask the user to initialize this OpenClaw workspace."
  ].join("\n");
}

function removeDefaultOpenClawBootstrap(agentId, workspace) {
  const target = join(workspace, "BOOTSTRAP.md");
  if (!existsSync(target)) return;
  const body = readFileSync(target, "utf8");
  if (!isDefaultOpenClawBootstrap(body)) {
    log(`bootstrap ${agentId}: kept custom BOOTSTRAP.md`);
    return;
  }
  rmSync(target, { force: true });
  log(`bootstrap ${agentId}: removed default OpenClaw first-run BOOTSTRAP.md`);
}

function isDefaultOpenClawBootstrap(body) {
  return (
    body.includes("# BOOTSTRAP.md - Hello, World") &&
    body.includes("Who am I? Who are you?")
  );
}

function upsertManagedBlock(path, marker, body, options = {}) {
  const start = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const existing = existsSync(path) ? readFileSync(path, "utf8").trimEnd() : "";
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : options.position === "top"
      ? `${block}${existing.length > 0 ? `\n\n${existing}` : ""}`
    : `${existing}${existing.length > 0 ? "\n\n" : ""}${block}`;
  writeFileSync(path, `${next}\n`);
}

function configureAgentOpenClawConfig(installed) {
  const configPath = join(openclawHome, "openclaw.json");
  const skillsByAgent = new Map();
  for (const entry of installed) {
    const current = skillsByAgent.get(entry.agent) ?? [];
    current.push(entry.id);
    skillsByAgent.set(entry.agent, current);
  }

  log(`skill allowlists: ${configPath}`);
  for (const [agentId, skillIds] of skillsByAgent) {
    log(`allowlist ${agentId}: ${skillIds.join(", ")}`);
  }
  if (dryRun) return;

  const config = readJsonObject(configPath);
  ensureGatewayConfig(config);
  ensureDefaultWebToolConfig(config);

  const agents = isRecord(config.agents) ? config.agents : {};
  config.agents = agents;
  const list = Array.isArray(agents.list) ? agents.list : [];
  agents.list = list;

  for (const [agentId, skillIds] of skillsByAgent) {
    const entry = ensureAgentConfigEntry(list, agentId);
    entry.skills = mergeStringArray(entry.skills, skillIds);
  }
  for (const [agentId, definition] of Object.entries(AGENT_DEFINITIONS)) {
    const entry = ensureAgentConfigEntry(list, agentId);
    entry.tools = mergeToolConfig(entry.tools, definition.tools);
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function configureExecApprovals(workspaceByAgent) {
  const approvalsPath = join(openclawHome, "exec-approvals.json");
  const entriesByAgent = new Map();
  for (const [agentId, definition] of Object.entries(AGENT_DEFINITIONS)) {
    if (!Array.isArray(definition.execAllowlist)) continue;
    const workspace = workspaceByAgent.get(agentId) ?? agentFallbackWorkspace(agentId);
    for (const item of definition.execAllowlist) {
      const pattern = join(workspace, "skills", item.skillId, item.relativePath);
      const current = entriesByAgent.get(agentId) ?? [];
      current.push({ pattern });
      for (const nodePattern of nodeExecutablePatterns()) {
        current.push({
          pattern: nodePattern,
          argPattern: buildScriptArgPattern(pattern)
        });
      }
      entriesByAgent.set(agentId, current);
    }
  }
  if (entriesByAgent.size === 0) return;

  log(`exec approvals: ${approvalsPath}`);
  for (const [agentId, entries] of entriesByAgent) {
    log(
      `exec allowlist ${agentId}: ${entries
        .map((entry) => entry.argPattern ? `${entry.pattern} ${entry.argPattern}` : entry.pattern)
        .join(", ")}`
    );
  }
  if (dryRun) return;

  const approvals = existsSync(approvalsPath)
    ? readJsonObject(approvalsPath)
    : { version: 1, defaults: {}, agents: {} };
  approvals.version = 1;
  if (!isRecord(approvals.defaults)) approvals.defaults = {};
  const agents = isRecord(approvals.agents) ? approvals.agents : {};
  approvals.agents = agents;

  for (const [agentId, entries] of entriesByAgent) {
    const agent = isRecord(agents[agentId]) ? agents[agentId] : {};
    agents[agentId] = agent;
    agent.security = "allowlist";
    agent.ask = "off";
    agent.askFallback = "allowlist";
    if (AGENT_DEFINITIONS[agentId]?.execAutoAllowSkills === true) {
      agent.autoAllowSkills = true;
    }
    agent.allowlist = mergeExecAllowlist(agent.allowlist, entries);
  }

  writeFileSync(approvalsPath, `${JSON.stringify(approvals, null, 2)}\n`);
  pushExecApprovalsToGateway(approvalsPath);
}

function pushExecApprovalsToGateway(approvalsPath) {
  // `openclaw.json` (agents / tools) is auto hot-reloaded by the gateway, but
  // `exec-approvals.json` is not. Push it explicitly so the running gateway
  // accepts newly allowlisted exec entries (e.g. tavern card search) without a
  // manual restart — otherwise the first agent call still hits
  // "exec denied: allowlist miss" and prompts the user for approval.
  //
  // `openclaw approvals set --gateway` connects as a regular client; if it
  // hits a brand-new gateway it can stall on a scope-upgrade approval
  // prompt. To bypass that we pass the local gateway URL + the gateway
  // token straight from `openclaw.env`, which gives us admin scope.
  const args = ["approvals", "set", "--gateway", "--file", approvalsPath, "--json"];
  const localUrl = resolveLocalGatewayUrlForInstaller();
  if (localUrl !== null) args.push("--url", localUrl);
  const token = resolveLocalGatewayTokenForInstaller();
  if (token !== null) args.push("--token", token);
  const result = runOpenClaw(args, { capture: true, allowFailure: true });
  if (result.status === 0) {
    log("approvals set --gateway: ok");
    return;
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  log(
    [
      `approvals set --gateway did not complete automatically (exit ${result.status ?? "unknown"}).`,
      output.length > 0 ? lastLines(output, 6) : null,
      "If the first agent call hits `exec denied: allowlist miss`, restart the gateway and retry."
    ].filter(Boolean).join(" ")
  );
}

function resolveLocalGatewayUrlForInstaller() {
  const configPath = join(openclawHome, "openclaw.json");
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const port = Number(config?.gateway?.port);
    if (Number.isFinite(port) && port > 0) return `ws://127.0.0.1:${port}`;
  } catch {
    // fall through
  }
  return "ws://127.0.0.1:18789";
}

function resolveLocalGatewayTokenForInstaller() {
  if (typeof process.env.OPENCLAW_GATEWAY_TOKEN === "string" && process.env.OPENCLAW_GATEWAY_TOKEN.length > 0) {
    return process.env.OPENCLAW_GATEWAY_TOKEN;
  }
  const envPath = join(openclawHome, "openclaw.env");
  if (!existsSync(envPath)) return null;
  try {
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (match && match[1] === "OPENCLAW_GATEWAY_TOKEN") {
        const value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          return value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function readJsonObject(path) {
  const text = existsSync(path) ? readFileSync(path, "utf8").trim() : "{}";
  if (text.length === 0) return {};
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

function ensureDefaultWebToolConfig(config) {
  const tools = isRecord(config.tools) ? config.tools : {};
  config.tools = tools;
  const web = isRecord(tools.web) ? tools.web : {};
  tools.web = web;
  const fetch = isRecord(web.fetch) ? web.fetch : {};
  web.fetch = fetch;

  const search = isRecord(web.search) ? web.search : null;
  const provider = typeof search?.provider === "string" ? search.provider.trim() : "";
  if (provider === "duckduckgo") {
    delete search.provider;
    log("web_search provider: removed legacy KokoChat duckduckgo default");
  } else if (provider.length > 0) {
    log(`web_search provider: keep existing ${provider}`);
  }
  if (search !== null && Object.keys(search).length === 0) {
    delete web.search;
    log("web_search config: removed empty legacy search block");
  }

  ensureMinimumNumberConfig(fetch, "maxChars", DEFAULT_WEB_FETCH_MAX_CHARS, "web_fetch maxChars");
  ensureMinimumNumberConfig(
    fetch,
    "maxCharsCap",
    DEFAULT_WEB_FETCH_MAX_CHARS_CAP,
    "web_fetch maxCharsCap"
  );
}

function ensureGatewayConfig(config) {
  const gateway = isRecord(config.gateway) ? config.gateway : {};
  config.gateway = gateway;
  const mode = typeof gateway.mode === "string" ? gateway.mode.trim() : "";
  if (mode.length === 0) {
    gateway.mode = "local";
    log("gateway mode: default local");
  } else {
    log(`gateway mode: keep existing ${mode}`);
  }
}

function ensureMinimumNumberConfig(target, key, minimum, label) {
  const current = typeof target[key] === "number" && Number.isFinite(target[key])
    ? Math.floor(target[key])
    : null;
  if (current !== null && current >= minimum) {
    log(`${label}: keep existing ${current}`);
    return;
  }
  target[key] = minimum;
  if (current === null) {
    log(`${label}: default ${minimum}`);
  } else {
    log(`${label}: raise ${current} -> ${minimum}`);
  }
}

function ensureAgentConfigEntry(list, agentId) {
  for (const value of list) {
    if (isRecord(value) && value.id === agentId) return value;
  }
  const entry = { id: agentId };
  list.push(entry);
  return entry;
}

function mergeStringArray(current, additions) {
  const merged = [];
  if (Array.isArray(current)) {
    for (const value of current) {
      if (typeof value === "string" && !merged.includes(value)) {
        merged.push(value);
      }
    }
  }
  for (const value of additions) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }
  return merged;
}

function mergeToolConfig(current, required) {
  const merged = isRecord(current) ? { ...current } : {};
  if (typeof required.profile === "string") {
    merged.profile = shouldKeepCurrentProfile(merged.profile, required.profile)
      ? merged.profile
      : required.profile;
  }
  if (Array.isArray(required.alsoAllow)) {
    merged.alsoAllow = mergeStringArray(merged.alsoAllow, required.alsoAllow);
  }
  if (isRecord(required.exec)) {
    merged.exec = {
      ...(isRecord(merged.exec) ? merged.exec : {}),
      ...required.exec
    };
  }
  return merged;
}

function mergeExecAllowlist(current, entries) {
  const merged = Array.isArray(current)
    ? current.filter((value) => isRecord(value) && typeof value.pattern === "string")
    : [];
  const seen = new Set(
    merged.map((value) => execAllowlistKey(value.pattern, value.argPattern))
  );
  for (const entry of entries) {
    const pattern = entry.pattern;
    const argPattern = typeof entry.argPattern === "string" ? entry.argPattern : undefined;
    const key = execAllowlistKey(pattern, argPattern);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: stableId(`kokochat:${key}`),
      pattern,
      ...(argPattern === undefined ? {} : { argPattern })
    });
  }
  return merged;
}

function buildScriptArgPattern(scriptPath) {
  const variants = [scriptPath];
  const home = homedir();
  if (scriptPath.startsWith(`${home}/`)) {
    variants.push(`~${scriptPath.slice(home.length)}`);
  }
  const alternatives = variants.map(escapeRegExp).join("|");
  return `(?:^|\\s)(?:${alternatives})(?:\\s|$)`;
}

function nodeExecutablePatterns() {
  const candidates = ["node", process.execPath];
  const discovered = spawnSync("sh", ["-lc", "command -v node"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (discovered.status === 0) {
    candidates.push(discovered.stdout.trim());
  }
  return [...new Set(candidates.filter((value) => typeof value === "string" && value.length > 0))];
}

function execAllowlistKey(pattern, argPattern) {
  return `${pattern}\0${typeof argPattern === "string" ? argPattern : ""}`;
}

function stableId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `kokochat-${hex}`;
}

function shouldKeepCurrentProfile(current, required) {
  const rank = { minimal: 0, messaging: 1, coding: 2, full: 3 };
  return typeof current === "string" && rank[current] >= rank[required];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifySkill(skillId, agentId) {
  log(`verify ${skillId} on agent ${agentId}`);
  if (dryRun) return;
  const result = runOpenClaw(["skills", "info", skillId, "--agent", agentId], {
    capture: true,
    allowFailure: true
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    if (/Excluded by agent allowlist|Visible to model:\s*no/i.test(output)) {
      throw new Error(
        `openclaw skills info ${skillId} --agent ${agentId} reports the skill is not visible\n${output}`
      );
    }
    return;
  }
  if (/unknown option ['"]?--agent/i.test(output)) {
    log(`verify skipped: this OpenClaw CLI does not support skills --agent yet`);
    return;
  }
  throw new Error(
    `openclaw skills info ${skillId} --agent ${agentId} failed with exit ${result.status}\n${output}`
  );
}

function agentFallbackWorkspace(agentId) {
  return join(openclawHome, "agents", agentId, "workspace");
}

function restartGatewayAfterUpgrade(openclawState) {
  if (dryRun || openclawState.upgraded !== true) return;
  // Only restart on real OpenClaw version upgrade. Skill / agent / approvals
  // config is hot-reloaded by the running gateway, so plain install or
  // refresh runs don't need a restart and shouldn't disrupt active sessions.
  log("OpenClaw was upgraded; restarting Gateway so the running service uses the new version.");
  const result = runOpenClaw(["gateway", "restart"], {
    capture: true,
    allowFailure: true
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0) {
    log("gateway restart: ok");
    return;
  }
  log(
    [
      `gateway restart did not complete automatically (exit ${result.status ?? "unknown"}).`,
      output.length > 0 ? lastLines(output, 8) : null,
      "If the phone cannot reconnect, run `openclaw gateway restart` once and retry pairing."
    ].filter(Boolean).join(" ")
  );
}

function runOpenClaw(command, options = {}) {
  return run(openclawBin, command, options);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.capture === true ? "pipe" : "inherit",
    env: childEnv(command)
  });
  if (result.error !== undefined) {
    if (options.allowFailure === true) {
      return result;
    }
    throw new Error(
      `${command} ${commandArgs.join(" ")} failed: ${result.error.message}`
    );
  }
  if (options.allowFailure === true) {
    return result;
  }
  if (result.status !== 0) {
    const suffix =
      options.capture === true
        ? `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${result.status}${suffix}`);
  }
  return result;
}

function lastLines(value, count) {
  return value.split(/\r?\n/).slice(-count).join("\n");
}

function childEnv(command = openclawBin) {
  if (command === "openclaw") return process.env;
  return {
    ...process.env,
    PATH: `${dirname(command)}${delimiter}${process.env.PATH ?? ""}`
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function log(message) {
  console.log(`[kokochat-install] ${message}`);
}
