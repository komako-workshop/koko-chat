#!/usr/bin/env node
/**
 * Quick checks for parseTavernRecommendations.
 *
 * The Tavern mini-app does not yet have a unit test framework; this script
 * runs the parser directly under raw Node + `--experimental-strip-types` and
 * prints PASS/FAIL for a small set of golden inputs. Add cases when the
 * contract evolves.
 *
 * Because the parser imports `@/runtime/messageBlocks` (a host alias that
 * pulls in React Native types via the renderer module), tests need a tiny
 * resolver hook to rewrite that import to a pure-JS stub. See test-loader.mjs.
 *
 * Usage:
 *   node \
 *     --experimental-strip-types \
 *     --import='data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("./miniapps/tavern/scripts/test-loader.mjs", pathToFileURL("./"));' \
 *     miniapps/tavern/scripts/test-tavern-parse.mjs
 *
 * Or just use the wrapper:
 *   bash miniapps/tavern/scripts/test-tavern-parse.sh
 */
import { parseTavernRecommendations } from "../mobile/parseRecommendations.ts";

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- v2 schema (current) ----------

const v2Happy = wrap({
  version: 2,
  query: "demo",
  items: [
    { kind: "text", text: "挑了几张你看看" },
    { kind: "text", text: "第一张：A 的氛围" },
    { kind: "card", card: makeCard("a") },
    { kind: "text", text: "第二张：B" },
    { kind: "card", card: makeCard("b") },
    { kind: "text", text: "第三张：C" },
    { kind: "card", card: makeCard("c") }
  ]
});

test("v2 happy: 3 cards in items[] are preserved with prose bubbles", () => {
  const result = parseTavernRecommendations(v2Happy);
  assert(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`);
  if (result.ok) {
    assertEq(result.value.version, 2, "version");
    assertEq(result.value.query, "demo", "query");
    assertEq(result.value.items.length, 7, "item count");
    const cardCount = result.value.items.filter((it) => it.kind === "card").length;
    assertEq(cardCount, 3, "card count");
  }
});

test("v2 rejects fewer than 3 cards", () => {
  const text = wrap({
    version: 2,
    query: "x",
    items: [
      { kind: "text", text: "only one" },
      { kind: "card", card: makeCard("only") }
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("v2 rejects more than 5 cards", () => {
  const items = [];
  ["a", "b", "c", "d", "e", "f"].forEach((slug) => {
    items.push({ kind: "text", text: slug });
    items.push({ kind: "card", card: makeCard(slug) });
  });
  const text = wrap({ version: 2, query: "x", items });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("v2 rejects card pageUrl outside character-tavern.com", () => {
  const card = makeCard("a");
  card.pageUrl = "https://evil.example.com/character/a/b";
  const text = wrap({
    version: 2,
    query: "x",
    items: [
      { kind: "card", card },
      { kind: "card", card: makeCard("b") },
      { kind: "card", card: makeCard("c") }
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("v2 rejects unknown item kind", () => {
  const text = wrap({
    version: 2,
    query: "x",
    items: [
      { kind: "sticker", id: "wave" },
      { kind: "card", card: makeCard("a") },
      { kind: "card", card: makeCard("b") },
      { kind: "card", card: makeCard("c") }
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("v2 rejects empty text bubble", () => {
  const text = wrap({
    version: 2,
    query: "x",
    items: [
      { kind: "text", text: "" },
      { kind: "card", card: makeCard("a") },
      { kind: "card", card: makeCard("b") },
      { kind: "card", card: makeCard("c") }
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("v2 tolerates missing card safety and infers when possible", () => {
  const nsfwCard = makeCard("a");
  delete nsfwCard.safety;
  nsfwCard.tags = ["femdom", "kinky"];
  const unknownCard = makeCard("b");
  delete unknownCard.safety;
  const text = wrap({
    version: 2,
    query: "x",
    items: [
      { kind: "card", card: nsfwCard },
      { kind: "card", card: unknownCard },
      { kind: "card", card: makeCard("c") }
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`);
  if (result.ok) {
    const cards = result.value.items.filter((it) => it.kind === "card");
    assertEq(cards[0].card.safety, "nsfw", "missing safety inferred from tags");
    assertEq(cards[1].card.safety, "unknown", "missing safety falls back to unknown");
  }
});

// ---------- v1 compatibility (legacy agent build) ----------

const v1Happy = [
  "我挑了几张推荐。",
  "",
  "```koko.tavern.recommendations",
  JSON.stringify({
    version: 1,
    query: "demo",
    cards: [makeV1Card("a"), makeV1Card("b"), makeV1Card("c")]
  }),
  "```"
].join("\n");

test("v1 happy: legacy shape is projected into v2 items[]", () => {
  const result = parseTavernRecommendations(v1Happy);
  assert(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`);
  if (result.ok) {
    assertEq(result.value.version, 2, "version coerced to 2");
    const cards = result.value.items.filter((it) => it.kind === "card");
    assertEq(cards.length, 3, "card count");
    const firstText = result.value.items.find((it) => it.kind === "text");
    assert(firstText !== undefined, "first text bubble (intro) present");
    if (firstText !== undefined && firstText.kind === "text") {
      assertEq(firstText.text, "我挑了几张推荐。", "intro projected to first text");
    }
    // Each v1 reason becomes a text bubble preceding its card.
    const reasonTexts = result.value.items
      .filter((it) => it.kind === "text")
      .map((it) => it.text);
    assert(reasonTexts.includes("推荐理由"), "v1 reason projected to text bubble");
  }
});

// ---------- shared error paths ----------

test("rejects when fenced block is missing", () => {
  const result = parseTavernRecommendations("普通对话，没有代码块。");
  assert(!result.ok, "expected failure");
});

test("rejects unknown version", () => {
  const text = wrap({ version: 99, query: "x", items: [] });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("tolerates extra whitespace inside the block", () => {
  const text = "前置文本。\n\n```koko.tavern.recommendations\n\n" + JSON.stringify({
    version: 2,
    query: "trim",
    items: [
      { kind: "card", card: makeCard("a") },
      { kind: "card", card: makeCard("b") },
      { kind: "card", card: makeCard("c") }
    ]
  }) + "\n\n```";
  const result = parseTavernRecommendations(text);
  assert(result.ok, `expected ok, got: ${result.ok ? "" : result.error}`);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nall parser tests passed");
}

function makeCard(slug) {
  return {
    pageUrl: `https://character-tavern.com/character/author/${slug}`,
    imageUrl: `https://cards.character-tavern.com/author/${slug}.png`,
    name: `Card ${slug}`,
    nameZh: `卡 ${slug}`,
    tagline: "tagline",
    taglineZh: "中文场景",
    tags: ["t1", "t2"],
    matchTags: ["m1", "m2"],
    safety: "sfw"
  };
}

function makeV1Card(slug) {
  return { ...makeCard(slug), reason: "推荐理由" };
}

function wrap(obj) {
  return "```koko.tavern.recommendations\n" + JSON.stringify(obj) + "\n```";
}
