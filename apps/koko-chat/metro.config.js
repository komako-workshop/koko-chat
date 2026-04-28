const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// TODO (Task 04b): extend config.watchFolders and config.resolver.nodeModulesPaths
// so Metro can resolve workspace packages (@koko/protocol, @koko/openclaw-client)
// through pnpm's symlinks. Not needed for 04a since we don't import them yet.

module.exports = config;
