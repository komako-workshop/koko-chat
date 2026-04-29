// Polyfill globalThis.crypto.getRandomValues on native before anything else
// loads. @noble/ed25519 + our gateway code both need crypto.getRandomValues;
// RN's Hermes engine doesn't ship it. (On Web this is a no-op because
// crypto.getRandomValues already exists, but the import is harmless.)
import "react-native-get-random-values";
import "react-native-gesture-handler";
import "expo-router/entry";
