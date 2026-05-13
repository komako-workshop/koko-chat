import type { ImageSourcePropType } from "react-native";

import type { ConversationMeta } from "@/state/conversations";

const kokoAvatar = require("../../assets/brand/chat-avatar.png") as ImageSourcePropType;

export interface MiniAppDescriptor {
  /** Stable mini-app id. Also used as ConversationMeta.mode. */
  id: string;
  /** Human-readable name shown in launchers and developer tools. */
  displayName: string;
  /** Whether the app should be visible in the conversation-list + menu. */
  showInLauncher?: boolean;
  /** Fallback glyph used by host list rows when no avatar is present. */
  listGlyph?: string;
  /** Bundled image used by host list rows when available. */
  listImage?: ImageSourcePropType;
  /** Default title for conversations created without an explicit title. */
  defaultTitle?: (createdAt: number) => string;
  /** Reuse one conversation for launcher opens instead of creating a new row. */
  singletonSessionScope?: string;
  /** OpenClaw-side requirements and defaults for this mini-app. */
  openclaw?: {
    /** Defaults to the mini-app id unless overridden. */
    defaultAgentId?: string;
    /** Skills expected to be visible to this mini-app's agent. */
    requiredSkills?: string[];
    /** Core OpenClaw tools this mini-app agent is expected to use. */
    requiredCoreTools?: string[];
    /** Local skill folders shipped with this mini-app package / repository. */
    localSkillDirs?: string[];
  };
  /** Optional custom create behavior for the + menu. */
  onCreate?: () => ConversationMeta | Promise<ConversationMeta>;
}

const miniApps = new Map<string, MiniAppDescriptor>();
const warnedUnknownIds = new Set<string>();

registerMiniApp({
  id: "koko",
  displayName: "Koko",
  showInLauncher: false,
  listGlyph: "K",
  listImage: kokoAvatar,
  defaultTitle: () => "Koko",
  singletonSessionScope: "home",
  openclaw: { defaultAgentId: "koko" }
});

export function registerMiniApp(descriptor: MiniAppDescriptor): void {
  const id = normalizeMiniAppId(descriptor.id);
  if (id.length === 0) {
    throw new Error("mini-app id is empty");
  }
  const existing = miniApps.get(id);
  if (existing !== undefined && existing !== descriptor) {
    console.warn(`[koko] replacing mini-app descriptor: ${id}`);
  }
  miniApps.set(id, { ...descriptor, id });
}

export function getMiniAppDescriptor(id: string): MiniAppDescriptor | undefined {
  return miniApps.get(normalizeMiniAppId(id));
}

export function getRegisteredMiniApps(): MiniAppDescriptor[] {
  return [...miniApps.values()];
}

export function getLauncherMiniApps(): MiniAppDescriptor[] {
  return getRegisteredMiniApps().filter((descriptor) => descriptor.showInLauncher !== false);
}

export function getDefaultConversationTitle(mode: string, createdAt: number): string {
  const descriptor = getMiniAppDescriptor(mode);
  return descriptor?.defaultTitle?.(createdAt) ?? `${descriptor?.displayName ?? "Chat"} ${formatTime(createdAt)}`;
}

export function getMiniAppListGlyph(mode: string): string | undefined {
  return getMiniAppDescriptor(mode)?.listGlyph;
}

export function getMiniAppListImage(mode: string): ImageSourcePropType | undefined {
  return getMiniAppDescriptor(mode)?.listImage;
}

export function resolveMiniAppAgentId(miniAppId: string, explicitAgentId?: string): string {
  if (explicitAgentId !== undefined && explicitAgentId.trim().length > 0) {
    return normalizeAgentId(explicitAgentId);
  }
  const id = normalizeMiniAppId(miniAppId);
  const descriptorAgentId = getMiniAppDescriptor(id)?.openclaw?.defaultAgentId;
  if (descriptorAgentId !== undefined && descriptorAgentId.trim().length > 0) {
    return normalizeAgentId(descriptorAgentId);
  }
  return normalizeAgentId(id);
}

export interface MiniAppOpenClawRequirements {
  agentId: string;
  requiredSkills: string[];
  requiredCoreTools: string[];
  localSkillDirs: string[];
}

export function getMiniAppOpenClawRequirements(miniAppId: string): MiniAppOpenClawRequirements {
  const descriptor = getMiniAppDescriptor(miniAppId);
  return {
    agentId: resolveMiniAppAgentId(miniAppId),
    requiredSkills: uniqueStrings(descriptor?.openclaw?.requiredSkills),
    requiredCoreTools: uniqueStrings(descriptor?.openclaw?.requiredCoreTools),
    localSkillDirs: uniqueStrings(descriptor?.openclaw?.localSkillDirs)
  };
}

export function warnUnknownMiniAppId(mode: string): void {
  if (!__DEV__) return;
  if (miniApps.has(mode) || warnedUnknownIds.has(mode)) return;
  warnedUnknownIds.add(mode);
  console.warn(`[koko] conversation references unregistered mini-app id: ${mode}`);
}

function normalizeMiniAppId(value: string): string {
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
