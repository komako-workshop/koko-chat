/**
 * Message-boundary parser for IM-style mini-apps.
 *
 * The convention: an agent that wants to be rendered as multiple chat
 * bubbles per turn emits each bubble inside `<msg>...</msg>` tags. The
 * host parses the streamed text and turns each `<msg>` block into a
 * separate ChatMessage.
 *
 * Why a tag instead of a real OpenClaw tool call:
 *   - Works without changing OpenClaw or the gateway protocol.
 *   - Streams without round-trips: every delta carries the full accumulated
 *     text, the parser re-derives the segments, and the UI updates.
 *   - The model treats each `<msg>` like an outgoing message, which mirrors
 *     how chat assistants in IM platforms are often written.
 *
 * Robustness goals:
 *   - Untagged text degrades gracefully into a single segment so a model
 *     that ignores the convention still produces something usable.
 *   - Trailing whitespace, prose between bubbles, and unclosed tags during
 *     streaming all produce sane output.
 */

export interface MessageSegment {
  /** Zero-based index within this run. Used to derive a stable message id. */
  index: number;
  /** Segment kind. Sticker ids map to the current mini-app's sticker block. */
  kind: "text" | "sticker";
  /** Trimmed text for this bubble. Empty segments are not emitted. */
  text: string;
  /** Sticker id parsed from an exact `[sticker:<id>]` token. */
  stickerId?: string;
  /** Whether this segment is finalized (closed tag or run completed). */
  complete: boolean;
}

const OPEN_TAG = "<msg>";
const CLOSE_TAG = "</msg>";

export function parseMessageBoundaries(
  fullText: string,
  done: boolean
): MessageSegment[] {
  if (typeof fullText !== "string" || fullText.length === 0) {
    return [];
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;
  let sawAnyTag = false;
  let nextIndex = 0;

  const push = (text: string, complete: boolean): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const stickerId = complete ? parseStickerToken(trimmed) : null;
    segments.push({
      index: nextIndex,
      kind: stickerId !== null ? "sticker" : "text",
      text: trimmed,
      ...(stickerId !== null ? { stickerId } : {}),
      complete
    });
    nextIndex += 1;
  };

  while (cursor < fullText.length) {
    const openIdx = fullText.indexOf(OPEN_TAG, cursor);

    if (openIdx === -1) {
      // No more <msg> tags ahead. Whatever remains is either:
      //   (a) trailing prose after the last </msg>, or
      //   (b) the entire text if the model never used the tag.
      // Both render as a single bubble. It's complete iff the run is done.
      push(fullText.slice(cursor), done);
      break;
    }

    sawAnyTag = true;

    // Anything between the previous segment and this <msg> is treated as
    // a complete bubble (tags are usually back-to-back, so this is rare).
    const interstitial = fullText.slice(cursor, openIdx);
    if (interstitial.trim().length > 0) {
      push(interstitial, true);
    }

    const contentStart = openIdx + OPEN_TAG.length;
    const closeIdx = fullText.indexOf(CLOSE_TAG, contentStart);

    if (closeIdx === -1) {
      // The model is mid-bubble. Render the partial content; it stays
      // streaming until the run completes (in which case we accept it as-is).
      push(fullText.slice(contentStart), done);
      break;
    }

    const content = fullText.slice(contentStart, closeIdx);
    push(content, true);
    cursor = closeIdx + CLOSE_TAG.length;
  }

  // Suppress an unused-variable warning while keeping the intent visible
  // for future diagnostics (e.g. logging fallback usage).
  void sawAnyTag;

  return segments;
}

function parseStickerToken(value: string): string | null {
  const match = /^\[sticker:([a-z0-9-]+)\]$/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}
