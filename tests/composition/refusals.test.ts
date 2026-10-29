import { describe, expect, it } from "vitest";

import { importYaml } from "@stackpuddle/sdk";

const HEAD = "apiVersion: stackpuddle/v1\nkind: Fragment\n";

function codesOf(text: string): [string, string][] {
  const result = importYaml("f.yaml", text);
  expect(result.ok, "the import must be refused").toBe(false);
  return result.ok ? [] : result.error.map((item): [string, string] => [item.code, item.pointer]);
}

describe("YAML import refuses, never drops", () => {
  it("refuses unknown fields with the Go model's code and pointer", () => {
    expect(
      codesOf(
        `${HEAD}spec:\n  workloads:\n    api:\n      type: service\n      image: ghcr.io/example/api:1\n      replicas: 2\n`,
      ),
    ).toEqual([["structure.unknown_field", "/spec/workloads/api/replicas"]]);
  });

  it("refuses an unknown section of the Fragment", () => {
    expect(codesOf(`${HEAD}spec:\n  imports: [other.yaml]\n`)).toEqual([
      ["structure.unknown_field", "/spec/imports"],
    ]);
  });

  it("places an unknown field at its key", () => {
    const result = importYaml(
      "f.yaml",
      `${HEAD}spec:\n  workloads:\n    api:\n      type: service\n      image: ghcr.io/example/api:1\n      replicas: 2\n`,
    );
    expect(!result.ok && result.error[0]).toMatchObject({ file: "f.yaml", line: 8, column: 7 });
  });

  it("refuses a missing required field at the object that lacks it", () => {
    const result = importYaml(
      "f.yaml",
      `${HEAD}spec:\n  workloads:\n    api:\n      image: ghcr.io/example/api:1\n`,
    );
    expect(!result.ok && result.error[0]).toMatchObject({
      code: "structure.missing_field",
      pointer: "/spec/workloads/api/type",
      line: 5,
      column: 5,
    });
  });

  it("refuses an image together with a build as exactly one", () => {
    expect(
      codesOf(
        `${HEAD}spec:\n  workloads:\n    api:\n      type: service\n      image: ghcr.io/example/api:1\n      build:\n        context: services/api\n`,
      ),
    ).toEqual([["structure.exactly_one", "/spec/workloads/api"]]);
  });

  it("refuses a wrong type and a name with a dot", () => {
    expect(
      codesOf(
        `${HEAD}spec:\n  workloads:\n    api:\n      type: service\n      image: ghcr.io/example/api:1\n      command: ./api serve\n`,
      ),
    ).toEqual([["structure.invalid_type", "/spec/workloads/api/command"]]);
    expect(
      codesOf(
        `${HEAD}spec:\n  environments:\n    local.compose:\n      runtime: {type: compose, context: desktop-linux}\n      secrets: {provider: local}\n`,
      ),
    ).toEqual([["structure.invalid_value", "/spec/environments/local.compose"]]);
  });

  it("refuses a Project where a Fragment is expected", () => {
    expect(
      codesOf("apiVersion: stackpuddle/v1\nkind: Project\nmetadata: {name: shop}\nspec: {}\n"),
    ).toEqual([["structure.unexpected_kind", "/kind"]]);
  });

  it("refuses another API version by name, before anything else is read", () => {
    expect(codesOf("apiVersion: stackpuddle/v2\nkind: Fragment\nspec: {nonsense: 1}\n")).toEqual([
      ["sdk.unsupported_api_version", "/apiVersion"],
    ]);
  });

  it.each([
    [
      "an alias",
      `${HEAD}spec:\n  workloads:\n    api: &a {type: job, image: x}\n    b: *a\n`,
      "syntax.alias",
    ],
    [
      "a merge key",
      `${HEAD}spec:\n  workloads:\n    api:\n      <<: {type: job}\n`,
      "syntax.merge_key",
    ],
    [
      "a custom tag",
      `${HEAD}spec:\n  workloads:\n    api:\n      type: !job service\n`,
      "syntax.custom_tag",
    ],
    ["a duplicate key", `${HEAD}spec:\n  workloads: {}\n  workloads: {}\n`, "syntax.duplicate_key"],
    [
      "null",
      `${HEAD}spec:\n  workloads:\n    api:\n      type: service\n      image: ~\n`,
      "syntax.null_value",
    ],
  ])("refuses %s with the Go decoder's code", (_name, text, code) => {
    expect(codesOf(text).map(([found]) => found)).toEqual([code]);
  });

  it("refuses a secret input that carries a value in the project that composes it", async () => {
    const { defineProject, encodeModel } = await import("@stackpuddle/sdk");
    const result = importYaml(
      "i.yaml",
      `${HEAD}spec:\n  inputs:\n    db-password:\n      sensitivity: secret\n      value: not-a-real-password\n`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const encoded = encodeModel(defineProject("shop", { imports: [result.value] }));
      expect(
        !encoded.ok && encoded.error.map((item) => [item.code, item.pointer, item.message]),
      ).toEqual([
        [
          "structure.secret_literal",
          "/spec/inputs/db-password/value",
          expect.not.stringContaining("not-a-real-password"),
        ],
      ]);
    }
  });
});
