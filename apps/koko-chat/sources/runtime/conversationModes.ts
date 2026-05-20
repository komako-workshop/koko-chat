import type { ImageSourcePropType } from "react-native";

export interface ConversationModeMessageBoundaryConfig {
  sticker?: {
    blockType: string;
    preview?: string;
    dataForId?: (id: string) => unknown | null;
  };
}

export interface ConversationModeOpenClawConfig {
  /** Defaults to the conversation mode id unless overridden. */
  defaultAgentId?: string;
  /** Skills expected to be visible to this mode's OpenClaw agent. */
  requiredSkills?: string[];
  /** Core OpenClaw tools this mode's agent is expected to use. */
  requiredCoreTools?: string[];
  /** Local skill folders shipped with this mode's mini-app package. */
  localSkillDirs?: string[];
}

export type ConversationModeSurface =
  | { kind: "standard-chat" }
  | { kind: "route"; pathname: string };

export interface ConversationModeDescriptor {
  /** Stable conversation mode id. This is `ConversationMeta.mode`. */
  id: string;
  /** The product mini-app that owns this mode, when it has one. */
  ownerMiniAppId?: string;
  /** Human-readable fallback name for developer tools and generic UI. */
  displayName?: string;
  /** Fallback glyph used by host list rows when no avatar is present. */
  listGlyph?: string;
  /** Bundled image used by host list rows when available. */
  listImage?: ImageSourcePropType;
  /** Default title for conversations created without an explicit title. */
  defaultTitle?: (createdAt: number) => string;
  /** Which surface should open for this conversation. Defaults to standard chat. */
  surface?: ConversationModeSurface;
  /** OpenClaw-side requirements and defaults for this conversation mode. */
  openclaw?: ConversationModeOpenClawConfig;
  /**
   * If true, agent replies for this mode are split into multiple chat bubbles
   * by `<msg>...</msg>` tags emitted by the model.
   */
  splitAgentMessages?: boolean;
  /**
   * Optional parsing adapters for modes that use the host message-boundary
   * convention. The host owns the generic parser; the mode owns typed payloads.
   */
  messageBoundaries?: ConversationModeMessageBoundaryConfig;
}

export interface ConversationModeOpenClawRequirements {
  agentId: string;
  requiredSkills: string[];
  requiredCoreTools: string[];
  localSkillDirs: string[];
}

const conversationModes = new Map<string, ConversationModeDescriptor>();
const warnedUnknownModes = new Set<string>();

export function registerConversationMode(descriptor: ConversationModeDescriptor): void {
  const id = normalizeConversationModeId(descriptor.id);
  if (id.length === 0) {
    throw new Error("conversation mode id is empty");
  }
  const existing = conversationModes.get(id);
  if (existing !== undefined && existing !== descriptor) {
    console.warn(`[koko] replacing conversation mode descriptor: ${id}`);
  }
  conversationModes.set(id, { ...descriptor, id });
}

export function getConversationModeDescriptor(
  id: string
): ConversationModeDescriptor | undefined {
  return conversationModes.get(normalizeConversationModeId(id));
}

export function getRegisteredConversationModes(): ConversationModeDescriptor[] {
  return [...conversationModes.values()];
}

export function getConversationModeSurface(id: string): ConversationModeSurface {
  return getConversationModeDescriptor(id)?.surface ?? { kind: "standard-chat" };
}

export function getConversationModeOwnerMiniAppId(id: string): string | undefined {
  return getConversationModeDescriptor(id)?.ownerMiniAppId;
}

export function getConversationModeDefaultTitle(mode: string, createdAt: number): string {
  const descriptor = getConversationModeDescriptor(mode);
  return descriptor?.defaultTitle?.(createdAt) ?? `${descriptor?.displayName ?? "Chat"} ${formatTime(createdAt)}`;
}

export function getConversationModeListGlyph(mode: string): string | undefined {
  return getConversationModeDescriptor(mode)?.listGlyph;
}

export function getConversationModeListImage(mode: string): ImageSourcePropType | undefined {
  return getConversationModeDescriptor(mode)?.listImage;
}

export function resolveConversationModeAgentId(
  mode: string,
  explicitAgentId?: string
): string {
  if (explicitAgentId !== undefined && explicitAgentId.trim().length > 0) {
    return normalizeAgentId(explicitAgentId);
  }
  const id = normalizeConversationModeId(mode);
  const descriptorAgentId = getConversationModeDescriptor(id)?.openclaw?.defaultAgentId;
  if (descriptorAgentId !== undefined && descriptorAgentId.trim().length > 0) {
    return normalizeAgentId(descriptorAgentId);
  }
  return normalizeAgentId(id);
}

export function getConversationModeOpenClawRequirements(
  mode: string
): ConversationModeOpenClawRequirements {
  const descriptor = getConversationModeDescriptor(mode);
  return {
    agentId: resolveConversationModeAgentId(mode),
    requiredSkills: uniqueStrings(descriptor?.openclaw?.requiredSkills),
    requiredCoreTools: uniqueStrings(descriptor?.openclaw?.requiredCoreTools),
    localSkillDirs: uniqueStrings(descriptor?.openclaw?.localSkillDirs)
  };
}

export function warnUnknownConversationMode(mode: string): void {
  if (!__DEV__) return;
  const id = normalizeConversationModeId(mode);
  if (conversationModes.has(id) || warnedUnknownModes.has(id)) return;
  warnedUnknownModes.add(id);
  console.warn(`[koko] conversation references unregistered conversation mode: ${id}`);
}

function normalizeConversationModeId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAgentId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "main";
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (values === undefined) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
