import { useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useGatewayStore } from "@/state/gateway";
import { KokoColors, KokoRadius, KokoSpacing } from "@/theme/koko";

type CheckStatus = "idle" | "running" | "ok" | "warn" | "fail" | "skip";
type CheckKind = "core" | "setup";

interface CheckResult {
  id: string;
  label: string;
  target: string;
  kind: CheckKind;
  status: CheckStatus;
  attempts: number;
  successes: number;
  avgMs?: number | undefined;
  detail?: string | undefined;
  error?: string | undefined;
}

interface CheckDefinition {
  id: string;
  label: string;
  target: string;
  kind: CheckKind;
  run: () => Promise<string>;
}

const ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const WS_TIMEOUT_MS = 8_000;

const CHARACTER_DETAIL_URL =
  "https://character-tavern.com/api/character/endgoer2/modeus__the_lustful_demon";
const CHARACTER_IMAGE_URL =
  "https://cards.character-tavern.com/endgoer2/modeus__the_lustful_demon.png";
const GITHUB_SETUP_PAGE_URL = "https://github.com/komako-workshop/koko-chat";

export default function NetworkTestScreen(): React.ReactElement {
  const navigation = useNavigation();
  const setup = useGatewayStore((s) => s.setup);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<CheckResult[]>(() => makeInitialChecks(setup?.url));

  useLayoutEffect(() => {
    navigation.setOptions({ title: "网络连接测试" });
  }, [navigation]);

  const summary = useMemo(() => summarizeChecks(checks), [checks]);

  function updateCheck(id: string, patch: Partial<CheckResult>): void {
    setChecks((prev) =>
      prev.map((check) => (check.id === id ? { ...check, ...patch } : check))
    );
  }

  async function runChecks(): Promise<void> {
    if (running) return;
    const definitions = makeCheckDefinitions(setup?.url);
    setRunning(true);
    setChecks(definitions.map(definitionToInitialResult));

    await Promise.all(
      definitions.map(async (definition) => {
        if (definition.run === skipCheck) {
          updateCheck(definition.id, {
            status: "skip",
            attempts: 0,
            successes: 0,
            detail: "当前没有可测试的 OpenClaw 连接地址。"
          });
          return;
        }

        const samples: number[] = [];
        let lastDetail = "";
        let lastError = "";
        updateCheck(definition.id, { status: "running", attempts: 0, successes: 0 });

        for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
          const start = Date.now();
          try {
            lastDetail = await definition.run();
            samples.push(Date.now() - start);
            updateCheck(definition.id, {
              attempts: attempt,
              successes: samples.length,
              avgMs: average(samples),
              detail: lastDetail,
              error: undefined
            });
          } catch (error) {
            lastError = formatError(error);
            updateCheck(definition.id, {
              attempts: attempt,
              successes: samples.length,
              avgMs: samples.length > 0 ? average(samples) : undefined,
              error: lastError
            });
          }
        }

        updateCheck(definition.id, {
          status: samples.length === ATTEMPTS ? "ok" : definition.kind === "setup" ? "warn" : "fail",
          avgMs: samples.length > 0 ? average(samples) : undefined,
          detail: samples.length > 0 ? lastDetail : undefined,
          error: samples.length === ATTEMPTS ? undefined : lastError || "连接不稳定"
        });
      })
    );

    setRunning(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="pulse-outline" size={26} color={KokoColors.primaryDeep} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>网络连接测试</Text>
            <Text style={styles.subtitle}>
              从这台手机测试 OpenClaw、Character Tavern 和安装说明的访问稳定性。
            </Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Gateway 状态</Text>
          <Text
            style={[
              styles.statusValue,
              gatewayStatus === "connected" ? styles.statusGood : styles.statusWarn
            ]}
          >
            {gatewayStatus}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => void runChecks()}
          disabled={running}
          style={({ pressed }) => [
            styles.primaryButton,
            running && styles.primaryButtonDisabled,
            pressed && !running && styles.primaryButtonPressed
          ]}
        >
          {running ? <ActivityIndicator color="#ffffff" size="small" /> : null}
          <Text style={styles.primaryButtonText}>
            {running ? "测试中" : "开始测试"}
          </Text>
        </Pressable>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{summary.title}</Text>
          <Text style={styles.summaryText}>{summary.text}</Text>
        </View>

        <View style={styles.list}>
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeInitialChecks(gatewayUrl: string | undefined): CheckResult[] {
  return makeCheckDefinitions(gatewayUrl).map(definitionToInitialResult);
}

function makeCheckDefinitions(gatewayUrl: string | undefined): CheckDefinition[] {
  const currentServerHealthUrl = gatewayUrl === undefined ? null : healthUrlFromGatewayUrl(gatewayUrl);
  return [
    {
      id: "gateway-ws",
      label: "OpenClaw Gateway",
      target: gatewayUrl === undefined ? "未连接" : describeUrl(gatewayUrl),
      kind: "core",
      run: gatewayUrl === undefined ? skipCheck : () => testGatewaySocket(gatewayUrl)
    },
    {
      id: "gateway-health",
      label: "当前服务器 healthz",
      target: currentServerHealthUrl === null ? "未连接" : describeUrl(currentServerHealthUrl),
      kind: "core",
      run: currentServerHealthUrl === null
        ? skipCheck
        : () => testFetch(currentServerHealthUrl, {
            accept: "application/json",
            timeoutMs: FETCH_TIMEOUT_MS,
            readBody: "text"
          })
    },
    {
      id: "character-api",
      label: "Character Tavern API",
      target: "character-tavern.com",
      kind: "core",
      run: () => testFetch(CHARACTER_DETAIL_URL, {
        accept: "application/json",
        timeoutMs: FETCH_TIMEOUT_MS,
        readBody: "json"
      })
    },
    {
      id: "character-image",
      label: "Character Tavern 图片",
      target: "cards.character-tavern.com",
      kind: "core",
      run: () => testFetch(CHARACTER_IMAGE_URL, {
        accept: "image/png,image/*;q=0.8,*/*;q=0.5",
        timeoutMs: FETCH_TIMEOUT_MS,
        readBody: "bytes",
        headers: { Range: "bytes=0-15" }
      })
    },
    {
      id: "github-readme",
      label: "KokoChat 安装说明",
      target: "github.com/koko-chat#openclaw-setup",
      kind: "setup",
      run: () => testFetch(GITHUB_SETUP_PAGE_URL, {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        timeoutMs: FETCH_TIMEOUT_MS,
        readBody: "text"
      })
    }
  ];
}

function definitionToInitialResult(definition: CheckDefinition): CheckResult {
  return {
    id: definition.id,
    label: definition.label,
    target: definition.target,
    kind: definition.kind,
    status: "idle",
    attempts: 0,
    successes: 0
  };
}

async function skipCheck(): Promise<string> {
  throw new Error("skipped");
}

function healthUrlFromGatewayUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol === "ws:") url.protocol = "http:";
    else if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/healthz";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function describeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return rawUrl;
  }
}

function testGatewaySocket(rawUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    let opened = false;
    const ws = new WebSocket(rawUrl);
    const timer = setTimeout(() => {
      finish(() => reject(new Error(opened ? "已打开，但未收到 challenge" : "连接超时")));
    }, WS_TIMEOUT_MS);

    function finish(callback: () => void): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close(1000, "network test complete");
      } catch {
        // Ignore close races.
      }
      callback();
    }

    ws.onopen = () => {
      opened = true;
    };
    ws.onerror = () => {
      finish(() => reject(new Error("WebSocket error")));
    };
    ws.onclose = (event) => {
      if (!done) {
        finish(() => reject(new Error(`WebSocket closed: ${event.code}`)));
      }
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const frame = JSON.parse(event.data) as {
          type?: unknown;
          event?: unknown;
          payload?: { nonce?: unknown };
        };
        if (
          frame.type === "event" &&
          frame.event === "connect.challenge" &&
          typeof frame.payload?.nonce === "string"
        ) {
          finish(() => resolve("收到 connect.challenge"));
        }
      } catch {
        // Ignore unrelated frames.
      }
    };
  });
}

async function testFetch(
  url: string,
  options: {
    accept: string;
    timeoutMs: number;
    readBody: "text" | "json" | "bytes";
    headers?: Record<string, string>;
  }
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: options.accept,
        ...(options.headers ?? {})
      },
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "unknown";
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (options.readBody === "json") {
      await response.json();
    } else if (options.readBody === "bytes") {
      await response.arrayBuffer();
    } else {
      await response.text();
    }

    return `HTTP ${response.status} · ${contentType.split(";")[0]}`;
  } finally {
    clearTimeout(timer);
  }
}

function summarizeChecks(checks: CheckResult[]): { title: string; text: string } {
  const running = checks.filter((check) => check.status === "running");
  const finished = checks.filter((check) => check.status !== "idle" && check.status !== "running");
  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  const skipped = checks.filter((check) => check.status === "skip");
  if (running.length > 0) {
    return {
      title: "测试中",
      text: "正在连续测试各个连接，稍等一下。"
    };
  }
  if (finished.length === 0) {
    return {
      title: "尚未开始",
      text: "点击开始测试后，每个连接会连续尝试 3 次。"
    };
  }
  if (failed.length === 0) {
    if (warned.length > 0) {
      const names = warned.map((check) => check.label).join("、");
      return {
        title: "核心链路正常",
        text: `${names} 不稳定，但不影响已配对后的聊天、酒馆 API 和图片加载。`
      };
    }
    return {
      title: skipped.length > 0 ? "可用连接正常" : "全部通过",
      text: skipped.length > 0
        ? "当前可测试的连接都正常，未连接的项目已跳过。"
        : "这台手机到所有测试端点都稳定可达。"
    };
  }
  const names = failed.map((check) => check.label).join("、");
  return {
    title: "发现不稳定连接",
    text: `${names} 未能连续通过，优先看失败项的错误和平均耗时。`
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Aborted";
    return error.message;
  }
  return String(error);
}

function CheckRow({ check }: { check: CheckResult }): React.ReactElement {
  const tone = toneForStatus(check.status);
  const value = valueForCheck(check);
  return (
    <View style={styles.checkRow}>
      <View style={[styles.checkIcon, { backgroundColor: tone.bg }]}>
        {check.status === "running" ? (
          <ActivityIndicator size="small" color={tone.fg} />
        ) : (
          <Ionicons name={iconForStatus(check.status)} size={18} color={tone.fg} />
        )}
      </View>
      <View style={styles.checkBody}>
        <View style={styles.checkTopLine}>
          <Text style={styles.checkLabel}>{check.label}</Text>
          <Text style={[styles.checkValue, { color: tone.fg }]}>{value}</Text>
        </View>
        <Text style={styles.checkTarget}>{check.target}</Text>
        {check.detail !== undefined ? (
          <Text style={styles.checkDetail}>{check.detail}</Text>
        ) : null}
        {check.error !== undefined ? (
          <Text style={styles.checkError}>{check.error}</Text>
        ) : null}
      </View>
    </View>
  );
}

function valueForCheck(check: CheckResult): string {
  if (check.status === "idle") return "未测";
  if (check.status === "skip") return "跳过";
  const base = `${check.successes}/${ATTEMPTS}`;
  return check.avgMs === undefined ? base : `${base} · ${check.avgMs}ms`;
}

function iconForStatus(status: CheckStatus): keyof typeof Ionicons.glyphMap {
  if (status === "ok") return "checkmark";
  if (status === "warn") return "alert-circle-outline";
  if (status === "fail") return "close";
  if (status === "skip") return "remove";
  return "ellipse";
}

function toneForStatus(status: CheckStatus): { bg: string; fg: string } {
  if (status === "ok") return { bg: KokoColors.successSoft, fg: KokoColors.success };
  if (status === "warn") return { bg: KokoColors.primarySoft, fg: KokoColors.primaryDeep };
  if (status === "fail") return { bg: KokoColors.dangerSoft, fg: KokoColors.danger };
  if (status === "running") return { bg: KokoColors.primarySoft, fg: KokoColors.primaryDeep };
  return { bg: KokoColors.surfaceSoft, fg: KokoColors.inkMuted };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  scroll: {
    padding: 16,
    paddingBottom: 40
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: KokoRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KokoColors.primarySoft
  },
  headerText: {
    marginLeft: 12,
    flex: 1
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: KokoColors.ink,
    letterSpacing: 0
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: KokoColors.inkSecondary
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: KokoRadius.md,
    backgroundColor: KokoColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.hairline,
    padding: KokoSpacing.card,
    marginBottom: 12
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: KokoColors.ink
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "700"
  },
  statusGood: {
    color: KokoColors.success
  },
  statusWarn: {
    color: KokoColors.danger
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: KokoRadius.lg,
    backgroundColor: KokoColors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12
  },
  primaryButtonPressed: {
    backgroundColor: KokoColors.primaryDeep
  },
  primaryButtonDisabled: {
    opacity: 0.7
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#ffffff"
  },
  summaryCard: {
    borderRadius: KokoRadius.md,
    backgroundColor: KokoColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.hairline,
    padding: KokoSpacing.card,
    marginBottom: 12
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: KokoColors.ink
  },
  summaryText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
    color: KokoColors.inkSecondary
  },
  list: {
    borderRadius: KokoRadius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.hairline,
    backgroundColor: KokoColors.surface
  },
  checkRow: {
    flexDirection: "row",
    padding: KokoSpacing.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: KokoColors.hairline
  },
  checkIcon: {
    width: 32,
    height: 32,
    borderRadius: KokoRadius.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  checkBody: {
    flex: 1,
    marginLeft: 12
  },
  checkTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  checkLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: KokoColors.ink
  },
  checkValue: {
    fontSize: 12,
    fontWeight: "800"
  },
  checkTarget: {
    marginTop: 3,
    fontSize: 12,
    color: KokoColors.inkMuted
  },
  checkDetail: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: KokoColors.inkSecondary
  },
  checkError: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: KokoColors.danger
  }
});
