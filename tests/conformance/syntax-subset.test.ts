import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { importYaml } from "@stackpuddle/sdk";

import { readRevision, recordedCheckout, verifyCheckout } from "./support/checkout.js";

const revision = readRevision();
const checkout = recordedCheckout(revision);
const invalidRoot = join(checkout, "tests/conformance/cases/invalid");

type Expected = { code: string; file: string; line?: number; column?: number; pointer: string };

beforeAll(() => {
  verifyCheckout(revision, checkout);
});

function syntaxCases(): string[] {
  if (!existsSync(invalidRoot)) {
    return [];
  }
  return readdirSync(invalidRoot)
    .filter((name) => {
      const path = join(invalidRoot, name, "expected/diagnostics.json");
      if (!existsSync(path)) {
        return false;
      }
      const expected = JSON.parse(readFileSync(path, "utf8")) as Expected[];
      return expected.length > 0 && expected.every((item) => item.code.startsWith("syntax."));
    })
    .sort();
}

describe("the YAML subset is the one the Go decoder reads", () => {
  it("finds the syntax cases", () => {
    expect(syntaxCases().length).toBeGreaterThanOrEqual(10);
  });

  it.each(syntaxCases())("invalid/%s gives the Go model's code, pointer and position", (name) => {
    const root = join(invalidRoot, name);
    const expected = JSON.parse(
      readFileSync(join(root, "expected/diagnostics.json"), "utf8"),
    ) as Expected[];
    const result = importYaml("stackpuddle.yaml", readFileSync(join(root, "stackpuddle.yaml")));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const pick = (item: {
      code: string;
      file?: string;
      line?: number;
      column?: number;
      pointer: string;
    }) => ({
      code: item.code,
      file: item.file,
      line: item.line,
      column: item.column,
      pointer: item.pointer,
    });
    expect(result.error.map(pick)).toEqual(expected.map(pick));
  });
});
