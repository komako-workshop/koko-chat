import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { parseSetupCode } from "@/gateway/setupCode";
import { QrScanner } from "@/pair/QrScanner";
import { useGatewayStore } from "@/state/gateway";

async function readClipboardText(): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText !== undefined) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
  return null;
}

export default function PairScreen() {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
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

  async function handlePaste(): Promise<void> {
    const text = await readClipboardText();
    if (text !== null) {
      setInput(text.trim());
      setLocalError(null);
    } else {
      setLocalError("Clipboard not available in this browser. Paste manually with Cmd+V.");
    }
  }

  function handleScanned(data: string): void {
    setShowScanner(false);
    setInput(data);
    void connectWith(data);
  }

  if (showScanner) {
    return (
      <QrScanner
        onScanned={handleScanned}
        onCancel={() => setShowScanner(false)}
      />
    );
  }

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 px-6 py-8`}>
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>Pair with OpenClaw</Text>
        <Text style={tw`mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300`}>
          On your Mac, run:
        </Text>
        <View style={tw`mt-2 rounded-lg bg-slate-900 px-3 py-2`}>
          <Text style={tw`font-mono text-xs text-cyan-300`}>openclaw qr</Text>
        </View>
        <Text style={tw`mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300`}>
          Then scan the QR code displayed in the terminal with your phone, or paste the setup code below.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowScanner(true)}
          style={tw`mt-5 items-center rounded-2xl bg-cyan-600 px-6 py-4`}
        >
          <Text style={tw`text-base font-semibold text-white`}>📷 Scan QR code</Text>
        </Pressable>

        <View style={tw`mt-6 flex-row items-center gap-2`}>
          <View style={tw`h-px flex-1 bg-slate-300 dark:bg-slate-700`} />
          <Text style={tw`text-xs uppercase text-slate-500 dark:text-slate-400`}>or paste setup code</Text>
          <View style={tw`h-px flex-1 bg-slate-300 dark:bg-slate-700`} />
        </View>

        <View style={tw`mt-3 flex-row items-center justify-between`}>
          <Text style={tw`text-xs font-semibold uppercase text-slate-500 dark:text-slate-400`}>Setup code</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handlePaste()}
            style={tw`rounded-full border border-slate-300 bg-white px-3 py-1 dark:border-slate-700 dark:bg-slate-800`}
          >
            <Text style={tw`text-xs text-slate-700 dark:text-slate-200`}>📋 Paste</Text>
          </Pressable>
        </View>

        <View style={tw`mt-2 rounded-2xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900`}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="eyJ1cmwi..."
            placeholderTextColor={tw.color("slate-400") ?? "#94a3b8"}
            multiline
            numberOfLines={5}
            style={tw`min-h-24 font-mono text-xs text-slate-950 dark:text-slate-50`}
          />
        </View>

        {localError !== null ? (
          <Text style={tw`mt-3 text-sm text-rose-600 dark:text-rose-400`}>Error: {localError}</Text>
        ) : null}
        {lastError !== null && localError === null ? (
          <Text style={tw`mt-3 text-sm text-rose-600 dark:text-rose-400`}>Last error: {lastError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={busy || input.trim().length === 0}
          onPress={() => void connectWith(input)}
          style={tw.style(
            "mt-6 items-center rounded-2xl px-6 py-4",
            busy || input.trim().length === 0
              ? "bg-slate-300 dark:bg-slate-700"
              : "bg-slate-800 dark:bg-slate-200"
          )}
        >
          <Text style={tw.style("text-base font-semibold", busy || input.trim().length === 0 ? "text-white" : "text-white dark:text-slate-950")}>
            {busy ? `Connecting (${status})…` : "Connect with code"}
          </Text>
        </Pressable>

        <Link href="/" asChild>
          <Pressable
            accessibilityRole="button"
            style={tw`mt-4 items-center rounded-2xl border border-slate-300 px-6 py-3 dark:border-slate-700`}
          >
            <Text style={tw`text-base text-slate-700 dark:text-slate-200`}>Back Home</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}