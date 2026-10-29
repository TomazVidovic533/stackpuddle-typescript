/** Dependency direction and import cycles (pebble TypeScript pack: dependency-direction, import-cycles). */
const path = require("node:path");

const SRC = "^packages/sdk/src";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Modules do not import each other in a cycle.",
      from: {},
      to: { circular: true },
    },
    {
      name: "model-imports-nothing-else",
      severity: "error",
      comment: "The domain layer (model/) imports nothing from the rest of the package.",
      from: { path: `${SRC}/model/` },
      to: { path: `${SRC}/`, pathNot: `${SRC}/model/` },
    },
    {
      name: "model-imports-no-packages",
      severity: "error",
      comment: "The domain layer imports no framework or third-party package.",
      from: { path: `${SRC}/model/` },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-unknown"] },
    },
    {
      name: "module-entries-are-leaves",
      severity: "error",
      comment:
        "postgres/ and compose/ are public entries; nothing inside the package imports them.",
      from: { path: `${SRC}/`, pathNot: `${SRC}/(postgres|compose)/` },
      to: { path: `${SRC}/(postgres|compose)/` },
    },
    {
      name: "module-entries-import-model-only",
      severity: "error",
      comment:
        "postgres/ and compose/ build on the domain layer, not on composition, parsing or adapters.",
      from: { path: `${SRC}/(postgres|compose)/` },
      to: { path: `${SRC}/`, pathNot: [`${SRC}/model/`, `${SRC}/(postgres|compose)/`] },
    },
    {
      name: "adapters-are-imported-by-composition-only",
      severity: "error",
      comment:
        "Adapters (*.adapter.ts) are reached from composition, serialization, the YAML reader and the public entry.",
      from: {
        path: `${SRC}/`,
        pathNot: [`${SRC}/(composition|serialization|yaml)/`, `${SRC}/index\\.ts$`],
      },
      to: { path: "\\.adapter\\.ts$" },
    },
    {
      name: "tests-use-the-public-entries",
      severity: "error",
      comment: "Tests outside tests/unit import the package through its three public entries.",
      from: { path: "^tests/(types|composition|conformance|package)/" },
      to: {
        path: `${SRC}/`,
        pathNot: [
          `${SRC}/index\\.ts$`,
          `${SRC}/postgres/index\\.ts$`,
          `${SRC}/compose/index\\.ts$`,
        ],
      },
    },
    {
      name: "src-imports-no-dev-dependencies",
      severity: "error",
      from: { path: `${SRC}/` },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|generated)/" },
    tsConfig: { fileName: path.join(__dirname, "tests/tsconfig.json") },
    // The aliases for the package names the tests import.
    webpackConfig: { fileName: path.join(__dirname, "tests/resolve-aliases.cjs") },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
