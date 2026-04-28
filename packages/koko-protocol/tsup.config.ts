import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "crypto/index": "src/crypto/index.ts",
    "pairing/index": "src/pairing/index.ts",
    "envelope/index": "src/envelope/index.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  target: "es2022"
});
