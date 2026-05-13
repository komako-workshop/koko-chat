#!/usr/bin/env node
/**
 * Live smoke test for the Tavern mini-app's OpenClaw integration.
 *
 * What this proves:
 *   1. The `tavern` agent exists, gateway-routable, and reachable.
 *   2. The `kokochat-tavern-search` skill is visible to that agent.
 *   3. End-to-end: a user prompt makes the agent invoke the bin tool, pick
 *      cards, and return a koko.tavern.recommendations fenced block whose
 *      contents pass the same validation KokoChat will run later.
 *
 * Usage:
 *   node miniapps/tavern/scripts/spike-tavern-skill.mjs
 *
 * Optional env (mirrors spike-openclaw-runtime.mjs):
 *   KOKO_TEST_GATEWAY_URL=ws://127.0.0.1:18789
 *   KOKO_TEST_GATEWAY_TOKEN=<token>
 *   KOKO_TEST_TAVERN_PROMPT="..."   override the test user prompt
 *   KOKO_TEST_TAVERN_EXPECT="smalltalk"
 *                                    expect a chit-chat reply (no fenced
 *                                    block). Default expectation is a valid
 *                                    recommendations block.
 *
 * The test creates a session under agent:tavern:kokochat:tavern:spike-... and
 * cleans it up. It is safe to run repeatedly.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const gatewayUrl = process.env.KOKO_TEST_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const gatewayToken = process.env.KOKO_TEST_GATEWAY_TOKEN ?? readGatewayToken();
const userPrompt =
  process.env.KOKO_TEST_TAVERN_PROMPT ??
  "帮我找几个适合慢节奏推理的女性侦探角色，最好是现代都市背景。";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SESSION_KEY = `agent:tavern:kokochat:tavern:spike-${stamp}`;
const RUN_KEY = `koko-tavern-spike-${stamp}`;

if (!gatewayToken) {
  throw new Error(
    "No gateway token found. Set KOKO_TEST_GATEWAY_TOKEN or configure ~/.openclaw/openclaw.json."
  );
}

async function main() {
  console.log(`[spike] gateway=${gatewayUrl}`);
  console.log(`[spike] sessionKey=${SESSION_KEY}`);

  try {
    const created = await gatewayCall("sessions.create", {
      key: SESSION_KEY,
      agentId: "tavern",
      label: "KokoChat tavern spike"
    });
    assert(created.ok === true, "sessions.create did not return ok=true");

    console.log(`[spike] sending prompt (${userPrompt.length} chars)`);
    const send = await gatewayCall("sessions.send", {
      key: SESSION_KEY,
      message: userPrompt,
      idempotencyKey: RUN_KEY,
      timeoutMs: 180_000
    });
    assert(send.runId === RUN_KEY, "sessions.send returned unexpected runId");

    console.log(`[spike] waiting for run ${RUN_KEY}`);
    const status = await gatewayCall(
      "agent.wait",
      { runId: RUN_KEY, timeoutMs: 180_000 },
      200_000
    );
    assert(status.status === "ok", `agent.wait status=${status.status} error=${status.error ?? ""}`);

    const history = await gatewayCall("chat.history", {
      sessionKey: SESSION_KEY,
      limit: 20,
      maxChars: 60_000
    });
    const text = lastAssistantText(history.messages ?? []);
    assert(text.length > 0, "no assistant text returned");
    console.log("[spike] assistant reply head:");
    console.log(indent(text.split("\n").slice(0, 6).join("\n"), "  | "));
    console.log("...");

    const expectBlock = process.env.KOKO_TEST_TAVERN_EXPECT === "smalltalk" ? false : true;
    const block = extractRecommendationsBlock(text);

    if (!expectBlock) {
      assert(block === null, "small-talk turn unexpectedly produced a recommendations block");
      console.log("[spike] small-talk path OK (prose, no block)");
      return;
    }

    assert(block !== null, "no koko.tavern.recommendations fenced block found");
    const parsed = JSON.parse(block);
    validateBlock(parsed);
    console.log(`[spike] recommendations: ${parsed.cards.length} cards, query="${parsed.query}"`);
    for (const card of parsed.cards) {
      console.log(
        `  - ${card.nameZh} / ${card.name}  [${card.matchTags.join(", ")}]  ${card.pageUrl}`
      );
    }
    console.log("[spike] OK");
  } finally {
    try {
      await gatewayCall("sessions.delete", { key: SESSION_KEY });
    } catch (error) {
      console.warn(`[spike] cleanup failed: ${describeError(error)}`);
    }
  }
}

function validateBlock(block) {
  assert(typeof block === "object" && block !== null, "block is not an object");
  assert(block.version === 1, `unexpected block version ${block.version}`);
  assert(typeof block.query === "string" && block.query.length > 0, "block.query missing");
  assert(Array.isArray(block.cards), "block.cards must be an array");
  assert(block.cards.length >= 3 && block.cards.length <= 5, `expected 3-5 cards, got ${block.cards.length}`);
  for (let i = 0; i < block.cards.length; i += 1) {
    const card = block.cards[i];
    const where = `cards[${i}]`;
    assertString(card.pageUrl, `${where}.pageUrl`);
    assertString(card.imageUrl, `${where}.imageUrl`);
    assertString(card.name, `${where}.name`);
    assertString(card.nameZh, `${where}.nameZh`);
    assertString(card.tagline, `${where}.tagline`);
    assertString(card.taglineZh, `${where}.taglineZh`);
    assert(Array.isArray(card.tags), `${where}.tags must be array`);
    assert(Array.isArray(card.matchTags), `${where}.matchTags must be array`);
    assertString(card.reason, `${where}.reason`);
    assert(
      card.safety === "sfw" || card.safety === "nsfw" || card.safety === "unknown",
      `${where}.safety has unexpected value ${card.safety}`
    );
    assert(
      card.pageUrl.startsWith("https://character-tavern.com/character/"),
      `${where}.pageUrl is not a Character Tavern detail URL`
    );
    assert(
      card.imageUrl.startsWith("https://cards.character-tavern.com/"),
      `${where}.imageUrl is not a Character Tavern card image URL`
    );
  }
}

function extractRecommendationsBlock(text) {
  // Tolerate either a leading 4-backtick wrapper or a plain triple-backtick.
  const match = /```koko\.tavern\.recommendations\s*\n([\s\S]*?)\n```/m.exec(text);
  return match === null ? null : match[1];
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant" && message?.role !== "agent") continue;
    if (typeof message.text === "string" && message.text.length > 0) return message.text;
    if (!Array.isArray(message.content)) continue;
    const joined = message.content
      .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("");
    if (joined.length > 0) return joined;
  }
  return "";
}

async function gatewayCall(method, params, timeoutMs = 30_000) {
  const { stdout } = await execFileAsync(
    "openclaw",
    [
      "gateway",
      "call",
      "--url",
      gatewayUrl,
      "--token",
      gatewayToken,
      method,
      "--json",
      "--timeout",
      String(timeoutMs),
      "--params",
      JSON.stringify(params)
    ],
    {
      timeout: timeoutMs + 15_000,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`
      }
    }
  );
  return JSON.parse(stdout);
}

function readGatewayToken() {
  const configPath = join(process.env.HOME ?? "", ".openclaw", "openclaw.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof parsed?.gateway?.auth?.token === "string" ? parsed.gateway.auth.token : null;
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function indent(text, prefix) {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error) => {
  console.error("[spike] failed:", describeError(error));
  process.exit(1);
});
