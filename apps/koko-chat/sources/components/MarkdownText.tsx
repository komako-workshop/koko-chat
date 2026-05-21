/**
 * Tiny Markdown renderer for chat bubbles.
 *
 * Deliberately minimal: covers what LLMs typically emit inside a single
 * agent reply — paragraphs, headings, ordered/unordered lists, bold,
 * italic, inline code, and inline links. Block-level code fences, tables,
 * images, and HTML are not supported; they would push us into a real
 * Markdown library, which is overkill for the v1 chat UI.
 *
 * Streaming-friendly: a half-written `**` or `` ` `` is rendered as
 * literal text rather than swallowed, so partial deltas read sensibly
 * while the model is still typing.
 */

import { Linking, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { KokoColors } from "@/theme/koko";

interface MarkdownTextProps {
  text: string;
  /** Color applied to default body text. Defaults to KokoColors.ink. */
  color?: string;
  /** Optional trailing element appended to the last text node (e.g. streaming cursor). */
  trailing?: React.ReactNode;
  /**
   * Multiply default body / heading / list font sizes by this value.
   * Useful for "long-form reader" surfaces (e.g. Deeply course screen)
   * where users want a bigger, calmer reading experience. Defaults to 1.
   * Inline code keeps its monospace size since it's rarely the focal element.
   */
  scale?: number;
}

export function MarkdownText({
  text,
  color,
  trailing,
  scale = 1
}: MarkdownTextProps): React.ReactElement | null {
  if (text.length === 0 && trailing === undefined) return null;
  const baseColor = color ?? KokoColors.ink;
  const blocks = parseBlocks(text);
  const bodyScaled = scaledBodyStyle(scale);

  if (blocks.length === 0) {
    return (
      <Text style={[styles.body, bodyScaled, { color: baseColor }]}>
        {trailing}
      </Text>
    );
  }

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const blockTrailing = isLast ? trailing : undefined;
        return (
          <BlockView
            key={index}
            block={block}
            color={baseColor}
            trailing={blockTrailing}
            isFirst={index === 0}
            isLast={isLast}
            scale={scale}
          />
        );
      })}
    </View>
  );
}

function scaledBodyStyle(scale: number): TextStyle {
  if (scale === 1) return {};
  return {
    fontSize: 16 * scale,
    lineHeight: 26 * scale
  };
}

function scaledHeadingStyle(level: 1 | 2 | 3, scale: number): TextStyle {
  if (scale === 1) return {};
  const base = level === 1 ? 19 : level === 2 ? 17 : 16;
  return { fontSize: base * scale, lineHeight: base * 1.4 * scale };
}

// ---- Block model -----------------------------------------------------------

type Block =
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "bullet"; items: string[] }
  | { type: "numbered"; items: NumberedListItem[] };

interface NumberedListItem {
  marker: string;
  text: string;
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_RE = /^\s*(\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  // Normalize line endings; collapse 3+ blank lines to 2 so paragraph splits stay sane.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const hashes = heading[1] ?? "";
      const content = heading[2] ?? "";
      const level = Math.min(hashes.length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, content });
      i += 1;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = BULLET_RE.exec(lines[i] ?? "");
        if (m === null) break;
        items.push(m[1] ?? "");
        i += 1;
      }
      blocks.push({ type: "bullet", items });
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      const items: NumberedListItem[] = [];
      while (i < lines.length) {
        const m = NUMBERED_RE.exec(lines[i] ?? "");
        if (m === null) break;
        items.push({
          marker: m[1] ?? `${items.length + 1}.`,
          text: m[2] ?? ""
        });
        i += 1;
      }
      blocks.push({ type: "numbered", items });
      continue;
    }

    // Paragraph: consume until blank line or list/heading start.
    const paragraphLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim().length === 0) break;
      if (HEADING_RE.test(next) || BULLET_RE.test(next) || NUMBERED_RE.test(next)) break;
      paragraphLines.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join("\n") });
  }

  return blocks;
}

// ---- Block rendering -------------------------------------------------------

interface BlockViewProps {
  block: Block;
  color: string;
  trailing?: React.ReactNode;
  isFirst: boolean;
  isLast: boolean;
  scale: number;
}

function BlockView({ block, color, trailing, isFirst, isLast, scale }: BlockViewProps): React.ReactElement {
  // Spacing between paragraphs. Set generously because the chat surface
  // also renders long-form roleplay first_mes blocks where 5+ paragraphs
  // run back to back; tighter spacing leaves the text feeling like one
  // dense slab with no place for the eye to rest.
  const topGap = isFirst ? 0 : 14;
  const bodyScaled = scaledBodyStyle(scale);

  if (block.type === "paragraph") {
    return (
      <Text style={[styles.body, bodyScaled, { color, marginTop: topGap }]}>
        {renderInline(block.content, color)}
        {trailing}
      </Text>
    );
  }

  if (block.type === "heading") {
    const headingStyle =
      block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3;
    const headingScaled = scaledHeadingStyle(block.level, scale);
    return (
      <Text
        style={[
          styles.body,
          headingStyle,
          headingScaled,
          { color, marginTop: isFirst ? 0 : 8 }
        ]}
      >
        {renderInline(block.content, color)}
        {trailing}
      </Text>
    );
  }

  const items: Array<{ marker: string; text: string }> =
    block.type === "bullet"
      ? block.items.map((text) => ({ marker: "•", text }))
      : block.items;
  const itemCount = items.length;
  return (
    <View style={[styles.list, { marginTop: topGap }]}>
      {items.map((item, idx) => {
        const lastInList = idx === itemCount - 1;
        return (
          <Text
            key={idx}
            style={[styles.body, bodyScaled, styles.listLine, { color }]}
          >
            <Text style={styles.listMarker}>{item.marker} </Text>
            {renderInline(item.text, color)}
            {isLast && lastInList ? trailing : null}
          </Text>
        );
      })}
    </View>
  );
}

// ---- Inline parsing --------------------------------------------------------

type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

function renderInline(text: string, color: string): React.ReactNode {
  const nodes = parseInline(text);
  return nodes.map((node, i) => renderInlineNode(node, color, i));
}

function renderInlineNode(node: Inline, color: string, key: number): React.ReactNode {
  if (node.type === "text") return node.text;
  if (node.type === "bold") {
    return (
      <Text key={key} style={styles.bold}>
        {node.children.map((c, ci) => renderInlineNode(c, color, ci))}
      </Text>
    );
  }
  if (node.type === "italic") {
    return (
      <Text key={key} style={styles.italic}>
        {node.children.map((c, ci) => renderInlineNode(c, color, ci))}
      </Text>
    );
  }
  if (node.type === "code") {
    return (
      <Text key={key} style={styles.inlineCode}>
        {node.text}
      </Text>
    );
  }
  // link
  return (
    <Text
      key={key}
      style={styles.link}
      onPress={() => {
        void Linking.openURL(node.href).catch(() => undefined);
      }}
    >
      {node.text}
    </Text>
  );
}

// Minimal recursive-descent inline parser. Order matters: code first (it
// suppresses other formatting inside it), then bold, then italic, then links.
function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buffer = "";

  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    out.push({ type: "text", text: buffer });
    buffer = "";
  };

  while (i < input.length) {
    const rest = input.slice(i);

    // Inline code: `xxx`
    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 0) {
        flushBuffer();
        out.push({ type: "code", text: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }

    // Bold: **xxx**
    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end > 2) {
        flushBuffer();
        out.push({ type: "bold", children: parseInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Italic: *xxx* (single asterisk, but only if not the start of an
    // un-closed bold marker, and the run is non-empty)
    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const end = findMatchingSingleAsterisk(rest);
      if (end > 1) {
        flushBuffer();
        out.push({ type: "italic", children: parseInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    // Inline link: [text](https://...)
    if (rest.startsWith("[")) {
      const linkMatch = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
      if (linkMatch !== null) {
        flushBuffer();
        out.push({
          type: "link",
          text: linkMatch[1] ?? "",
          href: linkMatch[2] ?? ""
        });
        i += linkMatch[0].length;
        continue;
      }
    }

    buffer += input[i] ?? "";
    i += 1;
  }

  flushBuffer();
  return out;
}

function findMatchingSingleAsterisk(s: string): number {
  // Find an asterisk that isn't part of `**` and isn't at position 0.
  for (let j = 1; j < s.length; j += 1) {
    if (s[j] === "*" && s[j + 1] !== "*" && s[j - 1] !== "*") return j;
  }
  return -1;
}

// ---- Styles ----------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    // No outer gap; per-block marginTop handles spacing so a single-paragraph
    // bubble keeps its compact look.
  },
  body: {
    fontSize: 16,
    // 26 instead of 24 — the extra 2px breathing room is the difference
    // between "comfortable" and "wall of text" once a paragraph runs
    // past 4-5 lines in Chinese.
    lineHeight: 26
  },
  bold: {
    fontWeight: "700"
  },
  italic: {
    fontStyle: "italic",
    // SillyTavern roleplay convention: `*...*` wraps scene description /
    // action beats (the prose connective tissue around dialogue). True
    // italic typography is invisible in most Chinese fonts, so we lean
    // on a softer color instead — action lines step back, the actual
    // dialogue lines stay at full ink color and read forward.
    color: KokoColors.inkSecondary
  },
  inlineCode: {
    fontFamily: "Menlo",
    fontSize: 14
  },
  link: {
    color: KokoColors.primaryDeep,
    textDecorationLine: "underline"
  },
  heading1: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "700"
  },
  heading2: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700"
  },
  heading3: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600"
  },
  list: {
    // Outer list block; rows handle their own spacing.
  },
  listLine: {
    marginTop: 2
  },
  listMarker: {
    color: KokoColors.inkSecondary,
    fontWeight: "600"
  }
});
