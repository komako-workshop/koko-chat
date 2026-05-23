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
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipVerify = args.has("--skip-verify");
const openclawHome = resolve(
  process.env.OPENCLAW_CONFIG_DIR ?? process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw")
);
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
  }
];
const RELAY_SOURCE = join(REPO_ROOT, "openclaw", "relay");
const AGENT_DEFINITIONS = {
  tavern: {
    instructions: [
      "## KokoChat Tavern Mini-App",
      "",
      "This agent serves the KokoChat Tavern mini-app. Do not run the generic OpenClaw bootstrap/onboarding flow for KokoChat users.",
      "",
      "For concrete roleplay-card recommendation requests, run exactly this local search tool first:",
      "",
      "Do not inspect, show, cat, sed, grep, list, or otherwise read the skill files before searching. The skill text is already injected into your context. The exec approval allowlist only permits the search command below; a combined operation like `show SKILL.md → run search-cards.mjs` will be denied.",
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
      "If the user message matches the shape `请围绕「<topic>」做一份 N 节的深度调研课程`, switch into the procedure defined in the `kokochat-deeply-research` skill. In short: narrate the research process in flowing Chinese, run real web research via the OpenClaw built-in tools, then end with exactly one fenced block tagged `koko.deeply.research.outline` carrying the structured outline + cited real-URL sources.",
      "",
      "The web research tools available to this agent are:",
      "",
      "- `web_search` — run a query via the gateway-configured search provider (currently Brave). Args: `{ \"query\": \"<EN keywords>\", \"count\": <1–10> }`. Call 1–3 times per research turn with different angles.",
      "- `web_fetch` — pull the main content of a specific URL as readable text. Args: `{ \"url\": \"<https://...>\" }`. Use sparingly for high-value pages where the snippet from `web_search` is not enough.",
      "",
      "Every URL in the final `sources` array MUST come from a real `web_search` / `web_fetch` result — do not invent URLs. If a topic has no good hits, narrate that honestly and cite fewer sources rather than fabricating any.",
      "",
      "Narration in this surface is REQUIRED and visible to the user (unlike the tavern skill which forbids visible prose). The user watches this stream during the 1–3 minute research run and needs to feel like you're doing real work. See the skill's `Narration Pattern (Required)` section. Each prose paragraph must end with the sentinel `〔KP〕` — the KokoChat client strips it and renders proper paragraph breaks; without it OpenClaw's wire-layer merge will visually flatten all prose into one block."
    ].join("\n"),
    tools: {
      // minimal + alsoAllow keeps the surface tight: agent only gets the two
      // built-in web tools it actually needs, not the full coding-profile
      // bundle (exec/process/file_write/etc). Course turn that triggers this
      // path is purely network-driven research, no local execution.
      profile: "minimal",
      alsoAllow: ["web_search", "web_fetch"]
    }
  }
};

main();

function main() {
  ensureOpenClawCli();
  ensureSkillSources();

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
  const result = spawnSync(openclawBin, ["--version"], {
    encoding: "utf8",
    env: childEnv()
  });
  if (result.status !== 0) {
    throw new Error(
      [
        "OpenClaw CLI was not found.",
        "Install OpenClaw first, then rerun:",
        "  node scripts/install-openclaw-support.mjs"
      ].join("\n")
    );
  }
  log(result.stdout.trim());
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

function installAgentDefinitions(workspaceByAgent) {
  for (const [agentId, definition] of Object.entries(AGENT_DEFINITIONS)) {
    const workspace = workspaceByAgent.get(agentId) ?? agentFallbackWorkspace(agentId);
    const target = join(workspace, "AGENTS.md");
    log(`agent instructions ${agentId}: ${target}`);
    if (dryRun) continue;
    mkdirSync(workspace, { recursive: true });
    upsertManagedBlock(target, `KOKOCHAT:${agentId}`, renderAgentInstructions(agentId, definition, workspace));
  }
}

function renderAgentInstructions(agentId, definition, workspace) {
  let instructions = definition.instructions;
  if (agentId === "tavern") {
    instructions = instructions.replaceAll(
      "{{TAVERN_SEARCH_BIN}}",
      join(workspace, "skills", "kokochat-tavern-search", "bin", "search-cards.mjs")
    );
  }
  return instructions;
}

function upsertManagedBlock(path, marker, body) {
  const start = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const existing = existsSync(path) ? readFileSync(path, "utf8").trimEnd() : "";
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
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

function runOpenClaw(command, options = {}) {
  return run(openclawBin, command, options);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.capture === true ? "pipe" : "inherit",
    env: childEnv(command)
  });
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
