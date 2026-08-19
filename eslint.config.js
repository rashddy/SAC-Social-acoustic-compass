// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Both are generated: dist by `expo export`, .expo by the router typegen.
    ignores: ["dist/*", ".expo/*"],
  }
]);
