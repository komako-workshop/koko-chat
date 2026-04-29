import Constants from "expo-constants";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

// Task 04b-1 verified workspace resolution via `import { PROTOCOL_VERSION }
// from "@koko/protocol"`. That worked, but importing @koko/protocol pulls in
// its crypto/sodium.ts which uses `createRequire(import.meta.url)` — a
// Node-only pattern that Metro bundles as-is and then blows up at runtime on
// Web with "Cannot use 'import.meta' outside a module" since the served
// bundle is a classic script, not ESM.
//
// For 04b-2 the APP talks to the Gateway through @koko/openclaw-client/protocol
// (which is Web-safe). @koko/protocol is still available in the workspace
// but we don't bring it into the APP bundle directly to avoid the sodium
// import chain. See DECISIONS.md.
import { useGatewayStore } from "@/state/gateway";

const navItems = [
  { href: "/pair", label: "Pair", caption: "Connect koko-cli" },
  { href: "/chat", label: "Chat", caption: "Open chat shell" },
  { href: "/settings", label: "Settings", caption: "Persist local preferences" }
] as const;

export default function HomeScreen() {
  const appVersion = Constants.expoConfig?.version ?? "0.0.1";
  const gatewayStatus = useGatewayStore((s) => s.status);

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 items-center justify-center px-8 py-12`}>
        <View style={tw`w-full max-w-md items-center gap-4`}>
          <Text style={tw`text-center text-4xl font-bold text-slate-950 dark:text-slate-50`}>
            🦞 KokoChat (dev)
          </Text>
          <Text style={tw`text-base text-slate-500 dark:text-slate-400`}>Version {appVersion}</Text>

          <View style={tw`mt-8 w-full gap-4`}>
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} asChild>
                <Pressable
                  accessibilityRole="button"
                  style={tw`rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm dark:border-slate-800 dark:bg-slate-900`}
                >
                  <Text style={tw`text-xl font-semibold text-slate-950 dark:text-slate-50`}>{item.label}</Text>
                  <Text style={tw`mt-1 text-sm text-slate-500 dark:text-slate-400`}>{item.caption}</Text>
                </Pressable>
              </Link>
            ))}
          </View>

          <Text
            style={tw.style(
              "mt-8 text-sm",
              gatewayStatus === "disconnected" ? "text-slate-400" : "text-cyan-600 dark:text-cyan-300"
            )}
          >
            Gateway: {gatewayStatus}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
