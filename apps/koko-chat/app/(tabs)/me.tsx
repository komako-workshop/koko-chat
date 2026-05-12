import { useLayoutEffect } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { Link, router, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore } from "@/state/conversations";
import { useSettingsStore } from "@/state/settings";

const appLogo = require("../../assets/brand/app-logo.png");

/**
 * Me tab ("我"): WeChat-style profile page with grouped list rows.
 *
 * Top: avatar + handle + secondary line (app version).
 * Groups:
 *   - Gateway status + manage connection
 *   - Pair a new OpenClaw Gateway (route to /pair)
 *   - Appearance (dark mode toggle for now)
 *   - About (version, debug info)
 *   - Danger zone: forget identity / clear conversations
 */
export default function MeTabScreen(): React.ReactElement {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const disconnect = useGatewayStore((s) => s.disconnect);
  const forgetIdentity = useGatewayStore((s) => s.forgetIdentity);
  const conversationCount = useConversationStore((s) => s.list.length);
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);

  const appVersion = Constants.expoConfig?.version ?? "0.0.1";

  async function handleDisconnect(): Promise<void> {
    Alert.alert("断开连接", "将会断开当前 Gateway 连接，但会保留设备配对。", [
      { text: "取消", style: "cancel" },
      {
        text: "断开",
        style: "destructive",
        onPress: () => {
          void disconnect();
        }
      }
    ]);
  }

  async function handleForgetIdentity(): Promise<void> {
    Alert.alert(
      "忘记此设备",
      "将清除本机保存的设备密钥与 Gateway Token。下次需要重新扫码配对。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清除",
          style: "destructive",
          onPress: () => {
            void forgetIdentity();
          }
        }
      ]
    );
  }

  return (
    <SafeAreaView
      style={tw`flex-1 bg-slate-100 dark:bg-black`}
      edges={["top", "left", "right"]}
    >
      <ScrollView contentContainerStyle={tw`pb-12`}>
        {/* Profile header */}
        <View
          style={tw`flex-row items-center bg-white px-4 py-5 dark:bg-slate-950`}
        >
          <View
            style={tw`h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-800`}
          >
            <Image source={appLogo} style={tw`h-full w-full`} resizeMode="cover" />
          </View>
          <View style={tw`ml-4 flex-1`}>
            <Text style={tw`text-xl font-semibold text-slate-950 dark:text-slate-50`}>
              KokoChat
            </Text>
            <Text style={tw`mt-1 text-xs text-slate-500 dark:text-slate-400`}>
              v{appVersion} · {conversationCount} 个会话
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={tw.color("slate-400") ?? "#94a3b8"}
          />
        </View>

        {/* Group: connection */}
        <Group>
          <Row
            icon="link"
            label="Gateway 状态"
            value={gatewayStatus}
            valueTone={gatewayStatus === "connected" ? "good" : "warn"}
          />
          <Link href="/pair" asChild>
            <Row icon="qr-code-outline" label="配对 Gateway" chevron />
          </Link>
          {gatewayStatus === "connected" ? (
            <Row
              icon="power"
              label="断开连接"
              destructive
              onPress={() => void handleDisconnect()}
            />
          ) : null}
        </Group>

        {/* Group: appearance */}
        <Group>
          <Row
            icon="moon-outline"
            label="深色模式"
            value={darkMode ? "已开启" : "已关闭"}
            onPress={() => toggleDarkMode()}
          />
        </Group>

        {/* Group: about */}
        <Group>
          <Row
            icon="information-circle-outline"
            label="关于 KokoChat"
            value={`v${appVersion}`}
            onPress={() => {
              Alert.alert(
                "KokoChat",
                `版本 v${appVersion}\n\nA mobile mini-app runtime on top of OpenClaw.`
              );
            }}
          />
        </Group>

        {/* Group: developer tools (dev builds only; harmless to ship) */}
        <Group>
          <Link href="/dev/runtime-selftest" asChild>
            <Row
              icon="hammer-outline"
              label="OpenClaw Runtime Self-Test"
              chevron
            />
          </Link>
        </Group>

        {/* Group: danger zone */}
        <Group>
          <Row
            icon="trash-outline"
            label="忘记此设备"
            destructive
            onPress={() => void handleForgetIdentity()}
          />
        </Group>

        <View style={tw`mt-6 items-center`}>
          <Text style={tw`text-xs text-slate-400 dark:text-slate-600`}>
            Made for OpenClaw ·{"\u2002"}
            <Text onPress={() => router.push("/")}>{""}</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View
      style={tw`mt-3 overflow-hidden rounded-lg mx-3 bg-white dark:bg-slate-950`}
    >
      {children}
    </View>
  );
}

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  valueTone?: "default" | "good" | "warn";
  chevron?: boolean;
  destructive?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
};

const Row = ({
  icon,
  label,
  value,
  valueTone = "default",
  chevron,
  destructive,
  onPress
}: RowProps): React.ReactElement => {
  const labelColor = destructive
    ? "text-rose-600 dark:text-rose-400"
    : "text-slate-950 dark:text-slate-50";
  const iconColor = destructive
    ? tw.color("rose-600") ?? "#dc2626"
    : tw.color("slate-700") ?? "#334155";
  const valueColorClass =
    valueTone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : valueTone === "warn"
        ? "text-rose-500 dark:text-rose-400"
        : "text-slate-400 dark:text-slate-500";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) =>
        tw.style(
          "flex-row items-center border-b border-slate-200 px-4 py-3 dark:border-slate-800",
          pressed ? "bg-slate-100 dark:bg-slate-900" : ""
        )
      }
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={tw.style("ml-3 flex-1 text-base", labelColor)}>{label}</Text>
      {value !== undefined ? (
        <Text style={tw.style("text-sm", valueColorClass)}>{value}</Text>
      ) : null}
      {chevron === true ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={tw.color("slate-400") ?? "#94a3b8"}
          style={tw`ml-2`}
        />
      ) : null}
    </Pressable>
  );
};
