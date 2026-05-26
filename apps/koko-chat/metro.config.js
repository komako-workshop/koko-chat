const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Task 04b: Metro needs to be told about the pnpm monorepo layout so it can
// resolve workspace packages (@koko/protocol) and their transitive deps
// through pnpm's symlink graph. Keep Expo's generated watch folders too:
// Expo Doctor treats replacing them as a config drift in release builds.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
// Keep hierarchical lookup enabled so Metro can walk up through
// node_modules/.pnpm/<pkg>@<ver>/node_modules/... to find transitive peer deps.

// Zustand 5's ESM middleware bundle contains `import.meta.env` references for
// its devtools integration. When Metro serves the web bundle as a classic
// <script> (not type="module"), the parser throws
//   "Uncaught SyntaxError: Cannot use 'import.meta' outside a module"
// before any JS runs — resulting in a blank page.
//
// Fix: on the 'web' platform, rewrite any `zustand` / `zustand/<sub>` request
// to an absolute path pointing at the CJS file inside the zustand package.
// This bypasses the package.json `exports` map (which prefers ESM) entirely.
const zustandPkgDir = path.dirname(require.resolve("zustand/package.json"));
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && (moduleName === "zustand" || moduleName.startsWith("zustand/"))) {
    const subpath = moduleName === "zustand" ? "index" : moduleName.slice("zustand/".length);
    return {
      type: "sourceFile",
      filePath: path.join(zustandPkgDir, `${subpath}.js`)
    };
  }
  if (typeof baseResolveRequest === "function") {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
