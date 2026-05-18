/**
 * Tavern settings screen.
 *
 * v1 surfaces a single field — the user's persona name. Whatever is set
 * here is substituted for `{{user}}` everywhere a roleplay card's text
 * appears (detail page, first_mes seed, agent bootstrap prompt).
 *
 * The screen is reachable from the Tavern browse page's header gear and
 * is also pushed automatically when a user taps "开始聊天" on a card
 * before setting any name (see CardDetailScreen).
 *
 * Layout intentionally matches the rest of the host's settings surfaces
 * (KokoColors, KokoRadius, no third-party form libs).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { useTavernPersonaStore } from "@/state/tavernPersona";
import { KokoColors, KokoRadius } from "@/theme/koko";

const MAX_NAME_LENGTH = 32;

export function TavernSettingsScreen(): React.ReactElement {
  const storedName = useTavernPersonaStore((s) => s.name);
  const hydrated = useTavernPersonaStore((s) => s.hydrated);
  const setName = useTavernPersonaStore((s) => s.setName);

  const [draft, setDraft] = useState(storedName);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sync the local draft when the underlying store hydrates (the screen
  // can mount before `rehydrate()` has finished on a cold start) or
  // when the store updates from elsewhere (e.g. the first-time prompt
  // in CardDetailScreen).
  useEffect(() => {
    if (!hydrated) return;
    setDraft(storedName);
  }, [hydrated, storedName]);

  const dirty = draft.trim() !== storedName.trim();

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    setName(draft);
    setSavedAt(Date.now());
  }, [draft, setName]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>身份</Text>
        <Text style={styles.sectionHint}>
          角色会怎么称呼你？这一项会替换角色卡中所有的 {"{{user}}"} 占位符。留空的话，角色默认称呼你为「你」。
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="例如：阿仁"
          placeholderTextColor={KokoColors.inkPlaceholder}
          maxLength={MAX_NAME_LENGTH}
          autoFocus={storedName.length === 0}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          style={styles.input}
        />

        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          disabled={!dirty}
          style={({ pressed }) => [
            styles.saveButton,
            !dirty && styles.saveButtonDisabled,
            pressed && dirty && styles.saveButtonPressed
          ]}
        >
          <Text style={[styles.saveButtonText, !dirty && styles.saveButtonTextDisabled]}>
            {dirty ? "保存" : savedAt !== null ? "已保存" : "已是当前设置"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.tipsSection}>
        <Text style={styles.tipsTitle}>提示</Text>
        <Text style={styles.tipsBody}>
          这个名字对所有酒馆里的角色都生效，不影响 Koko 助手或其他聊天。{"\n"}
          你随时可以回到这一页修改。
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg,
    padding: 20,
    gap: 24
  },
  section: {
    gap: 12
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.inkSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 20,
    color: KokoColors.inkSecondary
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: KokoRadius.lg,
    backgroundColor: KokoColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    fontSize: 16,
    color: KokoColors.ink
  },
  saveButton: {
    height: 48,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  saveButtonPressed: {
    backgroundColor: KokoColors.primaryDeep
  },
  saveButtonDisabled: {
    backgroundColor: KokoColors.surfaceSoft
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
    letterSpacing: 0.5
  },
  saveButtonTextDisabled: {
    color: KokoColors.inkMuted
  },
  tipsSection: {
    paddingHorizontal: 4,
    gap: 6
  },
  tipsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.inkSecondary
  },
  tipsBody: {
    fontSize: 13,
    lineHeight: 20,
    color: KokoColors.inkMuted
  }
});
