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

const happyText = [
  "我挑了几张推荐。",
  "",
  "```koko.tavern.recommendations",
  JSON.stringify({
    version: 1,
    query: "demo",
    cards: [
      makeCard("a"),
      makeCard("b"),
      makeCard("c")
    ]
  }),
  "```"
].join("\n");

test("happy path: 3 cards, intro preserved", () => {
  const result = parseTavernRecommendations(happyText);
  assert(result.ok, `expected ok, got error: ${result.ok ? "" : result.error}`);
  if (result.ok) {
    assertEq(result.value.cards.length, 3, "card count");
    assertEq(result.value.query, "demo", "query");
    assertEq(result.value.intro, "我挑了几张推荐。", "intro");
  }
});

test("rejects fewer than 3 cards", () => {
  const text = wrap({
    version: 1,
    query: "x",
    cards: [makeCard("only")]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("rejects more than 5 cards", () => {
  const text = wrap({
    version: 1,
    query: "x",
    cards: [
      makeCard("a"),
      makeCard("b"),
      makeCard("c"),
      makeCard("d"),
      makeCard("e"),
      makeCard("f")
    ]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("rejects pageUrl outside character-tavern.com", () => {
  const card = makeCard("a");
  card.pageUrl = "https://evil.example.com/character/a/b";
  const text = wrap({
    version: 1,
    query: "x",
    cards: [card, makeCard("b"), makeCard("c")]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("rejects unknown safety value", () => {
  const card = makeCard("a");
  card.safety = "naughty";
  const text = wrap({
    version: 1,
    query: "x",
    cards: [card, makeCard("b"), makeCard("c")]
  });
  const result = parseTavernRecommendations(text);
  assert(!result.ok, "expected failure");
});

test("rejects when fenced block is missing", () => {
  const result = parseTavernRecommendations("普通对话，没有代码块。");
  assert(!result.ok, "expected failure");
});

test("tolerates extra whitespace inside the block", () => {
  const text = "前置文本。\n\n```koko.tavern.recommendations\n\n" + JSON.stringify({
    version: 1,
    query: "trim",
    cards: [makeCard("a"), makeCard("b"), makeCard("c")]
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
    reason: "推荐理由",
    safety: "sfw"
  };
}

function wrap(obj) {
  return "```koko.tavern.recommendations\n" + JSON.stringify(obj) + "\n```";
}
