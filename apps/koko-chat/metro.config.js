const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Task 04b: Metro needs to be told about the pnpm monorepo layout so it can
// resolve workspace packages (@koko/protocol) and their transitive deps
// (libsodium-wrappers, @noble/hashes, zod) which live under
// <workspaceRoot>/node_modules/.pnpm/... through pnpm's symlink graph.
//
// Approach A (Expo-recommended): watch the whole monorepo, look up modules
// from both the app's node_modules and the workspace root's node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
// Keep hierarchical lookup enabled so Metro can walk up through
// node_modules/.pnpm/<pkg>@<ver>/node_modules/... to find transitive
// peer deps that pnpm does not hoist to the app root (e.g.
// @expo/metro-runtime via expo-router).
// config.resolver.disableHierarchicalLookup = true;  // previously set, caused resolve failures

module.exports = config;
