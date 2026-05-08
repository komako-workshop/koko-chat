# Roleplay Character Card Import Research

> Date: 2026-05-08
> Scope: Chinese/English SillyTavern-style character card discovery and import
> Goal: validate whether Koko can let a mobile user search/import roleplay cards
> through local OpenClaw worker automation.

## Summary

The import path is feasible, but it should be implemented as a chain of source
providers rather than assuming one site can search and download everything.

Best current provider roles:

- `cards.sillytavern.one`: strong Chinese search/discovery, unstable direct
  image download in current environment.
- `aicharactercards.com` / AICC: direct PNG download works when the card page
  exposes a WordPress download endpoint.
- `character-tavern.com`: easiest full automatic provider tested so far;
  pages embed structured character JSON and PNG URLs are direct.
- `chub.ai`: likely important ecosystem source, but direct API attempts hit
  Cloudflare 403 in current environment.

The Koko import worker should treat character card import as:

```text
discover -> resolve source -> download PNG/JSON -> parse SillyTavern card
-> normalize -> safety scan -> show preview -> save locally
```

For mobile UX, the user should only search and confirm on the phone. The local
OpenClaw worker should do the heavy work: HTTP fetching, browser automation,
site-specific parsing, PNG decoding, and safety checks.

## Tested Sites

### cards.sillytavern.one

Role: Chinese discovery/search provider.

Search URL tested:

```text
https://cards.sillytavern.one/?q=明日香
```

It returned relevant EVA Asuka cards in server-rendered HTML. Examples:

```text
https://cards.sillytavern.one/card/asuka-langley-soryu-mnppy0ll
https://cards.sillytavern.one/card/飞鸟-兰利-苍龙-2384676c89
https://cards.sillytavern.one/card/asuka-langley-217b2ab61e15
https://cards.sillytavern.one/card/kylaci-asuka-langley-soryu-2384676c89
```

The detail page for:

```text
https://cards.sillytavern.one/card/asuka-langley-217b2ab61e15
```

contains:

- title: `明日香兰利 - SillyTavern角色卡免费下载`
- description: `明日香·兰利是来自《新世纪福音战士》宇宙的一位火热而任性的青少年飞行员...`
- local card id: `1421`
- original source:

```text
https://aicharactercards.com/charactercards/action/vizeadmiral/asuka-langley/
```

Observed public page endpoints:

```text
/card/<slug>
/api/card/<id>/thumb
/api/card/<id>/image
/api/card/<id>/import
```

Important result:

- `/api/card/<id>/image` and `/api/card/<id>/thumb` timed out from the current
  local environment, even through explicit local proxy.
- Browser automation also timed out on initial navigation to the domain.
- Jina Reader could read search/detail pages reliably, but not return the raw
  PNG bytes.

Working fallback for page parsing:

```text
https://r.jina.ai/http://https://cards.sillytavern.one/?q=明日香
https://r.jina.ai/http://https://cards.sillytavern.one/card/asuka-langley-217b2ab61e15
```

Provider conclusion:

```text
cards.sillytavern.one.search(query): useful
cards.sillytavern.one.import(cardUrl): try direct image, then follow original source
```

It should not be treated as a reliable direct download provider until more
network environments are tested.

### aicharactercards.com / AICC

Role: original source provider for some cards discovered through the Chinese
site.

The Asuka card page:

```text
https://aicharactercards.com/charactercards/action/vizeadmiral/asuka-langley/
```

shows a `DOWNLOAD CARD` action. The actual endpoint discovered through the page
and search result is:

```text
https://aicharactercards.com/?download_card_image=true&post_id=9663
```

This endpoint successfully returned a PNG:

```text
content-type: image/png
content-length: 339195
content-disposition: attachment; filename="Asuka-Langley-aicharactercards.com_.png"
```

The downloaded sample is saved at:

```text
/Users/lijianren/Desktop/workspace/koko-chat/docs/research/roleplay-import-sample/aicc-asuka-langley/asuka-langley.png
```

Decoded result:

```text
spec: chara_card_v3
spec_version: 3.0
name: Asuka Langley
text chunk: chara
```

Fields found:

- `description`
- `personality`
- `scenario`
- `first_mes`
- `alternate_greetings` (2 items)
- `tags`
- `creator_notes`
- `creator`

Sample inspector:

```text
/Users/lijianren/Desktop/workspace/koko-chat/docs/research/roleplay-import-sample/aicc-asuka-langley/inspector.html
```

Notes:

- The downloaded Asuka card is a real EVA Asuka card.
- It includes `NSFW` in tags.
- It is a copyrighted fan/IP character card, useful for import validation but
  not suitable as a bundled starter card.

Provider conclusion:

```text
aicc.import(pageUrl):
  parse/download endpoint from page
  or infer ?download_card_image=true&post_id=<id>
  download PNG
  parse SillyTavern chara chunk
```

### character-tavern.com

Role: easiest tested full automatic provider.

Tested page:

```text
https://character-tavern.com/character/hossjolt/asuka
```

This turned out not to be EVA Asuka. It is an original/fantasy character with
the same name. It is still useful as a format test.

Useful properties:

- Page embeds structured JSON under a SvelteKit fetched data script.
- PNG is directly available:

```text
https://cards.character-tavern.com/hossjolt/asuka.png
```

Downloaded PNG:

```text
content-type: application/octet-stream
size: 919349 bytes
```

Decoded result:

```text
spec: chara_card_v2
spec_version: 2.0
name: Asuka
text chunks: chara, ccv3
```

Sample inspector:

```text
/Users/lijianren/Desktop/workspace/koko-chat/docs/research/roleplay-import-sample/character-tavern-asuka/inspector.html
```

Provider conclusion:

```text
characterTavern.import(pageUrl):
  parse /api/character/<author>/<slug> embedded JSON
  resolve image URL https://cards.character-tavern.com/<author>/<slug>.png
  download PNG
  parse SillyTavern chara/ccv3 chunks
```

This provider is currently the best first implementation target for a reliable
end-to-end auto-import proof of concept.

### chub.ai

Role: likely important ecosystem provider, not yet working in this environment.

Tried URL patterns:

```text
https://api.chub.ai/search?search=明日香
https://api.chub.ai/search?search=asuka
https://api.chub.ai/api/characters/search?search=asuka
https://api.chub.ai/api/characters?search=asuka
```

All returned Cloudflare 403 pages in the current environment.

Provider conclusion:

- Do not make Chub the first provider.
- Add later if using official API/token or robust browser automation.
- Keep it behind explicit user action and safety filtering because NSFW/UGC
  exposure is high.

## PNG Format Findings

SillyTavern-compatible PNG cards store card data inside PNG text chunks.

Observed text chunk keys:

- `chara`: base64-encoded JSON
- `ccv3`: present on Character Tavern sample

Observed specs:

- `chara_card_v2`, version `2.0`
- `chara_card_v3`, version `3.0`

Parsing flow:

```text
read PNG bytes
parse PNG chunks
find tEXt chunk key = chara or ccv3
base64 decode value
JSON.parse decoded text
normalize into KokoCharacterCard
```

Important fields to normalize:

```ts
type KokoCharacterCard = {
  id: string;
  name: string;
  description: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  exampleMessages?: string;
  alternateGreetings?: string[];
  tags: string[];
  creator?: string;
  creatorNotes?: string;
  source: {
    provider: string;
    pageUrl?: string;
    downloadUrl?: string;
    originalSourceUrl?: string;
  };
  raw: {
    format: "sillytavern_png";
    spec?: string;
    specVersion?: string;
    data: unknown;
  };
};
```

## Recommended Provider Chain

For Chinese roleplay import, use a chained provider strategy:

```text
Koko App
  user searches keyword on phone

OpenClaw roleplay import worker
  1. cards.sillytavern.one search
     - direct fetch if available
     - Jina Reader fallback for HTML/Markdown parsing

  2. user selects result

  3. cards.sillytavern.one detail resolve
     - extract local card id
     - extract title/description
     - extract original source URL

  4. direct download attempt
     - try /api/card/<id>/image
     - if success, parse PNG

  5. source-specific fallback
     - if original source is aicharactercards.com, use AICC provider
     - if original source is character-tavern.com, use Character Tavern provider
     - if original source is chub.ai, use Chub provider later

  6. parse PNG/JSON

  7. safety scan and preview

  8. user confirms import
```

## Safety / Product Notes

Do not bundle these community cards as default starter content.

Reasons:

- UGC licensing is unclear.
- Many cards are copyrighted fan IP.
- NSFW content is common.
- Some cards may include jailbreak/system override instructions.
- Some may include minors, coercion, or other high-risk content.

Recommended launch approach:

```text
Built-in content:
  original Chinese starter pack created by Koko

Community content:
  user-initiated import only
  show source, tags, warnings, and preview before saving
  require confirmation for NSFW / copyrighted IP / jailbreak-like prompts
```

The Asuka sample should only be used as an import validation fixture, not as
bundled product content.

## Implementation Sketch

Provider interface:

```ts
type CharacterProvider = {
  id: string;
  search?: (query: string) => Promise<CharacterSearchResult[]>;
  resolve: (url: string) => Promise<CharacterImportCandidate>;
  download: (candidate: CharacterImportCandidate) => Promise<CharacterCardFile>;
};
```

Core types:

```ts
type CharacterSearchResult = {
  provider: string;
  title: string;
  url: string;
  description?: string;
  thumbnailUrl?: string;
  tags?: string[];
  originalSourceUrl?: string;
  warnings?: ImportWarning[];
};

type CharacterImportCandidate = {
  provider: string;
  pageUrl: string;
  title?: string;
  cardId?: string;
  downloadUrl?: string;
  originalSourceUrl?: string;
  metadata: Record<string, unknown>;
};

type CharacterCardFile = {
  source: CharacterImportCandidate;
  format: "png" | "json";
  bytes?: Uint8Array;
  json?: unknown;
};
```

Worker capability shape:

```ts
roleplay.searchCharacters({
  query: "明日香",
  sources: ["cards.sillytavern.one", "character-tavern", "aicc"],
  language: "zh",
  safeMode: true
});

roleplay.importCharacter({
  url: "https://cards.sillytavern.one/card/asuka-langley-217b2ab61e15"
});
```

## Current Fixtures

Validated AICC/EVA Asuka sample:

```text
/Users/lijianren/Desktop/workspace/koko-chat/docs/research/roleplay-import-sample/aicc-asuka-langley/
```

Files:

```text
asuka-langley.png
decoded-card.json
summary.json
inspector.html
inspector-screenshot.png
png-chunks.json
```

Validated Character Tavern format sample:

```text
/Users/lijianren/Desktop/workspace/koko-chat/docs/research/roleplay-import-sample/character-tavern-asuka/
```

Files:

```text
asuka.png
embedded-api-character.json
decoded-card.json
summary.json
inspector.html
inspector-screenshot.png
png-chunks.json
```

## Open Questions

- Can `cards.sillytavern.one/api/card/<id>/image` download reliably from other
  user networks, or is it broadly unstable?
- Is there a public stable API for `cards.sillytavern.one` search/detail that
  returns JSON instead of HTML?
- How many Chinese-site cards have usable original source URLs?
- Which original source providers are most common in the Chinese index?
- Should Koko cache only imported cards locally, or also cache search metadata?
- What is the exact safety policy for imported NSFW/community cards in a Bilibili
  launch context?

