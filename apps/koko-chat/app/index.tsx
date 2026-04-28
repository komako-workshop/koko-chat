import Constants from "expo-constants";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

// Task 04b-1 sanity check: Metro must be able to resolve workspace packages
// through pnpm's symlink graph. Importing a constant is enough to verify the
// whole @koko/protocol module resolves and its transitive deps exist.
import { PROTOCOL_VERSION } from "@koko/protocol";

import { usePairingStore } from "@/state/pairing";

const navItems = [
  { href: "/pair", label: "Pair", caption: "Connect koko-cli" },
  { href: "/chat", label: "Chat", caption: "Open chat shell" },
  { href: "/settings", label: "Settings", caption: "Persist local preferences" }
] as const;

export default function HomeScreen() {
  const appVersion = Constants.expoConfig?.version ?? "0.0.1";
  const pairingStatus = usePairingStore((state) => state.status);

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 items-center justify-center px-8 py-12`}>
        <View style={tw`w-full max-w-md items-center gap-4`}>
          <Text style={tw`text-center text-4xl font-bold text-slate-950 dark:text-slate-50`}>
            🦞 KokoChat (dev)
          </Text>
          <Text style={tw`text-base text-slate-500 dark:text-slate-400`}>
            Version {appVersion} · Protocol v{PROTOCOL_VERSION}
          </Text>

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
              pairingStatus === "unpaired" ? "text-slate-400" : "text-cyan-600 dark:text-cyan-300"
            )}
          >
            Pairing state: {pairingStatus}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
