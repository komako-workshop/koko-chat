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
import { KokoColors } from "@/theme/koko";

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

  // Gateway state, in Chinese, plain language. Original showed the raw
  // English status enum ("connected" / "connecting" / "disconnected") which
  // reads as debug output to non-technical users.
  const gatewayStatusLabel: { text: string; tone: "good" | "warn" | "muted" } =
    gatewayStatus === "connected"
      ? { text: "已连接", tone: "good" }
      : gatewayStatus === "connecting" || gatewayStatus === "handshaking"
        ? { text: "连接中", tone: "warn" }
        : gatewayStatus === "error"
          ? { text: "异常", tone: "warn" }
          : { text: "未连接", tone: "muted" };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我</Text>
      </View>

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
            value={gatewayStatusLabel.text}
            valueTone={gatewayStatusLabel.tone}
          />
          <Link href="/pair" asChild>
            <Row icon="link-outline" label="配对 OpenClaw" chevron last={gatewayStatus !== "connected"} />
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

        {/* Group: about. Network self-test moved out — it was a debug door
            that produced more confusion than answers for normal users. */}
        <Group>
          <Row
            icon="information-circle-outline"
            label="关于 KokoChat"
            value={`v${appVersion}`}
            last
            onPress={() => {
              Alert.alert(
                "KokoChat",
                [
                  `版本 v${appVersion}`,
                  "",
                  "KokoChat 是 OpenClaw 的手机版伴侣 App。",
                  "聊天和 AI 能力来自你的 OpenClaw 服务器；",
                  "手机能访问 OpenClaw 服务器的 Gateway 后，",
                  "就可以在手机上继续和你的 AI 小搭子 Koko 聊天。"
                ].join("\n")
              );
            }}
          />
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
  valueTone?: "default" | "good" | "warn" | "muted";
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
        : valueTone === "muted"
          ? KokoColors.inkMuted
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
        <View style={styles.rowValueWrap}>
          {/* Add a coloured leading dot for status-style values (Gateway
              good / warn) so the state reads at a glance instead of
              requiring the user to parse the Chinese text. */}
          {valueTone === "good" || valueTone === "warn" ? (
            <View style={[styles.rowValueDot, { backgroundColor: valueColor }]} />
          ) : null}
          <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
        </View>
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
    // Slightly tinted ground (vs pure white on the chat list) so the white
    // group cards lift off the page like iOS Settings.
    backgroundColor: KokoColors.surfaceMuted
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: KokoColors.ink
  },
  scroll: {
    paddingBottom: 48,
    paddingHorizontal: 14
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: KokoColors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 18,
    // Soft single-pixel lift, no hairline border. Cards on tinted ground
    // need almost nothing to feel separated.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 1,
    elevation: 1
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: KokoColors.primarySoft,
    // Warm-orange elevation glow — mirrors the chat list "+" button so the
    // brand colour appears once per tab and never feels arbitrary.
    shadowColor: "#FF8C2A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 5
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
    fontSize: 19,
    fontWeight: "700",
    color: KokoColors.ink
  },
  profileSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: KokoColors.inkSecondary
  },
  group: {
    marginBottom: 16,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: KokoColors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 1,
    elevation: 1
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  rowSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: KokoColors.hairline,
    // Indent the hairline past the icon, matches iOS Settings rows.
    marginLeft: 0
  },
  rowLabel: {
    flex: 1,
    marginLeft: 12,
    fontSize: 15.5,
    fontWeight: "500"
  },
  rowValueWrap: {
    flexDirection: "row",
    alignItems: "center"
  },
  rowValueDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginRight: 6
  },
  rowValue: {
    fontSize: 13.5
  },
  rowChevron: {
    marginLeft: 8
  },
  footer: {
    marginTop: 24,
    alignItems: "center"
  },
  footerText: {
    fontSize: 11.5,
    color: KokoColors.inkMuted,
    letterSpacing: 0.2
  }
});
