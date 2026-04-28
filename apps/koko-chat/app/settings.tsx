import { Pressable, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useGatewayStore } from "@/state/gateway";
import { useSettingsStore } from "@/state/settings";

const switchTrack = {
  false: tw.color("slate-300") ?? "#cbd5e1",
  true: tw.color("cyan-500") ?? "#06b6d4"
};

export default function SettingsScreen() {
  const darkMode = useSettingsStore((state) => state.darkMode);
  const tapCount = useSettingsStore((state) => state.tapCount);
  const toggleDarkMode = useSettingsStore((state) => state.toggleDarkMode);
  const incrementTap = useSettingsStore((state) => state.incrementTap);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const forgetIdentity = useGatewayStore((state) => state.forgetIdentity);

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 px-6 py-8`}>
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>Settings</Text>

        <View style={tw`mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900`}>
          <View style={tw`flex-row items-center justify-between gap-4`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-lg font-semibold text-slate-950 dark:text-slate-50`}>Dark mode</Text>
              <Text style={tw`mt-1 text-sm text-slate-500 dark:text-slate-400`}>Stored in MMKV via Zustand persist.</Text>
            </View>
            <Switch
              ios_backgroundColor={switchTrack.false}
              onValueChange={toggleDarkMode}
              thumbColor={darkMode ? "#f8fafc" : "#ffffff"}
              trackColor={switchTrack}
              value={darkMode}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={incrementTap}
          style={tw`mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-5 dark:border-cyan-900 dark:bg-cyan-950`}
        >
          <Text style={tw`text-lg font-semibold text-cyan-950 dark:text-cyan-50`}>MMKV tap counter</Text>
          <Text style={tw`mt-2 text-base text-cyan-800 dark:text-cyan-200`}>tapCount: {tapCount}</Text>
        </Pressable>

        <View style={tw`mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900`}>
          <Text style={tw`text-lg font-semibold text-slate-950 dark:text-slate-50`}>OpenClaw Gateway</Text>
          <Text style={tw`mt-1 text-sm text-slate-500 dark:text-slate-400`}>Status: {gatewayStatus}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void forgetIdentity()}
            style={tw`mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-900 dark:bg-rose-950`}
          >
            <Text style={tw`text-sm font-semibold text-rose-700 dark:text-rose-200`}>
              Forget device identity + disconnect
            </Text>
            <Text style={tw`mt-1 text-xs text-rose-600 dark:text-rose-300`}>
              Clears the persisted Ed25519 seed and deviceToken. Next pair will request a fresh approval.
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
