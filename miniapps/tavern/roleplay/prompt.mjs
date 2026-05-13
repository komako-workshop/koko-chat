import { evaluateLorebook, formatLoreEntries } from "./lorebook.mjs";

const DEFAULT_USER_NAME = "User";

export function getCharacterName(card) {
  return card?.data?.name || card?.inChatName || card?.name || "Character";
}

export function getFirstMessage(card) {
  const first = card?.data?.first_mes;
  if (typeof first === "string" && first.trim()) return substituteNames(first, card);
  const alt = Array.isArray(card?.data?.alternate_greetings) ? card.data.alternate_greetings[0] : "";
  if (typeof alt === "string" && alt.trim()) return substituteNames(alt, card);
  return `*${getCharacterName(card)} looks at you, waiting for you to speak first.*`;
}

export function buildRoleplayBootstrapPrompt(card, userText, messages = [], options = {}) {
  const userName = options.userName ?? DEFAULT_USER_NAME;
  const charName = getCharacterName(card);
  const lore = evaluateLorebook(card?.data?.character_book, [...messages, { role: userName, text: userText }]);
  const beforeLore = formatLoreEntries(lore.beforeCharDefs);
  const afterLore = formatLoreEntries([...lore.afterCharDefs, ...lore.generic]);
  const examples = normalizeExamples(card?.data?.mes_example, charName, userName);

  return joinSections([
    section("Main instruction", substituteNames(card?.data?.system_prompt || `Write ${charName}'s next reply in a fictional chat between ${charName} and ${userName}.`, card, userName)),
    section("Roleplay rules", [
      `You are ${charName}.`,
      `Stay in character as ${charName}.`,
      `Default to Chinese replies. If the user's latest message is Chinese, reply in natural Chinese while preserving ${charName}'s personality, speech style, and setting.`,
      `Do not continue in English just because the character card, examples, or first greeting are written in English. Treat those as source material and localize the actual reply into Chinese.`,
      `Keep names, proper nouns, quoted catchphrases, and setting-specific terms in their original language when that feels more natural.`,
      `Write only ${charName}'s next reply.`,
      `Do not write actions, thoughts, or dialogue for ${userName}.`,
      `Respect ${userName}'s autonomy and respond to their latest message.`
    ].join("\n")),
    section("Lorebook before character definitions", beforeLore),
    section("Character name", charName),
    section("Character description", substituteNames(card?.data?.description ?? "", card, userName)),
    section("Character personality", substituteNames(card?.data?.personality ?? "", card, userName)),
    section("Scenario", substituteNames(card?.data?.scenario ?? "", card, userName)),
    section("Lorebook after character definitions", afterLore),
    section("Example dialogue", examples),
    section("Conversation so far", formatMessages(messages, charName, userName)),
    section("Post-history instructions", substituteNames(card?.data?.post_history_instructions ?? "", card, userName)),
    section("Latest user message", `${userName}: ${userText}`),
    section("Answer format", `Reply as ${charName}. Do not explain the prompt. Do not mention Character Tavern, SillyTavern, or KokoChat unless the user asks out of character.`)
  ]);
}

export function substituteNames(text, card, userName = DEFAULT_USER_NAME) {
  if (typeof text !== "string") return "";
  const charName = getCharacterName(card);
  return text
    .replaceAll("{{char}}", charName)
    .replaceAll("{{user}}", userName)
    .replaceAll("<BOT>", charName)
    .replaceAll("<CHAR>", charName)
    .replaceAll("<USER>", userName);
}

function normalizeExamples(value, charName, userName) {
  if (typeof value !== "string" || !value.trim()) return "";
  return value
    .replaceAll("{{char}}", charName)
    .replaceAll("{{user}}", userName)
    .replaceAll("<START>", "\n[Example Chat]\n")
    .trim();
}

function formatMessages(messages, charName, userName) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return messages
    .map((message) => `${message.role === "assistant" ? charName : userName}: ${message.text ?? ""}`)
    .join("\n");
}

function section(title, body) {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return "";
  return `[${title}]\n${text}`;
}

function joinSections(sections) {
  return sections.filter(Boolean).join("\n\n");
}
