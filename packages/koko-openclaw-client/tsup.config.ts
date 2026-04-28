import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  target: "es2022",
  external: ["@koko/protocol", "@noble/ed25519", "@noble/hashes", "ws"]
});
