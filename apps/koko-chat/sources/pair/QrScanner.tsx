/**
 * QR code scanner. Uses expo-camera's built-in barcode scanning on native.
 *
 * On Web expo-camera doesn't expose barcode scanning — the Pair screen will
 * fall back to the paste flow. If we want web QR scanning later, add jsqr +
 * navigator.mediaDevices.getUserMedia in a separate code path.
 */

import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

interface Props {
  onScanned: (data: string) => void;
  onCancel: () => void;
}

export function QrScanner({ onScanned, onCancel }: Props) {
  if (Platform.OS === "web") {
    return <WebPlaceholder onCancel={onCancel} />;
  }
  return <NativeScanner onScanned={onScanned} onCancel={onCancel} />;
}

function WebPlaceholder({ onCancel }: { onCancel: () => void }) {
  return (
    <SafeAreaView style={tw`flex-1 bg-slate-950`}>
      <View style={tw`flex-1 items-center justify-center px-8`}>
        <Text style={tw`text-center text-lg text-slate-100`}>
          QR scanning isn't available on web yet. Use the paste flow below, or open KokoChat on your phone.
        </Text>
        <Pressable
          onPress={onCancel}
          style={tw`mt-8 rounded-2xl bg-cyan-600 px-6 py-3`}
        >
          <Text style={tw`text-base font-semibold text-white`}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function NativeScanner({ onScanned, onCancel }: Props) {
  // Dynamic import so expo-camera is only loaded on native (Web bundle won't
  // even pull it in).
  const [mod, setMod] = useState<typeof import("expo-camera") | null>(null);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const imported = await import("expo-camera");
        if (cancelled) return;
        setMod(imported);
        const { granted } = await imported.Camera.requestCameraPermissionsAsync();
        if (cancelled) return;
        setPermission(granted ? "granted" : "denied");
      } catch (error) {
        console.warn("[koko] expo-camera load failed", error);
        if (!cancelled) {
          setPermission("denied");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mod === null || permission === "unknown") {
    return (
      <SafeAreaView style={tw`flex-1 bg-slate-950`}>
        <View style={tw`flex-1 items-center justify-center`}>
          <Text style={tw`text-slate-100`}>Preparing camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permission === "denied") {
    return (
      <SafeAreaView style={tw`flex-1 bg-slate-950`}>
        <View style={tw`flex-1 items-center justify-center px-8`}>
          <Text style={tw`text-center text-lg text-slate-100`}>
            Camera permission not granted. Allow camera access in Settings to scan QR codes.
          </Text>
          <Pressable
            onPress={onCancel}
            style={tw`mt-8 rounded-2xl bg-cyan-600 px-6 py-3`}
          >
            <Text style={tw`text-base font-semibold text-white`}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const CameraView = mod.CameraView;

  return (
    <View style={tw`flex-1 bg-black`}>
      <CameraView
        style={tw`flex-1`}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(event) => {
          if (scanned) return;
          setScanned(true);
          onScanned(event.data);
        }}
      />
      <SafeAreaView edges={["top", "bottom"]} style={tw`absolute inset-0`}>
        <View style={tw`flex-1 justify-between`}>
          <View style={tw`items-center px-6 py-4`}>
            <Text style={tw`rounded-full bg-black/60 px-4 py-2 text-sm text-white`}>
              Point at the OpenClaw QR code in your Mac terminal
            </Text>
          </View>
          <View style={tw`items-center px-6 py-6`}>
            <Pressable
              onPress={onCancel}
              style={tw`rounded-2xl bg-white/90 px-6 py-3`}
            >
              <Text style={tw`text-base font-semibold text-slate-950`}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
