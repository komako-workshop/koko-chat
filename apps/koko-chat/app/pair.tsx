import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Link, router } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { parseSetupCode } from "@/gateway/setupCode";
import { useGatewayStore } from "@/state/gateway";
import { KokoColors, KokoRadius } from "@/theme/koko";

/**
 * Pairing flow (Claw-mediated, text-only).
 *
 * KokoChat assumes every user already has a working OpenClaw they can chat with
 * (Web UI, Desktop, another paired phone, etc.). To add a new device, we don't
 * make them open a terminal — we give them a ready-made prompt to send to their
 * existing Claw. The `kokochat-pairing` workspace skill makes Claw run
 * `openclaw qr --setup-code-only` and return the raw setup code as plain text.
 * The user copies that string back into the paste box below.
 *
 * We deliberately do not use QR codes (ASCII or image). Plain text keeps the
 * path robust across every Claw frontend (terminal, Web UI, mobile) without
 * needing to solve QR rendering / scanning in each.
 */

const PAIRING_PROMPT = "请帮我生成一个新的 KokoChat 配对码。";

async function readClipboardText(): Promise<string | null> {
  try {
    const text = await Clipboard.getStringAsync();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(value);
    return true;
  } catch {
    return false;
  }
}

export default function PairScreen() {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = useGatewayStore((s) => s.status);
  const connect = useGatewayStore((s) => s.connect);
  const lastError = useGatewayStore((s) => s.lastError);
  const headerHeight = useHeaderHeight();

  async function connectWith(raw: string): Promise<void> {
    setLocalError(null);
    if (busy) return;
    try {
      const setup = parseSetupCode(raw);
      setBusy(true);
      await connect(setup);
      router.replace("/");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyPrompt(): Promise<void> {
    const ok = await writeClipboardText(PAIRING_PROMPT);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      Alert.alert("复制失败", "请长按上面的话术手动复制。");
    }
  }

  async function handlePaste(): Promise<void> {
    const text = await readClipboardText();
    if (text !== null) {
      setInput(text.trim());
      setLocalError(null);
    } else {
      setLocalError("剪贴板为空或无法访问。请手动粘贴。");
    }
  }

  const connectDisabled = busy || input.trim().length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.intro}>
          KokoChat 是 OpenClaw 的手机版伴侣 App。聊天和 AI 能力来自你 Mac 上运行的
          OpenClaw（claw.ai），所以第一步需要把这台手机绑定到你已有的 OpenClaw。
        </Text>

        <View style={[styles.card, styles.preFlightCard]}>
          <Text style={styles.preFlightTitle}>开始之前</Text>
          <Text style={styles.preFlightItem}>
            · Mac 上已经装好 OpenClaw，并能正常和它聊天。
          </Text>
          <Text style={styles.preFlightItem}>
            · 手机和 Mac 在同一 Wi-Fi 下；首次连接时 iOS 会弹"允许访问本地网络"，请选「允许」。
          </Text>
          <Text style={styles.preFlightItem}>
            · 还没装 OpenClaw？可以先回到 Koko 看预览版的对话；正式聊天需要先装 OpenClaw。
          </Text>
        </View>

        <Text style={styles.stepLabel}>第 1 步 · 把下面这句话发给你的 OpenClaw</Text>
        <View style={styles.card}>
          <Text selectable style={styles.promptText}>
            {PAIRING_PROMPT}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleCopyPrompt()}
            style={[styles.copyButton, copied && styles.copyButtonOn]}
          >
            <Text style={styles.copyButtonText}>
              {copied ? "✓ 已复制" : "📋 复制这句话"}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.stepLabel}>第 2 步 · 把 OpenClaw 回复的配对码粘到这里</Text>
        <View style={styles.card}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="eyJ1cmwi..."
            placeholderTextColor={KokoColors.inkPlaceholder}
            multiline
            numberOfLines={4}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void handlePaste()}
            style={styles.pasteButton}
          >
            <Text style={styles.pasteButtonText}>📋 从剪贴板粘贴</Text>
          </Pressable>
        </View>

        {localError !== null ? (
          <Text style={styles.errorText}>错误：{localError}</Text>
        ) : null}
        {lastError !== null && localError === null ? (
          <Text style={styles.errorText}>上次错误：{lastError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={connectDisabled}
          onPress={() => void connectWith(input)}
          style={[styles.connectButton, connectDisabled && styles.connectButtonDisabled]}
        >
          <Text style={styles.connectButtonText}>
            {busy ? `连接中 (${status})…` : "连接"}
          </Text>
        </Pressable>

        <Link href="/" asChild>
          <Pressable accessibilityRole="button" style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
        </Link>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  flex: {
    flex: 1
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 8
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    color: KokoColors.inkSecondary
  },
  stepLabel: {
    marginTop: 28,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: KokoColors.inkSecondary
  },
  card: {
    marginTop: 8,
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.lg,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border
  },
  preFlightCard: {
    marginTop: 20,
    backgroundColor: KokoColors.primarySoft,
    borderColor: KokoColors.border
  },
  preFlightTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.ink,
    marginBottom: 6
  },
  preFlightItem: {
    fontSize: 13,
    lineHeight: 20,
    color: KokoColors.inkSecondary
  },
  promptText: {
    fontSize: 16,
    lineHeight: 24,
    color: KokoColors.ink
  },
  copyButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary
  },
  copyButtonOn: {
    backgroundColor: KokoColors.success
  },
  copyButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600"
  },
  input: {
    minHeight: 80,
    fontFamily: "Menlo",
    fontSize: 12,
    color: KokoColors.ink
  },
  pasteButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: KokoRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    backgroundColor: KokoColors.surfaceSoft
  },
  pasteButtonText: {
    fontSize: 12,
    color: KokoColors.inkSecondary
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: KokoColors.danger
  },
  connectButton: {
    marginTop: 24,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: KokoRadius.xl,
    backgroundColor: KokoColors.primary
  },
  connectButtonDisabled: {
    backgroundColor: KokoColors.primarySoft
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF"
  },
  backButton: {
    marginTop: 16,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12
  },
  backButtonText: {
    fontSize: 13,
    color: KokoColors.inkSecondary
  }
});
