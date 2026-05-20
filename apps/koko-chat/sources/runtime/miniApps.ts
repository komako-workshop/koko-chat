import type { ImageSourcePropType } from "react-native";

import type { ConversationMeta } from "@/state/conversations";
import {
  getConversationModeDefaultTitle,
  getConversationModeDescriptor,
  getConversationModeListGlyph,
  getConversationModeListImage,
  getConversationModeOpenClawRequirements,
  getConversationModeOwnerMiniAppId,
  registerConversationMode,
  resolveConversationModeAgentId,
  warnUnknownConversationMode,
  type ConversationModeMessageBoundaryConfig,
  type ConversationModeOpenClawConfig
} from "@/runtime/conversationModes";

export type MiniAppMessageBoundaryConfig = ConversationModeMessageBoundaryConfig;

export type MiniAppLaunchTarget =
  | { kind: "route"; pathname: string }
  | { kind: "conversation"; mode?: string }
  | { kind: "action"; run: () => void | Promise<void> };

export interface MiniAppDescriptor {
  /** Stable mini-app id. Product namespace, not necessarily a conversation mode. */
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
  /**
   * Launcher behavior. If omitted, the app launches a conversation whose mode
   * matches the mini-app id. Route launches let a mini-app own its first screen.
   */
  launch?: MiniAppLaunchTarget;
  /** OpenClaw-side requirements and defaults for the default conversation mode. */
  openclaw?: ConversationModeOpenClawConfig;
  /** Optional custom create behavior for the + menu. */
  onCreate?: () => ConversationMeta | Promise<ConversationMeta>;
  /**
   * If true, agent replies for this mini-app are split into multiple chat
   * bubbles by `<msg>...</msg>` tags emitted by the model. Untagged text
   * falls back to a single bubble. See runtime/messageBoundary.ts.
   *
   * Defaults to false (single-bubble, ChatGPT-style).
   */
  splitAgentMessages?: boolean;
  /**
   * Optional parsing adapters for mini-apps that use the host message-boundary
   * convention. The host owns the generic `<msg>` parser; each mini-app owns
   * how parsed tokens become typed blocks.
   */
  messageBoundaries?: MiniAppMessageBoundaryConfig;
}

const miniApps = new Map<string, MiniAppDescriptor>();

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
  registerDefaultConversationMode({ ...descriptor, id });
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
  return getConversationModeDefaultTitle(mode, createdAt);
}

export function getMiniAppListGlyph(mode: string): string | undefined {
  return getConversationModeListGlyph(mode) ?? getOwnerMiniAppDescriptor(mode)?.listGlyph;
}

export function getMiniAppListImage(mode: string): ImageSourcePropType | undefined {
  return getConversationModeListImage(mode) ?? getOwnerMiniAppDescriptor(mode)?.listImage;
}

export function resolveMiniAppAgentId(miniAppId: string, explicitAgentId?: string): string {
  return resolveConversationModeAgentId(miniAppId, explicitAgentId);
}

export interface MiniAppOpenClawRequirements {
  agentId: string;
  requiredSkills: string[];
  requiredCoreTools: string[];
  localSkillDirs: string[];
}

export function getMiniAppOpenClawRequirements(miniAppId: string): MiniAppOpenClawRequirements {
  return getConversationModeOpenClawRequirements(miniAppId);
}

export function warnUnknownMiniAppId(mode: string): void {
  warnUnknownConversationMode(mode);
}

function normalizeMiniAppId(value: string): string {
  return value.trim().toLowerCase();
}

function getOwnerMiniAppDescriptor(mode: string): MiniAppDescriptor | undefined {
  const ownerId = getConversationModeOwnerMiniAppId(mode);
  return ownerId === undefined ? undefined : getMiniAppDescriptor(ownerId);
}

function registerDefaultConversationMode(descriptor: MiniAppDescriptor): void {
  if (getConversationModeDescriptor(descriptor.id) !== undefined) return;
  registerConversationMode({
    id: descriptor.id,
    ownerMiniAppId: descriptor.id,
    displayName: descriptor.displayName,
    ...(descriptor.listGlyph !== undefined ? { listGlyph: descriptor.listGlyph } : {}),
    ...(descriptor.listImage !== undefined ? { listImage: descriptor.listImage } : {}),
    ...(descriptor.defaultTitle !== undefined ? { defaultTitle: descriptor.defaultTitle } : {}),
    surface: { kind: "standard-chat" },
    ...(descriptor.openclaw !== undefined ? { openclaw: descriptor.openclaw } : {}),
    ...(descriptor.splitAgentMessages !== undefined
      ? { splitAgentMessages: descriptor.splitAgentMessages }
      : {}),
    ...(descriptor.messageBoundaries !== undefined
      ? { messageBoundaries: descriptor.messageBoundaries }
      : {})
  });
}
