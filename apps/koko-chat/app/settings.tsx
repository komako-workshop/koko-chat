import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useGatewayStore } from "@/state/gateway";
import { KokoColors, KokoRadius } from "@/theme/koko";

/**
 * Standalone Settings screen (reachable as a Stack-level route, separate
 * from the Me tab).
 *
 * Today it only surfaces the Gateway state + the "forget identity"
 * escape hatch. Most user-facing options live on the Me tab.
 */
export default function SettingsScreen() {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const forgetIdentity = useGatewayStore((state) => state.forgetIdentity);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>OpenClaw Gateway</Text>
          <Text style={styles.cardSubtitle}>状态：{gatewayStatus}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void forgetIdentity()}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonTitle}>忘记此设备并断开</Text>
            <Text style={styles.dangerButtonSubtitle}>
              清除本机保存的 Ed25519 密钥和 Gateway Token。下次需要重新扫码配对。
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16
  },
  card: {
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.lg,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: KokoColors.ink
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: KokoColors.inkSecondary
  },
  dangerButton: {
    marginTop: 14,
    backgroundColor: KokoColors.dangerSoft,
    borderRadius: KokoRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  dangerButtonTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: KokoColors.danger
  },
  dangerButtonSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: KokoColors.inkSecondary,
    lineHeight: 18
  }
});
