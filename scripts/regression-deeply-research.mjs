#!/usr/bin/env node
/**
 * Run one Deeply "深度调研课程" kickoff against the cloud OpenClaw and dump
 * the full transcript so we can verify prompt changes from this repo
 * actually take effect on the deeply agent.
 *
 * Two-phase pipeline (matches what the KokoChat client runs):
 *
 *   Phase A — research agent turn:
 *     KokoChat wraps the user's "请围绕「...」做一份深度调研课程" into a
 *     long gatewayText (see persona.ts → buildResearchKickoffPrompt). The
 *     agent searches the web, narrates in Chinese, and finally emits one
 *     `koko.deeply.research.notes` fenced block (synthesis + flat sources).
 *
 *   Phase B — stateless inferOnce on the same agent:
 *     KokoChat takes Phase A's notes block, builds a new prompt
 *     (persona.ts → buildResearchOutlineFromNotesPrompt), and chat.send's
 *     it with a fresh oneshot session key. The agent emits one
 *     `koko.deeply.research.outline` fenced block (per-section sources).
 *
 *   We replicate both phases here so regression runs match production
 *   exactly. Inline-copied prompts below MUST be kept in sync with
 *   persona.ts.
 *
 *   On test:
 *     - Phase A events.json should contain KokoChat hosted search / web_fetch tool calls.
 *     - Phase A notes.json sources URLs should overlap with URLs from those
 *       tool results (i.e. the model didn't fabricate sources).
 *     - Phase B raw.txt should parse cleanly into a research outline block
 *       whose section.sources URLs are a strict subset of Phase A sources.
 *
 * Usage:
 *   node scripts/regression-deeply-research.mjs --topic "一二级投资人现在怎么看AI"
 *   # optional flags
 *   node scripts/regression-deeply-research.mjs --topic "..." --sections 8
 *   node scripts/regression-deeply-research.mjs --topic "..." --host 47.237.5.255
 *
 * Output goes under ./artifacts/deeply-research-test-<timestamp>.{
 *   phase-a.prompt.txt, phase-a.events.json, phase-a.raw.txt, phase-a.notes.json,
 *   phase-b.prompt.txt, phase-b.events.json, phase-b.raw.txt, phase-b.outline.md
 * } so multiple runs can be diffed.
 *
 * Sync notes:
 *   - `buildResearchKickoffPromptInline` + `buildResearchOutlineFromNotesPromptInline`
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

    const notes = extractResearchNotes(phaseARun.rawText);
    if (notes !== null) {
      writeFileSync(
        `${artifactPrefix}.phase-a.notes.json`,
        JSON.stringify(notes, null, 2),
        "utf8"
      );
      log(`phase-a notes: synthesis=${notes.synthesis.length} chars, sources=${notes.sources.length}`);
    } else {
      log(`phase-a NOTES BLOCK MISSING — Phase B will be skipped. inspect phase-a.raw.txt`);
    }

    // ─── Phase B: stateless outline-from-notes inferOnce ───
    if (notes !== null) {
      const phaseBPrompt = buildResearchOutlineFromNotesPromptInline({
        topic,
        sections,
        synthesis: notes.synthesis,
        sources: notes.sources
      });
      const phaseBSessionKey = `agent:deeply:kokochat:deeply-course:oneshot:regression:${runIdBase}`;
      const phaseBRun = await runOneTurn({
        gateway,
        sessionKey: phaseBSessionKey,
        prompt: phaseBPrompt,
        label: "phase-b",
        artifactPrefix,
        visibleLine: "[Phase B: 调研笔记 → outline JSON]",
        // Phase B has no web tools, just JSON generation — 90s ceiling.
        timeoutMs: 90_000
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
    log(`  phase-a notes block: ${notes !== null ? "ok" : "MISSING"}`);
    log(`artifacts (prefix ${artifactPrefix}):`);
    log(`  .phase-a.prompt.txt / .phase-a.events.json / .phase-a.raw.txt`);
    if (notes !== null) {
      log(`  .phase-a.notes.json`);
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
 * Phase A: agent does research only, emits `koko.deeply.research.notes`.
 * Keep in sync when persona.ts changes.
 */
function buildResearchKickoffPromptInline({ topic, sections }) {
  const visible = buildResearchKickoffVisibleText({ topic, sections });
  void sections; // sections only matters in Phase B
  return `[系统注入 · 深度调研课程 Phase A:调研]

按 \`kokochat-deeply-research\` skill 走研报流程。这一轮**只调研、收集
sources**,不要决定课程目录、不要拆 section、不要分配每节资料 ——
那是 Phase B 单独的一次推理,你交接给它的就是下面 fenced block 的
"调研笔记"。

# 3 条硬约束(其它都可商量)

1. **先调用 KokoChat hosted search,再 emit fenced block**。搜索结果为 0 时,
   fenced block 里 \`sources\` 数组必须为空,**不要凭训练数据编 URL**。
2. \`sources\` 里每个 \`url\` 必须来自**本轮** KokoChat hosted search / web_fetch
   真实返回。没搜到合适的就少 cite,**不要编**。
3. 输出**唯一一个** \`koko.deeply.research.notes\` fenced block,
   内部是合法 JSON。fenced block 之后不要再写文字。

# 工具

- KokoChat hosted search:按 AGENTS.md 里允许的 \`kokochat-deeply-search\`
  exec wrapper 调用。输入只传 \`query\` + \`count\`,不传其它参数。
- \`web_fetch({ url, maxChars: 60000 })\`:挑 1-2 个最有价值的 URL 拿正文。
  url 必须来自上一步搜索返回的 http(s) 结果,不要 fetch 文件
  或自己编的 URL。

# Prose 节奏

每次 tool 调用前后用 1-3 句中文 prose 说你打算去查什么、查到了什么。
**每段 prose 末尾打 \`〔KP〕\`** sentinel(客户端会替换为段落分隔符,
不打的话所有段会粘成一坨)。综合段后接 fenced block。

# Output schema(Phase A · 调研笔记)

\`\`\`json
{
  "version": 1,
  "topic": "用户提交的原题(原样)",
  "synthesis": "300-1200 字中文调研笔记,把你这一轮搜到的关键事实、数据、观点、分歧梳理清楚。",
  "sources": [
    { "title": "...", "url": "https://...", "stance": "primary",
      "note": "<=80 字中文,说这条材料讲了什么、为什么对这个题有用" }
  ]
}
\`\`\`

字段说明:

- \`sources\` 扁平列表,**不分 section**(拆 section 是 Phase B 的工作),
  5-20 条之间,涵盖主流观点 / 反方 / 关键背景 / 高质量原始材料。
- \`stance\` 必须是 \`primary\` / \`counterpoint\` / \`background\` 之一。
- 不要输出 \`courseTitle\` / \`introduction\` / \`sections\` / \`outlineMarkdown\` —
  那些字段属于 Phase B 输出。

[用户消息]
${visible}`;
}

/**
 * Mirror of miniapps/deeply/mobile/persona.ts →
 * buildResearchOutlineFromNotesPrompt. Phase B: stateless oneshot turn that
 * splits Phase A notes into a structured outline. Keep in sync.
 */
function buildResearchOutlineFromNotesPromptInline({ topic, sections, synthesis, sources }) {
  const sectionHint = sections > 0
    ? `用户希望约 ${sections} 节(允许 ±20%),但仍以材料自然结构为准。`
    : `没有预设节数 —— 按材料自然结构自由决定。`;
  const sourcesJsonl = sources
    .map((s, i) => `  ${i + 1}. [${s.stance}] ${s.title}\n     ${s.url}\n     ${s.note ?? s.snippet ?? ""}`)
    .join("\n");
  return `[Phase B · 拆课程目录]

Phase A 已经把调研材料交给你。这一轮**不调任何工具**,基于下面的素材
出一份课程 outline JSON。

# 输入

## 用户原题

${topic}

## Sources(主输入,按行号编号)

${sourcesJsonl}

## Phase A 调研笔记(背景参考,组织视角不一定要沿用)

${synthesis}

# 约束

- outline 里每条 url **只能从上面 sources 列表里挑**,不要新增、不要编。
- 节数:${sectionHint}
- 输出**唯一一个** \`koko.deeply.research.outline\` fenced block,
  之外不要写任何文字。
- 字段名严格 camelCase;JSON 字符串内引用短语优先用中文引号 “...”。

# Output schema

\`\`\`json
{
  "version": 1,
  "courseTitle": "5-60 字课程标题",
  "introduction": "200-600 字课程介绍",
  "sections": [
    {
      "index": 1,
      "title": "8-30 字节标题",
      "sources": [
        { "title": "...", "url": "https://...", "stance": "primary",
          "snippet": "<=80 字中文,这条对本节为什么有用" }
      ]
    }
  ],
  "outlineMarkdown": "## 第1节:...\\n- [primary] ... — https://...\\n\\n## 第2节:..."
}
\`\`\`

- 每节 \`sources\` 数量自由(0 条也行,讲解阶段会临场再搜);
  stance 沿用 sources 列表里的;同一 url 同一节不重复。
- \`outlineMarkdown\` 每节格式:\`## 第N节:标题\` + 每条资料一行
  \`- [stance] 资料标题 — url\`。`;
}

/**
 * Pull the Phase A notes JSON out of the agent's final message. Returns
 * `null` when the fenced block is missing or doesn't parse.
 */
function extractResearchNotes(rawText) {
  const match = rawText.match(/```koko\.deeply\.research\.notes\s*([\s\S]+?)```/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1].trim());
    if (json === null || typeof json !== "object") return null;
    return {
      topic: typeof json.topic === "string" ? json.topic : "",
      synthesis: typeof json.synthesis === "string" ? json.synthesis : "",
      sources: Array.isArray(json.sources) ? json.sources : []
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
