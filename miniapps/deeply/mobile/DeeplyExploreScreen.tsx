import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo
} from "react-native";

import { MarkdownText } from "@/components/MarkdownText";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { useGatewayStore } from "@/state/gateway";
import {
  useConversationStore,
  type ChatMessage,
  type ConversationMeta
} from "@/state/conversations";

import { deeplyAvatarChatBuddy } from "./avatars";
import { BlinkingCursor, DeeplyPulse } from "./DeeplyPulse";
import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  startDeeplyMaterialCourse,
  startDeeplyResearchCourse
} from "./courseSession";
import { DeeplyCourseSheetMount } from "./CourseDetailSheet";
import { DeeplyCustomizeSheetMount } from "./CourseCustomizeSheet";
import { openDeeplyCustomizeSheet } from "./customizeSheetStore";

/**
 * Deeply 知识探索 chat surface。
 *
 * 这是 Deeply mini-app 自己拥有的聊天屏,不复用 host 的共享 chat 页。
 * 它仍然依附 conversation store + outbound builder + gateway 这些共享原语,
 * 只是 UI / 输入区 / 推荐课程按钮等产品形态完全由 mini-app 决定。
 *
 * 视觉哲学(对齐 deeply.plus 原版):
 *  - 暖纸张白底,黑灰文字。
 *  - AI 不戴气泡、不戴头像,纯 markdown 平铺,像在读一篇短信。
 *  - 用户消息是右对齐的深色胶囊气泡,黑底白字。
 *  - 输入栏是浅灰胶囊容器,内嵌「推荐课程」chip + 多行输入 + 圆形发送钮。
 *
 * 行为:
 *  - mount 时找 mode === "deeply" 的单例会话,没有就创建一个。
 *  - 普通发送走 outbound builder 注入持续 reminder。
 *  - 推荐课程按钮 = 发送一句固定的"推荐"意图文本,由 outbound builder
 *    在 gatewayText 里替换成专用推荐 prompt。
 */

const DEEPLY_BG = "#F9F9F7";
const DEEPLY_INK = "#111111";
const DEEPLY_INK_MUTED = "#6B6B66";
const DEEPLY_HAIRLINE = "rgba(17,17,17,0.06)";
const DEEPLY_PANEL = "#F5F5F5";
const DEEPLY_PANEL_BORDER = "rgba(17,17,17,0.07)";
const DEEPLY_RECOMMEND_BG = "rgba(17,17,17,0.06)";
const DEEPLY_RECOMMEND_BG_PRESSED = "rgba(17,17,17,0.12)";

const EMPTY: ChatMessage[] = [];

export function DeeplyExploreScreen({
  headerHeight = 0
}: {
  /**
   * Stack header 高度,由 host route 壳通过 `useHeaderHeight` 拿到。
   * 用于 KeyboardAvoidingView 的 keyboardVerticalOffset —— 不传的话
   * iOS 键盘弹起会把输入框遮住。
   */
  headerHeight?: number;
} = {}): React.ReactElement {
  const conversationId = useSingletonConversation();
  const conversation = useConversationStore((s) =>
    s.list.find((m) => m.id === conversationId) ?? null
  );
  const messages = useConversationStore((s) =>
    conversationId === null ? EMPTY : s.messages[conversationId] ?? EMPTY
  );
  const status = useGatewayStore((s) => s.status);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const isConnected = status === "connected";
  const isRecoveringConnection = status === "connecting" || status === "handshaking";
  const canSend = isConnected && !sending && draft.trim().length > 0;
  // 打开「定制课程」sheet 本身不依赖 sending —— sheet 是独立的 UI 操作,
  // 用户在等回复时也应该能起一个新的 research course。只在没连上 gateway
  // 时禁(sheet 里"开始调研"也跑不动)。
  const canOpenCustomize = isConnected;

  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 16);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Dev auto-trigger:agent 用 osascript 改 URL hash 触发 kickoff 用。
  // 支持:
  //   - `koko_run_research_topic`
  //   - `koko_run_material_url`
  // 等 gateway connected 后自动 start course → 清 query param。
  // 只在 web + 已连接时跑,一次性,刷掉 query 后不会再触发。
  const autoRunFiredRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (autoRunFiredRef.current) return;
    if (!isConnected) return;
    if (conversationId === null) return;
    const params = new URLSearchParams(window.location.search);
    const topic = params.get("koko_run_research_topic");
    const sectionsRaw = params.get("koko_run_research_sections");
    if (topic !== null && topic.length > 0) {
      const sections = Number(sectionsRaw);
      if (!Number.isFinite(sections) || sections <= 0) return;
      autoRunFiredRef.current = true;
      params.delete("koko_run_research_topic");
      params.delete("koko_run_research_sections");
      const qs = params.toString();
      history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}`
      );
      void startDeeplyResearchCourse({
        topic,
        sections,
        sectionPreset: "standard",
        parentConversationId: conversationId
      });
      return;
    }

    const materialUrl = params.get("koko_run_material_url");
    const materialSectionsRaw = params.get("koko_run_material_sections");
    if (materialUrl === null || materialUrl.length === 0) return;
    const sections = Number(materialSectionsRaw);
    if (!Number.isFinite(sections) || sections <= 0) return;
    autoRunFiredRef.current = true;
    params.delete("koko_run_material_url");
    params.delete("koko_run_material_sections");
    const qs = params.toString();
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}`
    );
    void startDeeplyMaterialCourse({
      label: materialUrl,
      sourceKind: "url",
      url: materialUrl,
      sections,
      sectionPreset: "standard",
      parentConversationId: conversationId
    });
  }, [isConnected, conversationId]);

  async function dispatch(text: string): Promise<void> {
    const trimmed = text.trim();
    if (conversationId === null || trimmed.length === 0) return;
    setSending(true);
    try {
      await sendUserMessage(conversationId, trimmed);
    } catch (error) {
      console.error("[deeply] send failed", error);
    } finally {
      setSending(false);
    }
  }

  async function handleSend(): Promise<void> {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    await dispatch(text);
  }

  function handleOpenCustomize(): void {
    if (!canOpenCustomize) return;
    openDeeplyCustomizeSheet(conversationId);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <ConnectionBanner
        isConnected={isConnected}
        isRecoveringConnection={isRecoveringConnection}
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={(info) => renderMessage(info, conversation)}
        ListHeaderComponent={messages.length === 0 ? <EmptyState /> : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.inputDock}>
        {/* 行动 chip 排成一行,横滚预留扩展位(以后可能加"继续上次的课"
            "我有自己的主题"之类的入口)。视觉上跟 course screen 的 chip
            row + inputPanel 形态对齐,焦点完全留给输入框本身。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="定制课程"
            disabled={!canOpenCustomize}
            onPress={handleOpenCustomize}
            style={({ pressed }) => [
              styles.recommendButton,
              !canOpenCustomize && styles.recommendButtonDisabled,
              pressed && canOpenCustomize && styles.recommendButtonPressed
            ]}
          >
            <Text
              style={[styles.recommendText, !canOpenCustomize && styles.recommendTextDisabled]}
              numberOfLines={1}
            >
              定制课程
            </Text>
          </Pressable>
        </ScrollView>

        <View style={styles.inputPanel}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              isConnected
                ? "今天又在好奇些什么呢…"
                : "正在连接 OpenClaw,稍等一下…"
            }
            placeholderTextColor={DEEPLY_INK_MUTED}
            editable={isConnected && !sending}
            multiline
            style={styles.input}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            disabled={!canSend}
            onPress={() => void handleSend()}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.sendButtonText}>↑</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* CourseDetailSheet 由推荐卡点击触发;CourseCustomizeSheet 由
          「定制课程」chip 触发。两者都挂在 explore root 里走 absoluteFill
          overlay 而不是 RN Modal,确保 sheet 始终活在 demo frame 内。
          同一时间最多打开一个,store 是分开的、不会互锁。 */}
      <DeeplyCourseSheetMount />
      <DeeplyCustomizeSheetMount />
    </KeyboardAvoidingView>
  );
}

function useSingletonConversation(): string | null {
  const create = useConversationStore((s) => s.create);
  const existingId = useConversationStore((s) => {
    const found = s.list.find((m) => m.mode === DEEPLY_MINI_APP_ID);
    return found?.id ?? null;
  });

  useEffect(() => {
    if (existingId !== null) return;
    create({
      mode: DEEPLY_MINI_APP_ID,
      title: "Deeply 知识探索",
      sessionScope: "explore",
      listSnapshot: {
        title: "Deeply 知识探索",
        subtitle: "陪你引经据典地聊一聊"
      }
    });
  }, [existingId, create]);

  return existingId;
}

function ConnectionBanner({
  isConnected,
  isRecoveringConnection
}: {
  isConnected: boolean;
  isRecoveringConnection: boolean;
}): React.ReactElement | null {
  if (isConnected) return null;
  if (isRecoveringConnection) {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>正在连接 OpenClaw</Text>
        <Text style={styles.bannerHint}>恢复本地 Gateway 连接,稍等一下就能开聊。</Text>
      </View>
    );
  }
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>未连接 OpenClaw</Text>
      <Text style={styles.bannerHint}>需要在 KokoChat 里完成 OpenClaw 配对,Deeply 才能开口。</Text>
    </View>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <Image source={deeplyAvatarChatBuddy} style={styles.emptyAvatar} resizeMode="cover" />
      <Text style={styles.emptyTitle}>今天,你又在好奇些什么呢?</Text>
      <Text style={styles.emptyHint}>
        我是 Deeply 的知识探索助手。
        把你最近的困惑、想搞懂的话题丢过来,
        我会像博学的朋友那样陪你聊一聊。
      </Text>
    </View>
  );
}

function renderMessage(
  info: ListRenderItemInfo<ChatMessage>,
  conversation: ConversationMeta | null
): React.ReactElement {
  const { item } = info;
  if (item.role === "user") {
    return <UserBubble message={item} />;
  }
  return <AgentBubble message={item} conversation={conversation} />;
}

function UserBubble({ message }: { message: ChatMessage }): React.ReactElement {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    </View>
  );
}

function AgentBubble({
  message,
  conversation
}: {
  message: ChatMessage;
  conversation: ConversationMeta | null;
}): React.ReactElement {
  const hasBlocks = Array.isArray(message.blocks) && message.blocks.length > 0;
  const hasText = message.text.length > 0;

  return (
    <View style={styles.agentRow}>
      {message.error !== undefined ? (
        <Text style={styles.errorText}>⚠️ {message.error}</Text>
      ) : (
        <>
          {hasText ? (
            <MarkdownText
              text={message.text}
              color={DEEPLY_INK}
              trailing={message.streaming === true && !hasBlocks ? <BlinkingCursor /> : undefined}
            />
          ) : null}
          {hasBlocks && conversation !== null ? (
            <View style={hasText ? styles.blocksAfterText : null}>
              {message.blocks!.map((block, index) => (
                <MessageBlockView
                  key={`${block.type}:${block.version}:${index}`}
                  block={block}
                  conversation={conversation}
                />
              ))}
            </View>
          ) : null}
          {!hasText && !hasBlocks && message.streaming === true ? (
            // 等 agent 开口:呼吸 halo,比静态 cursor 更明确地传达
            // "正在思考"。文字一旦出现就走上面的 MarkdownText + BlinkingCursor。
            <DeeplyPulse />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DEEPLY_BG
  },
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: DEEPLY_PANEL,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DEEPLY_PANEL_BORDER
  },
  bannerTitle: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "600"
  },
  bannerHint: {
    marginTop: 2,
    color: DEEPLY_INK_MUTED,
    fontSize: 12,
    lineHeight: 18
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
    flexGrow: 1
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 36,
    paddingHorizontal: 18,
    gap: 14
  },
  emptyAvatar: {
    width: 76,
    height: 76,
    borderRadius: 999,
    backgroundColor: DEEPLY_PANEL
  },
  emptyTitle: {
    color: DEEPLY_INK,
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center"
  },
  emptyHint: {
    color: DEEPLY_INK_MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center"
  },
  agentRow: {
    alignSelf: "stretch",
    marginTop: 18
  },
  blocksAfterText: {
    marginTop: 4
  },
  userRow: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    marginTop: 16
  },
  userBubble: {
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 11,
    borderRadius: 22,
    backgroundColor: DEEPLY_INK,
    flexShrink: 1
  },
  userText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500"
  },
  errorText: {
    color: "#C9460C",
    fontSize: 14,
    lineHeight: 20
  },
  inputDock: {
    borderTopWidth: 0.5,
    borderTopColor: DEEPLY_HAIRLINE,
    backgroundColor: DEEPLY_BG,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8
  },
  chipRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2
  },
  inputPanel: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: DEEPLY_PANEL,
    borderColor: DEEPLY_PANEL_BORDER,
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6
  },
  recommendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: DEEPLY_RECOMMEND_BG
  },
  recommendButtonDisabled: {
    opacity: 0.4
  },
  recommendButtonPressed: {
    backgroundColor: DEEPLY_RECOMMEND_BG_PRESSED
  },
  recommendText: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "600"
  },
  recommendTextDisabled: {
    color: DEEPLY_INK_MUTED
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
    color: DEEPLY_INK,
    fontSize: 16,
    lineHeight: 22
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: DEEPLY_INK,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end"
  },
  sendButtonDisabled: {
    backgroundColor: "rgba(17,17,17,0.18)"
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 18
  }
});
