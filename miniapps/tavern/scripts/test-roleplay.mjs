#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateLorebook } from "../roleplay/lorebook.mjs";
import { buildRoleplayBootstrapPrompt, getFirstMessage } from "../roleplay/prompt.mjs";

const card = {
  name: "Detective Ada",
  inChatName: "Ada",
  data: {
    name: "Ada",
    description: "{{char}} is a careful detective in Avalon.",
    personality: "Calm, observant, concise.",
    scenario: "{{user}} meets {{char}} at a rainy station.",
    first_mes: "*{{char}} closes her notebook.* Hello, {{user}}.",
    mes_example: "<START>\n{{user}}: Any clues?\n{{char}}: The mud tells us enough.",
    system_prompt: "Write {{char}}'s next reply in a fictional chat.",
    post_history_instructions: "Keep replies grounded in evidence.",
    character_book: {
      entries: [
        { keys: ["Avalon"], content: "Avalon is the last holy city.", enabled: true, insertion_order: 200, extensions: { position: 1 } },
        { keys: ["missing"], content: "Should not appear.", enabled: true, insertion_order: 100 },
        { keys: [], content: "Rain makes footprints visible.", constant: true, enabled: true, insertion_order: 50, extensions: { position: 0 } },
        { keys: ["disabled"], content: "Disabled content.", enabled: false }
      ]
    }
  }
};

assert.equal(getFirstMessage(card), "*Ada closes her notebook.* Hello, User.");

const lore = evaluateLorebook(card.data.character_book, [{ role: "user", text: "Tell me about Avalon." }]);
assert.deepEqual(lore.beforeCharDefs.map((x) => x.content), ["Rain makes footprints visible."]);
assert.deepEqual(lore.afterCharDefs.map((x) => x.content), ["Avalon is the last holy city."]);
assert.equal(lore.all.length, 2);

const prompt = buildRoleplayBootstrapPrompt(card, "What happened in Avalon?", [
  { role: "assistant", text: getFirstMessage(card) }
]);
assert.match(prompt, /Write Ada's next reply/);
assert.match(prompt, /Ada is a careful detective in Avalon/);
assert.match(prompt, /Avalon is the last holy city/);
assert.match(prompt, /Rain makes footprints visible/);
assert.match(prompt, /User: What happened in Avalon\?/);
assert.doesNotMatch(prompt, /Should not appear/);
assert.doesNotMatch(prompt, /Disabled content/);

console.log("roleplay prompt/lorebook tests passed");
