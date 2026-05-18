import { useLayoutEffect } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { Link, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore } from "@/state/conversations";
import { KokoColors, KokoRadius } from "@/theme/koko";

const appLogo = require("../../assets/brand/app-logo.png");

/**
 * Me tab ("我"): warm grouped-list profile screen.
 *
 * Sections:
 *   - Header: app logo + handle + version / conversation count
 *   - Gateway: status, pair, optional disconnect
 *   - About / dev tools
 *   - Danger zone: forget device identity
 *
 * No dark mode toggle. Colors come from `theme/koko`.
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
      "这只会清除 OpenClaw 连接凭证，不会删除聊天记录、小程序数据或 Koko 的本地会话。下次需要重新粘贴连接码。",
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
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profile}>
          <View style={styles.profileAvatar}>
            <Image source={appLogo} style={styles.profileAvatarImage} resizeMode="cover" />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileTitle}>KokoChat</Text>
            <Text style={styles.profileSubtitle}>
              v{appVersion} · {conversationCount} 个会话
            </Text>
          </View>
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
            <Row icon="qr-code-outline" label="配对 OpenClaw" chevron last={gatewayStatus !== "connected"} />
          </Link>
          {gatewayStatus === "connected" ? (
            <Row
              icon="power"
              label="断开连接"
              destructive
              onPress={() => void handleDisconnect()}
              last
            />
          ) : null}
        </Group>

        {/* Group: about + dev tools */}
        <Group>
          <Row
            icon="information-circle-outline"
            label="关于 KokoChat"
            value={`v${appVersion}`}
            // In production "关于" is the only row in this group, so it
            // owns the `last` flag (no trailing separator below it). In
            // dev the runtime self-test row sits below it and takes
            // `last` instead.
            last={!__DEV__}
            onPress={() => {
              Alert.alert(
                "KokoChat",
                [
                  `版本 v${appVersion}`,
                  "",
                  "KokoChat 是 OpenClaw 的手机版伴侣 App。",
                  "聊天和 AI 能力来自你 Mac 上运行的 OpenClaw；",
                  "手机和 Mac 在同一 Wi-Fi 下完成一次配对，",
                  "就可以在手机上继续和你的 AI 小搭子 Koko 聊天。"
                ].join("\n")
              );
            }}
          />
          {/* Dev-only entry into the runtime self-test page. Hidden from
              production builds (TestFlight / App Store) so users never see
              the developer instrumentation surface. The route file itself
              still ships in the bundle but, without an entry point, is
              effectively unreachable. */}
          {__DEV__ ? (
            <Link href="/dev/runtime-selftest" asChild>
              <Row icon="hammer-outline" label="OpenClaw Runtime 自检" chevron last />
            </Link>
          ) : null}
        </Group>

        {/* Danger zone */}
        <Group>
          <Row
            icon="trash-outline"
            label="忘记此设备"
            destructive
            onPress={() => void handleForgetIdentity()}
            last
          />
        </Group>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Made for OpenClaw · by Komako</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.group}>{children}</View>;
}

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  valueTone?: "default" | "good" | "warn";
  chevron?: boolean;
  destructive?: boolean;
  last?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
};

const Row = ({
  icon,
  label,
  value,
  valueTone = "default",
  chevron,
  destructive,
  last,
  onPress
}: RowProps): React.ReactElement => {
  const labelColor = destructive ? KokoColors.danger : KokoColors.ink;
  const iconColor = destructive ? KokoColors.danger : KokoColors.inkSecondary;
  const valueColor =
    valueTone === "good"
      ? KokoColors.success
      : valueTone === "warn"
        ? KokoColors.danger
        : KokoColors.inkMuted;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowSeparator,
        pressed && { backgroundColor: KokoColors.surfaceSoft }
      ]}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      {value !== undefined ? (
        <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
      ) : null}
      {chevron === true ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={KokoColors.inkMuted}
          style={styles.rowChevron}
        />
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  scroll: {
    paddingBottom: 48
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: KokoColors.surface,
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: KokoColors.hairline
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: KokoRadius.lg,
    overflow: "hidden",
    backgroundColor: KokoColors.primarySoft
  },
  profileAvatarImage: {
    width: "100%",
    height: "100%"
  },
  profileText: {
    marginLeft: 14,
    flex: 1
  },
  profileTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: KokoColors.ink
  },
  profileSubtitle: {
    marginTop: 3,
    fontSize: 12,
    color: KokoColors.inkSecondary
  },
  group: {
    marginTop: 14,
    marginHorizontal: 12,
    borderRadius: KokoRadius.lg,
    overflow: "hidden",
    backgroundColor: KokoColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.hairline
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13
  },
  rowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: KokoColors.hairline
  },
  rowLabel: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16
  },
  rowValue: {
    fontSize: 13
  },
  rowChevron: {
    marginLeft: 8
  },
  footer: {
    marginTop: 24,
    alignItems: "center"
  },
  footerText: {
    fontSize: 11,
    color: KokoColors.inkMuted
  }
});
