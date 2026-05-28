import { useEffect, useState } from "react";
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
import Ionicons from "@expo/vector-icons/Ionicons";

import { parseSetupCode } from "@/gateway/setupCode";
import { buildKokoChatPairingPrompt } from "@/gateway/pairingRequest";
import { useGatewayStore } from "@/state/gateway";
import { KokoColors, KokoRadius } from "@/theme/koko";

/**
 * Pairing flow (Claw-mediated, text-only).
 *
 * KokoChat assumes every user already has a working OpenClaw they can chat with
 * (Web UI, Desktop, another paired phone, etc.). To add a new device, we don't
 * make them open a terminal — we give them a ready-made prompt to send to their
 * existing Claw. KokoChat generates a device pairing request first, and the
 * `kokochat-pairing` workspace skill returns a device-token connection code
 * as plain text.
 * The user copies that string back into the paste box below.
 *
 * We deliberately do not use QR codes (ASCII or image). Plain text keeps the
 * path robust across every Claw frontend (terminal, Web UI, mobile) without
 * needing to solve QR rendering / scanning in each.
 */

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
  const [showPrompt, setShowPrompt] = useState(false);
  const [pairingPrompt, setPairingPrompt] = useState<string | null>(null);
  const status = useGatewayStore((s) => s.status);
  const connect = useGatewayStore((s) => s.connect);
  const lastError = useGatewayStore((s) => s.lastError);
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    let cancelled = false;
    void buildKokoChatPairingPrompt()
      .then((prompt) => {
        if (!cancelled) {
          setPairingPrompt(prompt);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (pairingPrompt === null) {
      setLocalError("配对请求还在生成，请稍后再试。");
      return;
    }
    const ok = await writeClipboardText(pairingPrompt);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setShowPrompt(true);
      Alert.alert("复制失败", "已展开完整请求，请长按手动复制。");
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
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.intro}>
          把这台手机连接到你的 OpenClaw。复制命令到运行 OpenClaw 的电脑 / 服务器终端，等它输出连接码后粘贴回来。
        </Text>

        <Text style={styles.stepLabel}>第 1 步 · 复制安装 / 配对命令</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>在 OpenClaw 机器上运行</Text>
          <Text style={styles.cardHint}>
            这段命令会安装或更新 KokoChat 支持并批准这台手机。低于 2026.4.15 的 OpenClaw 会先升级到 2026.5.22；命令结束后，把最后输出的连接码粘贴回来。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={pairingPrompt === null}
            onPress={() => void handleCopyPrompt()}
            style={[
              styles.copyButton,
              pairingPrompt === null && styles.copyButtonDisabled,
              copied && styles.copyButtonOn
            ]}
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={16}
              color="#FFFFFF"
            />
            <Text style={styles.copyButtonText}>
              {copied ? "已复制" : pairingPrompt === null ? "生成中" : "复制命令"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPrompt((value) => !value)}
            style={styles.plainButton}
          >
            <Text style={styles.plainButtonText}>
              {showPrompt ? "收起完整内容" : "查看完整内容"}
            </Text>
          </Pressable>
          {showPrompt ? (
            <Text selectable style={styles.promptText}>
              {pairingPrompt ?? "正在生成配对命令…"}
            </Text>
          ) : null}
        </View>

        <Text style={styles.stepLabel}>第 2 步 · 粘贴连接码</Text>
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
            <Ionicons name="clipboard-outline" size={14} color={KokoColors.inkSecondary} />
            <Text style={styles.pasteButtonText}>从剪贴板粘贴</Text>
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
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: KokoColors.ink
  },
  cardHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: KokoColors.inkSecondary
  },
  promptText: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: KokoColors.ink
  },
  copyButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary
  },
  copyButtonOn: {
    backgroundColor: KokoColors.success
  },
  copyButtonDisabled: {
    backgroundColor: KokoColors.primarySoft
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
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
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
  plainButton: {
    alignSelf: "flex-start",
    marginTop: 12
  },
  plainButtonText: {
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
