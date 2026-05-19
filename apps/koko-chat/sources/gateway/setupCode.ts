/**
 * Parse OpenClaw setup code from `openclaw qr --json` output.
 *
 * The `setupCode` field is base64 (NOT base64url) encoding a JSON with
 *   { url: "ws://...", bootstrapToken: "..." }
 *   { url: "ws://...", deviceToken: "...", deviceId: "..." }
 *
 * Example from `openclaw qr --json --public-url ...`:
 *   {"setupCode": "eyJ1cmwiOiJ3c3M6...", "gatewayUrl": "wss://...", ...}
 *
 * The user can paste either the full base64 setupCode or the decoded JSON.
 */

export interface OpenClawSetup {
  url: string;
  bootstrapToken?: string;
  token?: string;
  deviceToken?: string;
  deviceId?: string;
}

export function parseSetupCode(input: string): OpenClawSetup {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("setup code is empty");
  }

  // Try parsing as JSON first (user may have pasted the decoded form).
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return validateSetup(parsed);
  } catch {
    // Not JSON, fall through to base64.
  }

  // Decode base64 (with or without padding).
  let padded = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) {
    padded += "=";
  }
  let jsonText: string;
  try {
    const binary = typeof atob === "function" ? atob(padded) : "";
    if (binary === "" && padded !== "") {
      throw new Error("atob not available");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    jsonText = new TextDecoder().decode(bytes);
  } catch (error) {
    throw new Error(
      `setup code is not valid base64 or JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `decoded setup code is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return validateSetup(parsed);
}

function validateSetup(value: unknown): OpenClawSetup {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("setup code must decode to an object");
  }
  const { url, bootstrapToken, token, deviceToken, deviceId } = value as Record<string, unknown>;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("setup code is missing a url field");
  }
  const hasBootstrapToken = typeof bootstrapToken === "string" && bootstrapToken.length > 0;
  const hasToken = typeof token === "string" && token.length > 0;
  const hasDeviceToken = typeof deviceToken === "string" && deviceToken.length > 0;
  if (!hasBootstrapToken && !hasToken && !hasDeviceToken) {
    throw new Error("setup code is missing a bootstrapToken, token, or deviceToken field");
  }
  if (!url.startsWith("ws://") && !url.startsWith("wss://") && !url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(`setup code url must start with ws:// or wss://, got ${url}`);
  }
  // http(s) URLs are coerced to ws(s) for convenience.
  const wsUrl = url.startsWith("http") ? url.replace(/^http/, "ws") : url;
  return {
    url: wsUrl,
    ...(hasBootstrapToken ? { bootstrapToken } : {}),
    ...(hasToken ? { token } : {}),
    ...(hasDeviceToken ? { deviceToken } : {}),
    ...(typeof deviceId === "string" && deviceId.length > 0 ? { deviceId } : {})
  };
}
