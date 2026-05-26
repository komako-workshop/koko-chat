# Android APK Regression Report

Date: 2026-05-27

APK: `/Users/lijianren/Desktop/workspace/koko-chat/artifacts/android/kokochat-android-test.apk`

Build:

- Built with EAS local Android release profile.
- Installed package: `ai.komako.kokochat`
- Installed version: `versionName=0.0.1`, `versionCode=7`
- Verified manifest contains `android:usesCleartextTraffic=true`.
- Focused app logcat scan found no `FATAL EXCEPTION`, React Native JS runtime errors, `CLEARTEXT`, or websocket network-policy errors.

Environment:

- Emulator: `emulator-5554`
- Host OpenClaw: `OpenClaw 2026.5.5`
- Gateway: `ws://127.0.0.1:18789`
- Relay: `ws://47.84.141.40:8787`

Results:

- OpenClaw pairing: passed. Android generated a fresh pairing request, local pairing skill returned setup code, app connected successfully. Me page showed `Gateway 状态: connected`.
- Koko chat: passed. Sent `Android regression test: reply briefly in Chinese.` through the Android APK and received `收到，安卓回归测试正常。`.
- Deeply mini-app: passed. Created a Deeply session from the plus menu, sent a course request for `The Structure of Scientific Revolutions`, and received a multi-part course response.
- Tavern guide mini-app: passed. Created a Tavern session, asked for teacher roleplay characters, and received four rendered character cards with names, summaries, and tags.
- Tavern card to roleplay chat: passed. Tapped `格雷夫斯夫人 / Mrs Graves`, entered the roleplay chat, sent `Good afternoon, teacher.`, and received an in-character Chinese response.
- Background/foreground sanity check: passed. Sent app to Android home screen, reopened it, and the active roleplay conversation restored without crash.

Notes:

- The first Android builds failed because the app did not actually emit `android:usesCleartextTraffic` into the built manifest. The final build uses a local Expo config plugin to force the manifest value.
- Koko's seeded preview message still says it is not connected to OpenClaw even after pairing. This is stale introductory copy, not a functional failure; sending a new message uses OpenClaw normally.
- `adb input text` requires `%s` for spaces, so some manual test prompts were in English to keep emulator input reliable.
