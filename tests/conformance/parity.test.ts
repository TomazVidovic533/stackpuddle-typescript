import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { type Diagnostic, type JsonValue, encodeModel } from "@stackpuddle/sdk";

import type { CaseHalf } from "./support/case.js";
import { readRevision, recordedCheckout, verifyCheckout } from "./support/checkout.js";

const revision = readRevision();
const checkout = recordedCheckout(revision);
const parityRoot = join(checkout, "tests/conformance/cases/parity");
const halvesRoot = new URL("./cases/", import.meta.url).pathname;

type CaseModule = {
  default: CaseHalf;
  /** Refs (or "all") the half declares in code although the YAML half declares them in YAML. */
  inCode?: readonly string[] | "all";
  /** The half builds the diagnosed objects in code, so no diagnostic carries a YAML file. */
  diagnosticsInCode?: boolean;
};

type Expected = { code: string; file?: string; pointer: string };

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutProvenance(model: unknown): unknown {
  if (!isObject(model)) {
    return model;
  }
  const { provenance: _provenance, ...intent } = model;
  return intent;
}

function print(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

beforeAll(() => {
  verifyCheckout(revision, checkout);
});

const parityCases = existsSync(parityRoot)
  ? readdirSync(parityRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];
const halves = readdirSync(halvesRoot)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => name.slice(0, -3))
  .sort();

describe("parity case coverage", () => {
  it("has a TypeScript half for every YAML half and a YAML half for every TypeScript half", () => {
    expect(
      parityCases.filter((name) => !halves.includes(name)),
      "parity cases without a TypeScript half",
    ).toEqual([]);
    expect(
      halves.filter((name) => !parityCases.includes(name)),
      "TypeScript halves without a parity case",
    ).toEqual([]);
  });
});

describe.each(parityCases)("parity/%s", (name) => {
  const caseRoot = join(parityRoot, name);
  const modelPath = join(caseRoot, "expected/model.json");
  const diagnosticsPath = join(caseRoot, "expected/diagnostics.json");

  async function load() {
    return (await import(`./cases/${name}.ts`)) as CaseModule;
  }

  async function emit() {
    const module = await load();
    return encodeModel(await module.default({ root: caseRoot }));
  }

  if (existsSync(modelPath)) {
    it("emits the reviewed canonical intent", async () => {
      const result = await emit();
      expect(result.ok, result.ok ? "" : JSON.stringify(result.error)).toBe(true);
      if (!result.ok) {
        return;
      }
      const expected = json(modelPath);
      expect(print(withoutProvenance(JSON.parse(result.value)))).toBe(
        print(withoutProvenance(expected)),
      );
    });

    it("keeps YAML provenance and patches of imported declarations", async () => {
      const result = await emit();
      if (!result.ok) {
        throw new Error(JSON.stringify(result.error));
      }
      const actual = (
        JSON.parse(result.value) as { provenance: Record<string, { declared: { origin: string } }> }
      ).provenance;
      const expected = (
        json(modelPath) as {
          provenance: Record<
            string,
            { declared: { origin: string }; patched?: { fields: string[] }[] }
          >;
        }
      ).provenance;
      for (const [ref, entry] of Object.entries(actual)) {
        if (entry.declared.origin === "yaml") {
          expect(entry, ref).toEqual(expected[ref]);
        } else {
          expect(entry.declared, ref).toEqual({ origin: "sdk" });
        }
      }
      const inCode = (await load()).inCode ?? [];
      const isInCode = (ref: string) => inCode === "all" || inCode.includes(ref);
      for (const [ref, entry] of Object.entries(expected)) {
        if (entry.declared.origin !== "yaml") {
          continue;
        }
        expect(actual[ref], `${ref} is missing from the SDK output`).toBeDefined();
        if (isInCode(ref)) {
          expect(actual[ref]?.declared, ref).toEqual({ origin: "sdk" });
        } else {
          expect(actual[ref], ref).toEqual(entry);
        }
      }
    });

    it("equals the reviewed file byte for byte when every declaration came from YAML", async () => {
      const result = await emit();
      if (!result.ok) {
        throw new Error(JSON.stringify(result.error));
      }
      const provenance = (
        JSON.parse(result.value) as { provenance: Record<string, { declared: { origin: string } }> }
      ).provenance;
      const allYaml = Object.values(provenance).every((entry) => entry.declared.origin === "yaml");
      if (allYaml) {
        expect(result.value).toBe(readFileSync(modelPath, "utf8"));
      } else {
        expect(print(withoutProvenance(JSON.parse(result.value)))).toBe(
          print(withoutProvenance(json(modelPath))),
        );
      }
    });

    it("writes the canonical file layout", async () => {
      const result = await emit();
      if (!result.ok) {
        throw new Error(JSON.stringify(result.error));
      }
      expect(result.value.endsWith("}\n")).toBe(true);
      expect(print(JSON.parse(result.value))).toBe(result.value);
    });
  }

  if (existsSync(diagnosticsPath)) {
    it("reports the expected diagnostics by code, pointer and, for YAML declarations, file", async () => {
      const result = await emit();
      expect(result.ok, "the project must not encode").toBe(false);
      if (result.ok) {
        return;
      }
      const expected = json(diagnosticsPath) as Expected[];
      const actual = result.error.map((item: Diagnostic) => ({
        code: item.code,
        pointer: item.pointer,
        file: item.file,
      }));
      expect(actual.map(({ code, pointer }) => ({ code, pointer }))).toEqual(
        expected.map(({ code, pointer }) => ({ code, pointer })),
      );
      const fromCode = (await load()).diagnosticsInCode === true;
      expected.forEach((want, index) => {
        const got = actual[index];
        if (want.file !== undefined) {
          expect(got?.file, "a YAML-declared diagnostic keeps its file").toBe(
            fromCode ? undefined : want.file,
          );
        }
      });
    });
  }
});

export type { JsonValue };
