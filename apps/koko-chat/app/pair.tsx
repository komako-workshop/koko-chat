import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { parseSetupCode } from "@/gateway/setupCode";
import { useGatewayStore } from "@/state/gateway";

export default function PairScreen() {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useGatewayStore((s) => s.status);
  const connect = useGatewayStore((s) => s.connect);
  const lastError = useGatewayStore((s) => s.lastError);

  async function handleConnect(): Promise<void> {
    setLocalError(null);
    if (busy) return;
    try {
      const setup = parseSetupCode(input);
      setBusy(true);
      await connect(setup);
      router.replace("/chat");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 px-6 py-8`}>
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>Pair with OpenClaw</Text>
        <Text style={tw`mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300`}>
          On your Mac, run:
        </Text>
        <View style={tw`mt-2 rounded-lg bg-slate-900 px-3 py-2`}>
          <Text style={tw`font-mono text-xs text-cyan-300`}>openclaw qr --json</Text>
        </View>
        <Text style={tw`mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300`}>
          Copy the <Text style={tw`font-mono text-xs`}>setupCode</Text> value (or paste the whole JSON) below.
          After you click Connect, run{" "}
          <Text style={tw`font-mono text-xs`}>openclaw devices list</Text> on your Mac and approve the pending request.
        </Text>

        <View style={tw`mt-5 rounded-2xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900`}>
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
          onPress={handleConnect}
          style={tw.style(
            "mt-6 items-center rounded-2xl px-6 py-4",
            busy || input.trim().length === 0
              ? "bg-slate-300 dark:bg-slate-700"
              : "bg-cyan-600 dark:bg-cyan-500"
          )}
        >
          <Text style={tw`text-base font-semibold text-white`}>
            {busy ? `Connecting (${status})…` : "Connect"}
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
