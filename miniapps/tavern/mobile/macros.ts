/**
 * Substitute SillyTavern card macros in a text blob.
 *
 * Cards on character-tavern (and SillyTavern in general) sprinkle
 * `{{user}}` / `{{char}}` placeholders through description, scenario,
 * personality, and especially first_mes. The user expects to see their
 * own name where `{{user}}` appears, and the character's name where
 * `{{char}}` appears.
 *
 * SillyTavern's official syntax is double-braces (`{{user}}`,
 * case-insensitive), but in practice many card authors get it wrong
 * with single braces (`{user}`, `{User}`) or stray capitalization. We
 * normalize all of those.
 *
 * Other macros (`{{time}}`, `{{random::a::b}}`, `{{getvar::x}}` …) are
 * intentionally not supported in v1: less than 0.5% of our shipped
 * catalogue uses them, and a full macro engine would be a much bigger
 * commitment.
 */

export interface MacroContext {
  user: string;
  char: string;
}

const USER_PATTERN = /\{\{?\s*user\s*\}?\}/gi;
const CHAR_PATTERN = /\{\{?\s*char\s*\}?\}/gi;

export function applyTavernMacros(text: string, ctx: MacroContext): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return text.replace(USER_PATTERN, ctx.user).replace(CHAR_PATTERN, ctx.char);
}
