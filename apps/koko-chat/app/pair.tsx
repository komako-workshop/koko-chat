import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import tw from "twrnc";

import { parseSetupCode } from "@/gateway/setupCode";
import { useGatewayStore } from "@/state/gateway";

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

/** Prompt the user sends to their already-paired Claw. */
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
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <ScrollView
        contentContainerStyle={tw`px-6 pb-12 pt-4`}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>
          添加到 OpenClaw
        </Text>
        <Text style={tw`mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300`}>
          KokoChat 需要通过你已有的 OpenClaw 拿到一个配对码。
        </Text>

        {/* Step 1: copy prompt */}
        <Text style={tw`mt-8 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400`}>
          第 1 步 · 把下面这句话发给你的 OpenClaw
        </Text>
        <View
          style={tw`mt-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900`}
        >
          <Text
            selectable
            style={tw`text-base leading-6 text-slate-900 dark:text-slate-50`}
          >
            {PAIRING_PROMPT}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleCopyPrompt()}
            style={tw.style(
              "mt-3 items-center rounded-full px-4 py-2 self-start",
              copied ? "bg-emerald-600" : "bg-slate-900 dark:bg-slate-100"
            )}
          >
            <Text
              style={tw.style(
                "text-sm font-semibold",
                copied ? "text-white" : "text-white dark:text-slate-900"
              )}
            >
              {copied ? "✓ 已复制" : "📋 复制这句话"}
            </Text>
          </Pressable>
        </View>

        {/* Step 2: paste setup code */}
        <Text style={tw`mt-8 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400`}>
          第 2 步 · 把 OpenClaw 回复的配对码粘到这里
        </Text>
        <View
          style={tw`mt-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900`}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="eyJ1cmwi..."
            placeholderTextColor={tw.color("slate-400") ?? "#94a3b8"}
            multiline
            numberOfLines={4}
            style={tw`min-h-20 font-mono text-xs text-slate-950 dark:text-slate-50`}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void handlePaste()}
            style={tw`mt-2 items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800 self-start`}
          >
            <Text style={tw`text-xs text-slate-700 dark:text-slate-200`}>📋 从剪贴板粘贴</Text>
          </Pressable>
        </View>

        {localError !== null ? (
          <Text style={tw`mt-3 text-sm text-rose-600 dark:text-rose-400`}>错误：{localError}</Text>
        ) : null}
        {lastError !== null && localError === null ? (
          <Text style={tw`mt-3 text-sm text-rose-600 dark:text-rose-400`}>上次错误：{lastError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={connectDisabled}
          onPress={() => void connectWith(input)}
          style={tw.style(
            "mt-6 items-center rounded-2xl px-6 py-4",
            connectDisabled ? "bg-slate-300 dark:bg-slate-700" : "bg-cyan-600"
          )}
        >
          <Text style={tw`text-base font-semibold text-white`}>
            {busy ? `连接中 (${status})…` : "连接"}
          </Text>
        </Pressable>

        <Link href="/" asChild>
          <Pressable
            accessibilityRole="button"
            style={tw`mt-6 items-center rounded-2xl px-6 py-3`}
          >
            <Text style={tw`text-sm text-slate-500 dark:text-slate-400`}>返回</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
