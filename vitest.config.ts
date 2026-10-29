import { defineConfig } from "vitest/config";

const alias = {
  "@stackpuddle/sdk/postgres": new URL("packages/sdk/src/postgres/index.ts", import.meta.url)
    .pathname,
  "@stackpuddle/sdk/compose": new URL("packages/sdk/src/compose/index.ts", import.meta.url)
    .pathname,
  "@stackpuddle/sdk": new URL("packages/sdk/src/index.ts", import.meta.url).pathname,
};

function project(name: string, include: string[], timeout = 10_000) {
  return {
    extends: true as const,
    resolve: { alias },
    test: { name, include, testTimeout: timeout },
  };
}

export default defineConfig({
  test: {
    projects: [
      project("unit", ["tests/unit/**/*.test.ts"]),
      project("types", ["tests/types/**/*.test.ts"]),
      project("composition", ["tests/composition/**/*.test.ts"]),
      project("conformance", ["tests/conformance/**/*.test.ts"]),
      project("package", ["tests/package/**/*.test.ts"], 240_000),
    ],
  },
});
