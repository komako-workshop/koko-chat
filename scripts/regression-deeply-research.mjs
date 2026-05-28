#!/usr/bin/env node
/**
 * Run one Deeply "深度调研课程" kickoff against the cloud OpenClaw and dump
 * the full transcript so we can verify prompt changes from this repo
 * actually take effect on the deeply agent.
 *
 * Two-phase pipeline v2 (matches what the KokoChat client runs):
 *
 *   Phase A — plan agent turn:
 *     KokoChat wraps the user's "请围绕「...」做一份深度调研课程" into a
 *     long gatewayText (see persona.ts → buildResearchKickoffPrompt). The
 *     agent does light exploratory search to calibrate, then emits one
 *     `koko.deeply.research.plan` fenced block (courseTitle + introduction
 *     + sections[title + searchHint]). No per-section sources yet.
 *
 *   Phase B — per-section search inferOnce on the same agent:
 *     KokoChat takes Phase A's plan, builds a new prompt
 *     (persona.ts → buildResearchOutlineFromPlanPrompt), and chat.send's
 *     it with a fresh oneshot session key. The agent searches once per
 *     section using each `searchHint` and emits one
 *     `koko.deeply.research.outline` fenced block (per-section sources).
 *
 *   We replicate both phases here so regression runs match production
 *   exactly. Inline-copied prompts below MUST be kept in sync with
 *   persona.ts.
 *
 *   On test:
 *     - Phase A raw.txt should carry a `koko.deeply.research.plan` block
 *       whose section titles reflect a teaching structure for the topic.
 *     - Phase B raw.txt should parse into a research outline whose
 *       per-section sources URLs are real (spot-check with curl/HEAD).
 *
 * Usage:
 *   node scripts/regression-deeply-research.mjs --topic "一二级投资人现在怎么看AI"
 *   # optional flags
 *   node scripts/regression-deeply-research.mjs --topic "..." --sections 8
 *   node scripts/regression-deeply-research.mjs --topic "..." --host 47.237.5.255
 *
 * Output goes under ./artifacts/deeply-research-test-<timestamp>.{
 *   phase-a.prompt.txt, phase-a.events.json, phase-a.raw.txt, phase-a.plan.json,
 *   phase-b.prompt.txt, phase-b.events.json, phase-b.raw.txt, phase-b.outline.md
 * } so multiple runs can be diffed.
 *
 * Sync notes:
 *   - `buildResearchKickoffPromptInline` + `buildResearchOutlineFromPlanPromptInline`
 *     below mirror persona.ts. When persona.ts is edited, copy the new
 *     template bodies here too.
 */

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { WebSocket } from "../packages/koko-openclaw-client/node_modules/ws/wrapper.mjs";
import {
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  buildConnectParams,
  deriveDeviceIdentity,
  generateDeviceSeed
} from "../packages/koko-openclaw-client/dist/protocol.js";

const DEFAULT_OPENCLAW_HOST = "47.237.5.255";
const DEFAULT_PASSWORD_FILE = "/Users/lijianren/openclaw-aliyun-kokochat/ecs-login-password.txt";
const DEFAULT_KNOWN_HOSTS = "/Users/lijianren/.ssh/known_hosts_openclaw_kokochat";
const DEFAULT_REMOTE_PAIRING_SCRIPT =
  "/root/.kokochat/koko-chat/openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs";
const DEFAULT_RELAY_HEALTH_URL = "http://47.84.141.40:8787/healthz";

const args = parseArgs(process.argv.slice(2));
const topic = args.topic ?? "一二级投资人现在怎么看AI";
const sections = args.sections !== undefined ? Number(args.sections) : 0;
const host = args.host ?? DEFAULT_OPENCLAW_HOST;
const passwordFile = args.passwordFile ?? DEFAULT_PASSWORD_FILE;
const knownHosts = args.knownHosts ?? DEFAULT_KNOWN_HOSTS;
const remotePairingScript = args.remotePairingScript ?? DEFAULT_REMOTE_PAIRING_SCRIPT;
const relayHealthUrl = args.relayHealthUrl ?? DEFAULT_RELAY_HEALTH_URL;
// Optional direct-token mode — skips the SSH pairing dance when you already
// have the Gateway's shared `token` (e.g. read out of openclaw.json on the
// ECS via aliyun ecs RunCommand). When both are set, all SSH-related options
// above are ignored.
const wsUrl = args.wsUrl ?? null;
const gatewayToken = args.gatewayToken ?? null;
const useDirectToken = wsUrl !== null && gatewayToken !== null;
// Alternative: skip SSH pairing by supplying a setup code from anywhere else
// (e.g. ran the pairing script on the ECS via aliyun cloud-assistant
// RunCommand and grabbed the printed base64url code). The setup code already
// embeds the gateway URL and a freshly-issued deviceToken matching whatever
// deviceSeed was used to create the pairing request.
const setupCode = args.setupCode ?? null;
const setupSeedB64 = args.setupSeed ?? null; // base64url of the deviceSeed used to make the request
const useSetupCode = setupCode !== null && setupSeedB64 !== null;
const skipRelayHealth = useDirectToken || useSetupCode || args.skipRelayHealth === true;

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const runIdBase = randomUUID().slice(0, 8);
const artifactsDir = resolve(process.cwd(), "artifacts");
const artifactPrefix = join(artifactsDir, `deeply-research-test-${runStamp}`);

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  if (skipRelayHealth) {
    log("relay health check skipped");
  } else {
    await checkRelayHealth();
  }

  let gateway;
  if (useSetupCode) {
    const setup = decodeJson(setupCode);
    if (!isRecord(setup) || typeof setup.url !== "string" || typeof setup.deviceToken !== "string") {
      throw new Error("--setup-code did not decode to a valid setup payload");
    }
    const seedBytes = Buffer.from(setupSeedB64, "base64url");
    if (seedBytes.length !== 32) {
      throw new Error(`--setup-seed must decode to 32 bytes, got ${seedBytes.length}`);
    }
    log(`topic="${topic}" sections=${sections} mode=setup-code url=${setup.url}`);
    gateway = new GatewayHarness({
      url: setup.url,
      deviceSeed: new Uint8Array(seedBytes),
      deviceToken: setup.deviceToken
    });
  } else if (useDirectToken) {
    log(`topic="${topic}" sections=${sections} mode=direct-token url=${wsUrl}`);
    gateway = new GatewayHarness({
      url: wsUrl,
      deviceSeed: generateDeviceSeed(),
      token: gatewayToken
    });
  } else {
    log(`topic="${topic}" sections=${sections} mode=pairing host=${host}`);
    requireFile(passwordFile, "password file");
    requireFile(knownHosts, "known_hosts file");
    const pair = await pairFreshDevice();
    gateway = new GatewayHarness({
      url: pair.setup.url,
      deviceSeed: pair.deviceSeed,
      deviceToken: pair.setup.deviceToken
    });
  }

  try {
    await gateway.connect();
    log(`gateway connected runId=${runIdBase}`);

    // ─── Phase A: research agent turn ───
    const visible = buildResearchKickoffVisibleText({ topic, sections });
    const phaseAPrompt = buildResearchKickoffPromptInline({ topic, sections });
    const phaseASessionKey = `agent:deeply:kokochat:deeply-course:research:regression:${runIdBase}`;
    const phaseARun = await runOneTurn({
      gateway,
      sessionKey: phaseASessionKey,
      prompt: phaseAPrompt,
      label: "phase-a",
      artifactPrefix,
      visibleLine: visible,
      // Phase A may spend 3-5 min on hosted search/web_fetch on a wide topic.
      timeoutMs: 600_000
    });

    const plan = extractResearchPlan(phaseARun.rawText);
    if (plan !== null) {
      writeFileSync(
        `${artifactPrefix}.phase-a.plan.json`,
        JSON.stringify(plan, null, 2),
        "utf8"
      );
      log(`phase-a plan: courseTitle="${plan.courseTitle}", sections=${plan.sections.length}`);
    } else {
      log(`phase-a PLAN BLOCK MISSING — Phase B will be skipped. inspect phase-a.raw.txt`);
    }

    // ─── Phase B: per-section search inferOnce ───
    if (plan !== null) {
      const phaseBPrompt = buildResearchOutlineFromPlanPromptInline({ topic, plan });
      const phaseBSessionKey = `agent:deeply:kokochat:deeply-course:oneshot:regression:${runIdBase}`;
      const phaseBRun = await runOneTurn({
        gateway,
        sessionKey: phaseBSessionKey,
        prompt: phaseBPrompt,
        label: "phase-b",
        artifactPrefix,
        visibleLine: "[Phase B: plan → per-section search → outline JSON]",
        // Phase B searches once per section, so it can run several minutes.
        timeoutMs: 360_000
      });

      const outline = parseOutlineSummary(phaseBRun.rawText);
      writeFileSync(`${artifactPrefix}.phase-b.outline.md`, outline, "utf8");

      // Cleanup oneshot session.
      await gateway.call("sessions.delete", { key: phaseBSessionKey }, 30_000).catch((err) => {
        log(`phase-b sessions.delete failed (ignored): ${err?.message ?? err}`);
      });
    }

    // Cleanup phase A session.
    await gateway.call("sessions.delete", { key: phaseASessionKey }, 30_000).catch((err) => {
      log(`phase-a sessions.delete failed (ignored): ${err?.message ?? err}`);
    });

    const phaseAToolCount = phaseARun.events.reduce((acc, e) => acc + (e.tools?.length ?? 0), 0);
    log(`summary:`);
    log(`  phase-a tool calls: ${phaseAToolCount}`);
    log(`  phase-a raw text: ${phaseARun.rawText.length} chars`);
    log(`  phase-a plan block: ${plan !== null ? "ok" : "MISSING"}`);
    log(`artifacts (prefix ${artifactPrefix}):`);
    log(`  .phase-a.prompt.txt / .phase-a.events.json / .phase-a.raw.txt`);
    if (plan !== null) {
      log(`  .phase-a.plan.json`);
      log(`  .phase-b.prompt.txt / .phase-b.events.json / .phase-b.raw.txt / .phase-b.outline.md`);
    }
  } finally {
    await gateway.close();
  }
}

/**
 * Send one prompt as the user message of a session, wait for the agent to
 * finish, dump per-phase artifacts (prompt.txt, events.json, raw.txt), and
 * return both the event log and the final assistant text.
 */
async function runOneTurn({
  gateway,
  sessionKey,
  prompt,
  label,
  artifactPrefix,
  visibleLine,
  timeoutMs
}) {
  writeFileSync(`${artifactPrefix}.${label}.prompt.txt`, prompt, "utf8");
  log(`[${label}] wrote ${artifactPrefix}.${label}.prompt.txt (${prompt.length} chars)`);

  // Clean any prior accidental hit on this key so the run starts from empty.
  await gateway.call("sessions.delete", { key: sessionKey }, 30_000).catch(() => undefined);

  const events = [];
  const detach = gateway.on("chat", (payload) => {
    const tools = collectToolCalls(payload);
    events.push({
      at: Date.now(),
      state: payload.state,
      runId: payload.runId,
      textLen: typeof payload.text === "string" ? payload.text.length : 0,
      textTail: typeof payload.text === "string" ? payload.text.slice(-80) : "",
      tools
    });
  });

  log(`[${label}] sending chat.send visible="${visibleLine}"`);
  const send = await gateway.call("chat.send", {
    sessionKey,
    message: prompt,
    idempotencyKey: `deeply-regression-${label}-${runIdBase}`,
    timeoutMs
  }, 30_000);

  if (typeof send.runId !== "string" || send.runId.length === 0) {
    detach();
    throw new Error(`[${label}] chat.send did not return runId: ${JSON.stringify(send)}`);
  }
  log(`[${label}] chat.send runId=${send.runId}; waiting for final…`);

  const status = await gateway.call("agent.wait", {
    runId: send.runId,
    timeoutMs
  }, timeoutMs + 60_000);
  log(`[${label}] agent.wait status=${status.status}`);
  if (status.status !== "ok") {
    log(`[${label}] agent.wait full status: ${JSON.stringify(status)}`);
  }

  detach();

  const history = await gateway.call("chat.history", {
    sessionKey,
    limit: 16,
    maxChars: 200_000
  }, 60_000);
  const rawText = extractLastAssistantText(history.messages);

  writeFileSync(`${artifactPrefix}.${label}.events.json`, JSON.stringify(events, null, 2), "utf8");
  writeFileSync(`${artifactPrefix}.${label}.raw.txt`, rawText, "utf8");

  return { events, rawText, status };
}

function buildResearchKickoffVisibleText({ topic, sections }) {
  if (sections > 0) {
    return `请围绕「${topic}」做一份 ${sections} 节的深度调研课程`;
  }
  return `请围绕「${topic}」做一份深度调研课程`;
}

/**
 * Mirror of miniapps/deeply/mobile/persona.ts → buildResearchKickoffPrompt.
 * Phase A: agent explores + designs course outline, emits `koko.deeply.research.plan`.
 * Keep in sync when persona.ts changes.
 */
function buildResearchKickoffPromptInline({ topic, sections }) {
  const visible = buildResearchKickoffVisibleText({ topic, sections });
  const sectionHint = sections > 0
    ? `用户期望约 ${sections} 节,以材料自然结构为准上下浮动。`
    : `节数自由决定,按题目自然结构来。`;
  return `[系统注入 · 深度调研课程 Phase A:出课程目录 plan]

按 \`kokochat-deeply-research\` skill 走两阶段研报流程。这一轮的任务
**不是收集材料**,而是**理解题目并设计一门课的教学目录**:用户想学
什么?这道题值得讲哪些主题?怎么拆才适合学?

材料收集留给 Phase B —— 它会拿到你这份 plan,然后对每节按你给的
\`searchHint\` 单独联网搜,挂上真实 sources。你**不要在 plan 里 cite URL,
不要带 sources 字段**。

# 你这一轮怎么工作

需要联网就联网,**自己判断要不要搜、搜几次**。一般情况下,如果题目带
时间词、具体人名、近期事件,先搜一两下校准认知很值得;如果题目是
通识/历史/概念题,直接靠模型理解可能更好。

联网用 \`web_fetch\`:

\`\`\`
web_fetch({
  url: "https://deeply.plus/deeply/search?q=<EN keywords>&count=5",
  maxChars: 60000
})
\`\`\`

返回 body 是 JSON,结构 \`{ ok, provider, query, count, results: [{ title, url, snippet }] }\`。
拿 snippet 校准认知就够,**不要把搜到的 URL 写进 plan**。\`ok=false\` 时
如实说"搜不到"就行,凭你对题目的理解继续设计目录。

# Prose 节奏

每段中文 prose 末尾打 \`〔KP〕\` sentinel(客户端会替换成段落分隔)。
搜索前后简单说一下你在想什么、搜到了什么、最终目录怎么定的。综合段
之后接 fenced block。

# Output schema

输出**唯一一个** \`koko.deeply.research.plan\` fenced block,内部
是合法 JSON,字段如下:

\`\`\`json
{
  "version": 1,
  "topic": "用户提交的原题(原样)",
  "courseTitle": "5-60 字课程标题",
  "introduction": "200-600 字课程介绍:这门课要回答什么问题、有哪些值得展开的视角、为什么这个时间点值得看",
  "sections": [
    {
      "index": 1,
      "title": "8-30 字节标题,从教学维度命名(可以按人物 / 视角 / 阶段 / 概念,选最贴这道题的切法)",
      "searchHint": "EN keywords for Phase B to search this section specifically; 12-40 chars; concrete enough to return useful results, not the whole topic again"
    }
  ]
}
\`\`\`

约束:

- \`searchHint\` 用英文关键词组,**要比原题更窄、更聚焦**,这样 Phase B
  搜出来的才贴本节;不要每节都重抄原题。
- 不要输出 \`sections.sources\` / \`outlineMarkdown\` —— 那些是 Phase B 的事。
- fenced block 之外不要再写文字。
- ${sectionHint}

[用户消息]
${visible}`;
}

/**
 * Mirror of miniapps/deeply/mobile/persona.ts →
 * buildResearchOutlineFromPlanPrompt. Phase B: oneshot agent turn that runs
 * per-section hosted search and emits the outline. Keep in sync.
 */
function buildResearchOutlineFromPlanPromptInline({ topic, plan }) {
  const planSections = plan.sections
    .map((s) => `  ${s.index}. ${s.title}\n     searchHint: ${s.searchHint}`)
    .join("\n");
  return `[Phase B · 按目录调研 + 挂 sources]

Phase A 已经设计好了课程目录(plan,见下)。这一轮的任务是为每节
**单独联网搜索**,挑出真实 sources 挂上,最终输出完整的
\`koko.deeply.research.outline\`。

**不要**自己重写 plan 的 courseTitle / introduction / 节标题 —— 直接沿用。
你要做的就是:遍历 sections,按每节 \`searchHint\` 调 hosted search,
从结果里挑相关的 sources 挂到该节。

# 用户原题

${topic}

# Phase A plan(沿用,不要修改)

courseTitle: ${plan.courseTitle}

introduction:
${plan.introduction}

sections:
${planSections}

# 联网搜索

每节按 \`searchHint\` 调:

\`\`\`
web_fetch({
  url: "https://deeply.plus/deeply/search?q=<searchHint, urlencoded>&count=5",
  maxChars: 60000
})
\`\`\`

返回 body 是 JSON \`{ ok, provider, query, count, results: [{ title, url, snippet }] }\`。
从 \`results\` 里挑跟本节真正相关的几条(数量自己决定 —— 真相关的就 1 条,
不要为了凑数硬塞)。如果一节真没合适的,sources 留空也行;**不要编 URL**。

每节 sources 里的 \`url\` 必须来自**本轮**搜索真实返回。

需要可以再用 \`web_fetch({ url, maxChars: 60000 })\` 抓个别 URL 的正文,
来更好判断它该不该上 —— 但不是必须。

# Output schema

输出**唯一一个** \`koko.deeply.research.outline\` fenced block,内部
是合法 JSON,字段:

\`\`\`json
{
  "version": 1,
  "courseTitle": "(沿用 plan 的 courseTitle)",
  "introduction": "(沿用 plan 的 introduction)",
  "sections": [
    {
      "index": 1,
      "title": "(沿用 plan 的节标题)",
      "sources": [
        { "title": "...", "url": "https://...", "stance": "primary",
          "snippet": "<=80 字中文,这条对本节为什么有用" }
      ]
    }
  ],
  "outlineMarkdown": "## 第1节:...\\n- [primary] ... — https://...\\n\\n## 第2节:..."
}
\`\`\`

- \`stance\` 必须是 \`primary\` / \`counterpoint\` / \`background\` 之一。
- 字段名严格 camelCase;JSON 字符串内引用短语优先用中文引号 “...”。
- \`outlineMarkdown\` 每节格式:\`## 第N节:标题\` + 每条资料一行
  \`- [stance] 资料标题 — url\`。
- fenced block 之外不要再写任何文字。`;
}

/**
 * Pull the Phase A plan JSON out of the agent's final message. Returns
 * `null` when the fenced block is missing or doesn't parse.
 */
function extractResearchPlan(rawText) {
  const match = rawText.match(/```koko\.deeply\.research\.plan\s*([\s\S]+?)```/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1].trim());
    if (json === null || typeof json !== "object") return null;
    return {
      topic: typeof json.topic === "string" ? json.topic : "",
      courseTitle: typeof json.courseTitle === "string" ? json.courseTitle : "",
      introduction: typeof json.introduction === "string" ? json.introduction : "",
      sections: Array.isArray(json.sections)
        ? json.sections.map((s, i) => ({
            index: typeof s?.index === "number" ? s.index : i + 1,
            title: typeof s?.title === "string" ? s.title : "",
            searchHint: typeof s?.searchHint === "string" ? s.searchHint : ""
          }))
        : []
    };
  } catch {
    return null;
  }
}

function collectToolCalls(payload) {
  // The chat event "tools" or message-level toolCalls don't have a single
  // canonical key — try the shapes we've seen.
  if (Array.isArray(payload?.tools)) {
    return payload.tools.map((t) => ({ name: t?.name, ok: t?.ok }));
  }
  if (Array.isArray(payload?.message?.content)) {
    return payload.message.content
      .filter((b) => b && (b.type === "toolCall" || b.type === "tool_use"))
      .map((b) => ({ name: b.name ?? b.tool_name, ok: true }));
  }
  return [];
}

function parseOutlineSummary(rawText) {
  // Pull the outline JSON out of the fenced block at the end of the
  // assistant message, then render a short Markdown summary of titles
  // + introduction so we can eyeball the outcome quickly.
  const match = rawText.match(/```koko\.deeply\.research\.outline\s*([\s\S]+?)```/);
  if (!match) {
    return `# (no outline fenced block found)\n\n${rawText.slice(-2000)}`;
  }
  let json;
  try {
    json = JSON.parse(match[1].trim());
  } catch (error) {
    return `# (outline JSON parse failed: ${error.message})\n\n${match[1]}`;
  }
  const lines = [];
  lines.push(`# ${json.courseTitle ?? "(no courseTitle)"}\n`);
  if (typeof json.introduction === "string") {
    lines.push(json.introduction.trim() + "\n");
  }
  if (Array.isArray(json.sections)) {
    json.sections.forEach((s, i) => {
      const title = s?.title ?? "(no title)";
      const idx = s?.index ?? i + 1;
      const sourceCount = Array.isArray(s?.sources) ? s.sources.length : 0;
      lines.push(`${idx}. ${title}  _(${sourceCount} sources)_`);
    });
  }
  return lines.join("\n");
}

async function checkRelayHealth() {
  if (relayHealthUrl.length === 0) return;
  const response = await fetch(relayHealthUrl);
  if (!response.ok) {
    throw new Error(`relay health failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body?.ok !== true || body?.status !== "live") {
    throw new Error(`relay health payload not live: ${JSON.stringify(body)}`);
  }
  log("relay health ok");
}

async function pairFreshDevice() {
  const deviceSeed = generateDeviceSeed();
  const identity = await deriveDeviceIdentity(deviceSeed);
  const request = {
    type: "kokochat.pairingRequest",
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    role: DEFAULT_ROLE,
    scopes: [...DEFAULT_SCOPES],
    client: {
      id: "openclaw-ios",
      version: "0.0.1-deeply-test",
      platform: "ios",
      mode: "ui",
      displayName: "Deeply Research Test"
    }
  };
  const requestCode = encodeJson(request);
  const setupCode = runRemotePairing(requestCode).trim();
  const setup = decodeJson(setupCode);
  if (!isRecord(setup) || typeof setup.url !== "string" || typeof setup.deviceToken !== "string") {
    throw new Error(`pairing script returned invalid setup code`);
  }
  log("fresh pairing code received");
  return { request, setup, deviceSeed };
}

function runRemotePairing(requestCode) {
  const script = [
    "log_user 0",
    "set timeout 180",
    `set pass [exec cat ${quoteTcl(passwordFile)}]`,
    `set request ${quoteTcl(requestCode)}`,
    `set remote_script ${quoteTcl(remotePairingScript)}`,
    "set code \"\"",
    "set cmd \"KOKOCHAT_PAIRING_REQUEST='$request' node $remote_script\"",
    [
      "spawn ssh",
      "-o StrictHostKeyChecking=no",
      `-o UserKnownHostsFile=${knownHosts}`,
      `root@${host}`,
      "$cmd"
    ].join(" "),
    "expect {",
    "  -re \"Are you sure you want to continue connecting\" { send \"yes\\r\"; exp_continue }",
    "  -re \"assword:\" { send \"$pass\\r\"; exp_continue }",
    "  -re {([A-Za-z0-9_-]{80,})} { set code $expect_out(1,string); exp_continue }",
    "  eof",
    "}",
    "puts $code"
  ].join("\n");
  return execFileSync("expect", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

class GatewayHarness {
  constructor({ url, deviceSeed, deviceToken, token }) {
    this.url = url;
    this.deviceSeed = deviceSeed;
    this.deviceToken = deviceToken;
    this.token = token;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.challenge = null;
    this.challengeWaiter = null;
    this.eventHandlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on("message", (data, isBinary) => {
      if (!isBinary) this.handleFrame(String(data));
    });
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.once("open", resolveOpen);
      this.ws.once("error", rejectOpen);
    });

    const challenge = await this.waitForChallenge();
    const built = await buildConnectParams({
      ...(this.deviceToken !== undefined && this.deviceToken !== null
        ? { deviceToken: this.deviceToken }
        : {}),
      ...(this.token !== undefined && this.token !== null
        ? { token: this.token }
        : {}),
      deviceSeed: this.deviceSeed,
      nonce: challenge.nonce,
      client: {
        id: "openclaw-ios",
        version: "0.0.1-deeply-test",
        platform: "ios",
        mode: "ui"
      },
      role: DEFAULT_ROLE,
      scopes: [...DEFAULT_SCOPES]
    });
    const hello = await this.call("connect", built.params, 30_000);
    if (hello.type !== "hello-ok") {
      throw new Error(`connect did not return hello-ok: ${JSON.stringify(hello)}`);
    }
  }

  on(event, callback) {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(callback);
    return () => set.delete(callback);
  }

  call(method, params, timeoutMs = 60_000) {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway websocket is not open"));
    }
    const id = `reg-${this.nextId++}`;
    const frame = params === undefined ? { type: "req", id, method } : { type: "req", id, method, params };
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer, method });
      this.ws.send(JSON.stringify(frame));
    });
  }

  waitForChallenge() {
    if (this.challenge !== null) return Promise.resolve(this.challenge);
    return new Promise((resolveCh, rejectCh) => {
      const timer = setTimeout(() => rejectCh(new Error("timed out waiting for connect.challenge")), 30_000);
      this.challengeWaiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolveCh(value);
        }
      };
    });
  }

  handleFrame(text) {
    const frame = JSON.parse(text);
    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        this.challenge = frame.payload;
        if (this.challengeWaiter !== null) {
          this.challengeWaiter.resolve(frame.payload);
          this.challengeWaiter = null;
        }
        return;
      }
      const handlers = this.eventHandlers.get(frame.event);
      if (handlers) {
        for (const handler of handlers) {
          try { handler(frame.payload); } catch { /* ignore */ }
        }
      }
      return;
    }
    if (frame.type !== "res") return;
    const pending = this.pending.get(frame.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok === true) {
      pending.resolve(frame.payload ?? {});
    } else {
      const err = new Error(frame.error?.message ?? `${pending.method} failed`);
      err.code = frame.error?.code;
      pending.reject(err);
    }
  }

  async close() {
    if (this.ws === null) return;
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 200);
      this.ws.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
      this.ws.close(1000, "deeply research test done");
    });
    this.ws = null;
  }
}

function extractLastAssistantText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message)) continue;
    if (message.role !== "assistant" && message.role !== "agent") continue;
    if (typeof message.text === "string" && message.text.length > 0) return message.text;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => isRecord(b) && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (text.length > 0) return text;
  }
  return "";
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function log(msg) {
  console.log(`[deeply-research-test] ${msg}`);
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  if (typeof out.passwordFile === "string") out.passwordFile = resolve(out.passwordFile);
  if (typeof out.knownHosts === "string") out.knownHosts = resolve(out.knownHosts);
  return out;
}

function quoteTcl(value) {
  return `{${String(value).replace(/\\/g, "\\\\").replace(/}/g, "\\}")}}`;
}

await main().catch((error) => {
  console.error(`[deeply-research-test] FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
