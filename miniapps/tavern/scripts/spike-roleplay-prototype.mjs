#!/usr/bin/env node
/** End-to-end smoke for the local Tavern roleplay prototype API. */

const port = Number(process.env.KOKO_TAVERN_PROTOTYPE_PORT ?? 8787);
const base = `http://127.0.0.1:${port}`;

async function main() {
  let sessionId = null;
  const load = await post("/api/load-card", { path: "corbinbear/juniper_harlow__detective" });
  assert(load.ok === true, "load-card failed");
  assert(load.card?.data?.description?.length > 100, "card description missing");
  assert(load.firstMessage?.length > 20, "first message missing");
  console.log(`[spike] loaded card ${load.card.name}`);

  const started = await post("/api/start", { card: load.card });
  assert(started.ok === true, "start failed");
  assert(typeof started.sessionId === "string", "missing sessionId");
  assert(String(started.ready ?? "").startsWith("READY:"), `bootstrap not ready: ${started.ready}`);
  sessionId = started.sessionId;
  console.log(`[spike] session ${started.sessionId} ${started.ready}`);

  try {
    const sent = await post("/api/send", {
      sessionId: started.sessionId,
      message: "我刚到警局门口，想请你带我看看案发现场。"
    });
    assert(sent.ok === true, "send failed");
    assert(typeof sent.reply === "string" && sent.reply.length > 0, "empty reply");
    assert(hasChinese(sent.reply), "expected Chinese reply");
    assert(!/OpenClaw|KokoChat|Character Tavern/i.test(sent.reply), "reply leaked system identity");
    console.log("[spike] reply head:");
    console.log(sent.reply.split("\n").slice(0, 4).join("\n"));

    const memory = await post("/api/send", {
      sessionId: started.sessionId,
      message: "你叫什么名字？"
    });
    assert(memory.ok === true, "memory send failed");
    assert(hasChinese(memory.reply), "expected Chinese memory reply");
    assert(/Juniper|朱尼珀|Harlow|哈洛/i.test(memory.reply), "character name not remembered");
    console.log("[spike] memory reply:");
    console.log(memory.reply.split("\n").slice(0, 2).join("\n"));
    console.log("[spike] OK");
  } finally {
    if (sessionId) await post("/api/delete", { sessionId }).catch(() => undefined);
  }
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasChinese(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

main().catch((error) => {
  console.error("[spike] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
