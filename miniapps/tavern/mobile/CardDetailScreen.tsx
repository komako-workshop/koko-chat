/**
 * Tavern Card detail screen: shown when the user taps a card in the
 * browse grid. Renders the bundled-in description and a preview of the
 * Chinese first_mes so the user can decide whether to start a chat
 * *before* a conversation is created.
 *
 * Data source: a single card object passed in via route params (encoded
 * as the URL-encoded `path`). We look it up from `browse-data.json`
 * synchronously — no network calls at all.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { openTavernSettings } from "@/runtime/navigation";
import {
  resolvePersonaName,
  useTavernPersonaStore
} from "@/state/tavernPersona";
import { KokoColors, KokoRadius } from "@/theme/koko";

import { startTavernRoleplaySession } from "../roleplay/mobile";
import browseData from "./assets/browse-data.json";
import { applyTavernMacros } from "./macros";

interface BrowseCard {
  path: string;
  pageUrl: string;
  imageUrl: string;
  name: string;
  inChatName: string;
  tagline: string;
  tags: string[];
  isNSFW: boolean;
  likes: number;
  downloads: number;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  nameZh?: string;
  taglineZh?: string;
  tagsZh?: string[];
  descriptionZh?: string;
  firstMessageZh?: string;
}

interface BrowseData {
  categories: Array<{ id: string; labelZh: string; cards: BrowseCard[] }>;
}

const DATA = browseData as BrowseData;

function findCard(path: string): BrowseCard | null {
  for (const cat of DATA.categories) {
    for (const card of cat.cards) {
      if (card.path === path) return card;
    }
  }
  return null;
}

export function TavernCardDetailScreen({ path }: { path: string }): React.ReactElement {
  const card = useMemo(() => findCard(path), [path]);
  const [busy, setBusy] = useState(false);

  if (card === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.notFoundTitle}>找不到这张卡片</Text>
        <Text style={styles.notFoundHint}>回到广场再试一次。</Text>
      </View>
    );
  }

  const displayName =
    (card.nameZh && card.nameZh.length > 0 && card.nameZh) ||
    (card.inChatName.length > 0 && card.inChatName) ||
    card.name;
  const englishName = card.inChatName.length > 0 ? card.inChatName : card.name;
  const showEnglish = displayName !== englishName;
  const tagline =
    (card.taglineZh && card.taglineZh.length > 0 && card.taglineZh) || card.tagline;
  const tags = card.tagsZh && card.tagsZh.length > 0 ? card.tagsZh : card.tags;

  // Subscribe to the persona name so the preview re-renders when the user
  // edits it in /tavern/settings without leaving this card detail page.
  const personaName = useTavernPersonaStore((s) => s.name);
  const personaSetName = useTavernPersonaStore((s) => s.setName);
  const hasPersonaName = personaName.trim().length > 0;
  // For UI previews we want a friendly fallback ("你" if persona is unset);
  // for the agent prompt we'd rather use "用户" so the model handles it as
  // a definite noun. The resolver knows the difference.
  const macroCtx = useMemo(
    () => ({ user: resolvePersonaName(false), char: displayName }),
    [personaName, displayName]
  );

  const description = useMemo(() => {
    const raw = (card.descriptionZh && card.descriptionZh.length > 0
      ? card.descriptionZh
      : card.description) ?? "";
    return applyTavernMacros(raw, macroCtx);
  }, [card.description, card.descriptionZh, macroCtx]);
  const firstMessagePreview = useMemo(() => {
    const raw = (card.firstMessageZh && card.firstMessageZh.length > 0
      ? card.firstMessageZh
      : card.firstMessage) ?? "";
    return applyTavernMacros(raw, macroCtx);
  }, [card.firstMessage, card.firstMessageZh, macroCtx]);

  // First-time prompt: if the user hasn't named their persona yet, we
  // surface a small modal before creating the conversation. They can
  // either name themselves on the spot or skip (defaults to "你").
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const launchSession = useCallback(() => {
    // Snapshot the persona at session-start time. The roleplay screen
    // doesn't re-apply macros once the conversation is live, so a later
    // rename only affects future sessions — matches SillyTavern behaviour.
    const ctx = { user: resolvePersonaName(false), char: displayName };
    const promptCtx = { user: resolvePersonaName(true), char: displayName };
    startTavernRoleplaySession({
      path: card!.path,
      pageUrl: card!.pageUrl,
      imageUrl: card!.imageUrl,
      name: card!.name,
      nameZh: displayName,
      tagline: card!.tagline,
      taglineZh: tagline,
      prefetched: {
        description: applyTavernMacros(card!.description ?? "", promptCtx),
        personality: applyTavernMacros(card!.personality ?? "", promptCtx),
        scenario: applyTavernMacros(card!.scenario ?? "", promptCtx),
        firstMessage: applyTavernMacros(card!.firstMessage ?? "", promptCtx),
        firstMessageZh: applyTavernMacros(firstMessagePreview, ctx)
      }
    });
  }, [card, displayName, firstMessagePreview, tagline]);

  function handleStart(): void {
    if (busy) return;
    if (!hasPersonaName) {
      setDraftName("");
      setNamePromptOpen(true);
      return;
    }
    setBusy(true);
    try {
      launchSession();
    } catch (error) {
      Alert.alert("无法打开角色", error instanceof Error ? error.message : String(error));
    } finally {
      setTimeout(() => setBusy(false), 0);
    }
  }

  function handleNamePromptConfirm(skip: boolean): void {
    Keyboard.dismiss();
    const trimmed = draftName.trim();
    if (!skip && trimmed.length === 0) {
      // Empty + confirm = treat as skip.
      setNamePromptOpen(false);
      return;
    }
    if (!skip) personaSetName(trimmed);
    setNamePromptOpen(false);
    setBusy(true);
    try {
      launchSession();
    } catch (error) {
      Alert.alert("无法打开角色", error instanceof Error ? error.message : String(error));
    } finally {
      setTimeout(() => setBusy(false), 0);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.coverWrap}>
          <CachedImage
            source={{ uri: card.imageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        </View>

        <View style={styles.header}>
          <Text style={styles.name}>{displayName}</Text>
          {showEnglish ? <Text style={styles.nameEn}>{englishName}</Text> : null}
          {tagline.length > 0 ? <Text style={styles.tagline}>{tagline}</Text> : null}

          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.map((tag, idx) => (
                <View key={`${tag}:${idx}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.statsRow}>
            <Text style={styles.statsText}>
              ⬇ {card.downloads.toLocaleString()}   ❤ {card.likes.toLocaleString()}
            </Text>
          </View>
        </View>

        {description.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>角色简介</Text>
            <Text style={styles.body}>{description}</Text>
          </View>
        ) : null}

        {firstMessagePreview.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TA 会怎么和你打招呼</Text>
            <View style={styles.firstMessageBox}>
              <Text style={styles.body}>{firstMessagePreview}</Text>
            </View>
            <Text style={styles.firstMessageHint}>
              开始聊天后，TA 会以这段话作为开场白。
            </Text>
          </View>
        ) : null}

        {/* spacer so the sticky CTA never covers content */}
        <View style={{ height: 84 }} />
      </ScrollView>

      <View style={styles.ctaDock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="开始聊天"
          onPress={handleStart}
          disabled={busy}
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
            busy && styles.ctaButtonBusy
          ]}
        >
          <Text style={styles.ctaButtonText}>开始聊天</Text>
        </Pressable>
      </View>

      <Modal
        visible={namePromptOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setNamePromptOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setNamePromptOpen(false)}
            accessibilityLabel="关闭"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>给自己起个名字吧</Text>
            <Text style={styles.modalHint}>
              角色会用这个名字称呼你。也可以跳过，默认叫「你」。
            </Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="例如：阿仁"
              placeholderTextColor={KokoColors.inkPlaceholder}
              maxLength={32}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => handleNamePromptConfirm(false)}
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleNamePromptConfirm(true)}
                style={({ pressed }) => [
                  styles.modalSecondary,
                  pressed && styles.modalSecondaryPressed
                ]}
              >
                <Text style={styles.modalSecondaryText}>跳过</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleNamePromptConfirm(false)}
                disabled={draftName.trim().length === 0}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  draftName.trim().length === 0 && styles.modalPrimaryDisabled,
                  pressed && draftName.trim().length > 0 && styles.modalPrimaryPressed
                ]}
              >
                <Text style={styles.modalPrimaryText}>开始聊天</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNamePromptOpen(false);
                openTavernSettings();
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.modalLink, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.modalLinkText}>去设置页详细配置 →</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32
  },
  notFoundTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: KokoColors.ink,
    marginBottom: 4
  },
  notFoundHint: {
    fontSize: 14,
    color: KokoColors.inkSecondary
  },
  scrollContent: {
    paddingBottom: 24
  },
  coverWrap: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: KokoColors.surfaceSoft
  },
  cover: {
    width: "100%",
    height: "100%"
  },
  header: {
    padding: 20,
    gap: 8
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: KokoColors.ink
  },
  nameEn: {
    fontSize: 13,
    color: KokoColors.inkMuted,
    marginTop: -4
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: KokoColors.inkSecondary,
    marginTop: 4
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primaryWash
  },
  tagChipText: {
    fontSize: 12,
    color: KokoColors.primaryDeep,
    fontWeight: "500"
  },
  statsRow: {
    marginTop: 8
  },
  statsText: {
    fontSize: 12,
    color: KokoColors.inkMuted
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 8
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.inkSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: KokoColors.ink
  },
  firstMessageBox: {
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    padding: 16
  },
  firstMessageHint: {
    fontSize: 12,
    color: KokoColors.inkMuted,
    paddingHorizontal: 4
  },
  ctaDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: KokoColors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: KokoColors.border
  },
  ctaButton: {
    height: 50,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  ctaButtonPressed: {
    backgroundColor: KokoColors.primaryDeep
  },
  ctaButtonBusy: {
    opacity: 0.6
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 1
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 24
  },
  modalCard: {
    backgroundColor: KokoColors.bg,
    borderRadius: KokoRadius.xl,
    padding: 20,
    gap: 12
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: KokoColors.ink
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 20,
    color: KokoColors.inkSecondary
  },
  modalInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: KokoRadius.lg,
    backgroundColor: KokoColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    fontSize: 16,
    color: KokoColors.ink
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4
  },
  modalSecondary: {
    flex: 1,
    height: 44,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.surfaceSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  modalSecondaryPressed: {
    opacity: 0.7
  },
  modalSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: KokoColors.inkSecondary
  },
  modalPrimary: {
    flex: 1,
    height: 44,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  modalPrimaryDisabled: {
    backgroundColor: KokoColors.primaryWash
  },
  modalPrimaryPressed: {
    backgroundColor: KokoColors.primaryDeep
  },
  modalPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  modalLink: {
    alignSelf: "center",
    paddingVertical: 6
  },
  modalLinkText: {
    fontSize: 12,
    color: KokoColors.primaryDeep
  }
});
