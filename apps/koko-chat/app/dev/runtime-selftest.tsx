import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  ActivityIndicator
} from "react-native";
import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useGatewayStore } from "@/state/gateway";
import {
  inferOnce,
  createAgentSession,
  sendAgentMessage,
  waitForAgentRun,
  readAgentHistory,
  deleteAgentSession,
  findLastAssistantMessage,
  extractMessageText
} from "@/runtime/openclaw";

type StepStatus = "pending" | "running" | "ok" | "fail";

interface StepResult {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

const INITIAL_STEPS: StepResult[] = [
  { id: "gateway", label: "Gateway connected", status: "pending" },
  { id: "infer-once", label: "inferOnce round-trip", status: "pending" },
  {
    id: "agent-session",
    label: "Agent session: create, send, read, delete",
    status: "pending"
  }
];

export default function RuntimeSelfTestScreen(): React.ReactElement {
  const status = useGatewayStore((s) => s.status);
  const [steps, setSteps] = useState<StepResult[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);

  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ title: "OpenClaw Runtime Self-Test" });
  }, [navigation]);

  function setStep(id: string, patch: Partial<StepResult>): void {
    setSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...patch } : step))
    );
  }

  async function runSelfTest(): Promise<void> {
    if (running) return;
    setRunning(true);
    setSteps(INITIAL_STEPS);

    try {
      // Step 1: gateway connectivity
      setStep("gateway", { status: "running" });
      if (status !== "connected") {
        setStep("gateway", {
          status: "fail",
          detail: `Gateway status is "${status}". Pair via Settings → Pair Gateway, then retry.`
        });
        return;
      }
      setStep("gateway", { status: "ok", detail: `status=${status}` });

      // Step 2: inferOnce
      setStep("infer-once", { status: "running" });
      try {
        const result = await inferOnce({
          miniAppId: "example",
          prompt:
            'Self-test ping. Reply with EXACTLY this token, nothing else: KOKO_SELFTEST_OK',
          timeoutMs: 60_000
        });
        const ok = result.text.includes("KOKO_SELFTEST_OK");
        setStep("infer-once", {
          status: ok ? "ok" : "fail",
          detail: ok
            ? `text="${result.text}" runId=${result.runId}`
            : `unexpected text="${result.text}"`
        });
        if (!ok) return;
      } catch (error) {
        setStep("infer-once", {
          status: "fail",
          detail: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      // Step 3: agent session round-trip
      setStep("agent-session", { status: "running" });
      try {
        const session = await createAgentSession({
          miniAppId: "example",
          scope: `selftest-${Date.now()}`,
          label: "KokoChat runtime self-test"
        });
        try {
          const send = await sendAgentMessage({
            sessionKey: session.key,
            message:
              'Self-test ping. Reply with EXACTLY this token, nothing else: KOKO_AGENT_SELFTEST_OK',
            timeoutMs: 60_000
          });
          const runStatus = await waitForAgentRun({
            runId: send.runId,
            timeoutMs: 60_000
          });
          if (runStatus.status !== "ok") {
            setStep("agent-session", {
              status: "fail",
              detail: `agent.wait status=${runStatus.status}${runStatus.error !== undefined ? ` error=${runStatus.error}` : ""}`
            });
            return;
          }
          const history = await readAgentHistory({
            sessionKey: session.key,
            limit: 6
          });
          const last = findLastAssistantMessage(history.messages);
          const text = last === null ? "" : extractMessageText(last).trim();
          const ok = text.includes("KOKO_AGENT_SELFTEST_OK");
          setStep("agent-session", {
            status: ok ? "ok" : "fail",
            detail: ok
              ? `text="${text}" sessionKey=${session.key}`
              : `unexpected text="${text}"`
          });
        } finally {
          try {
            await deleteAgentSession({ sessionKey: session.key });
          } catch {
            // Cleanup is best-effort. The self-test is still valid.
          }
        }
      } catch (error) {
        setStep("agent-session", {
          status: "fail",
          detail: error instanceof Error ? error.message : String(error)
        });
        return;
      }
    } finally {
      setRunning(false);
    }
  }

  const allOk = steps.every((step) => step.status === "ok");
  const anyFail = steps.some((step) => step.status === "fail");

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <ScrollView contentContainerStyle={tw`px-5 py-6`}>
        <Text
          style={tw`text-2xl font-bold text-slate-950 dark:text-slate-50`}
        >
          OpenClaw Runtime Self-Test
        </Text>
        <Text
          style={tw`mt-2 text-sm text-slate-600 dark:text-slate-400`}
        >
          Verifies that this device can reach OpenClaw and round-trip both a
          one-shot inference and a stateful agent session. Run this when
          starting on a new mini-app, or after pairing.
        </Text>

        <View style={tw`mt-3 flex-row items-center`}>
          <Text style={tw`text-xs text-slate-500 dark:text-slate-400`}>
            Gateway status:
          </Text>
          <Text
            style={tw.style(
              "ml-2 text-xs font-semibold",
              status === "connected"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-500 dark:text-rose-400"
            )}
          >
            {status}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => void runSelfTest()}
          disabled={running}
          style={({ pressed }) =>
            tw.style(
              "mt-6 rounded-2xl px-5 py-3.5",
              running
                ? "bg-slate-300 dark:bg-slate-700"
                : pressed
                  ? "bg-cyan-700"
                  : "bg-cyan-600"
            )
          }
        >
          <Text style={tw`text-center text-base font-semibold text-white`}>
            {running ? "Running…" : "Run Self-Test"}
          </Text>
        </Pressable>

        <View style={tw`mt-6 gap-3`}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </View>

        {allOk ? (
          <View
            style={tw`mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950`}
          >
            <Text style={tw`text-sm font-semibold text-emerald-700 dark:text-emerald-200`}>
              All checks passed.
            </Text>
            <Text style={tw`mt-1 text-xs text-emerald-700 dark:text-emerald-300`}>
              KokoChat → OpenClaw runtime is healthy. Mini-apps using
              inferOnce or agent sessions should work on this device.
            </Text>
          </View>
        ) : null}

        {anyFail ? (
          <View
            style={tw`mt-6 rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950`}
          >
            <Text style={tw`text-sm font-semibold text-rose-700 dark:text-rose-200`}>
              At least one check failed.
            </Text>
            <Text style={tw`mt-1 text-xs text-rose-700 dark:text-rose-300`}>
              See the step detail above. Common causes: Gateway not paired,
              OpenClaw agent not running, network unreachable, or model
              provider unavailable.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StepRow({ step }: { step: StepResult }): React.ReactElement {
  const tone =
    step.status === "ok"
      ? "border-emerald-300 bg-white dark:border-emerald-800 dark:bg-slate-900"
      : step.status === "fail"
        ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950"
        : step.status === "running"
          ? "border-cyan-300 bg-white dark:border-cyan-800 dark:bg-slate-900"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
  return (
    <View style={tw.style("rounded-2xl border p-4", tone)}>
      <View style={tw`flex-row items-center`}>
        <StepIcon status={step.status} />
        <Text
          style={tw`ml-3 flex-1 text-base font-semibold text-slate-950 dark:text-slate-50`}
        >
          {step.label}
        </Text>
      </View>
      {step.detail !== undefined ? (
        <Text
          style={tw`mt-2 text-xs text-slate-600 dark:text-slate-300`}
          selectable
        >
          {step.detail}
        </Text>
      ) : null}
    </View>
  );
}

function StepIcon({ status }: { status: StepStatus }): React.ReactElement {
  if (status === "running") {
    return <ActivityIndicator size="small" />;
  }
  const glyph =
    status === "ok"
      ? "✓"
      : status === "fail"
        ? "✗"
        : "•";
  const color =
    status === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "fail"
        ? "text-rose-600 dark:text-rose-400"
        : "text-slate-400 dark:text-slate-500";
  return (
    <Text style={tw.style("w-5 text-center text-base font-bold", color)}>
      {glyph}
    </Text>
  );
}
