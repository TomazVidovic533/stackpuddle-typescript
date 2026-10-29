// Module names the tests import, mapped to the package sources. dependency-cruiser reads this as a
// resolver config (its webpackConfig option); tests/tsconfig.json and vitest.config.ts map the same names.
const path = require("node:path");

const src = path.join(__dirname, "..", "packages", "sdk", "src");

module.exports = {
  resolve: {
    alias: {
      "@stackpuddle/sdk$": path.join(src, "index.ts"),
      "@stackpuddle/sdk/postgres$": path.join(src, "postgres", "index.ts"),
      "@stackpuddle/sdk/compose$": path.join(src, "compose", "index.ts"),
    },
  },
};
