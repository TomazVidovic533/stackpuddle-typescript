import { describe, expect, it } from "vitest";

import { YAML_LIMITS, readYaml } from "../../packages/sdk/src/yaml/read-yaml.adapter.js";

function refused(input: string | Uint8Array) {
  const result = readYaml("f.yaml", input);
  expect(result.ok, "the input must be refused").toBe(false);
  return result.ok
    ? []
    : result.error.map(({ code, pointer, line, column }) => ({ code, pointer, line, column }));
}

describe("the YAML reader accepts the Go decoder's subset", () => {
  it("reads strings, booleans, JSON numbers, lists and mappings as plain data", () => {
    const result = readYaml(
      "f.yaml",
      "a: 1\nb: [x, true, 2.5, -3, 1e3]\nc: {d: text}\ne: '0x1F'\n",
    );
    expect(result.ok && result.value.tree).toEqual({
      a: 1,
      b: ["x", true, 2.5, -3, 1000],
      c: { d: "text" },
      e: "0x1F",
    });
  });

  it("keeps a date as its text and a key named __proto__ as data", () => {
    const result = readYaml("f.yaml", "when: 2001-01-01\n__proto__: x\n");
    expect(result.ok && Object.keys(result.value.tree as object)).toEqual(["when", "__proto__"]);
    expect(result.ok && (result.value.tree as Record<string, unknown>)["when"]).toBe("2001-01-01");
  });

  it("allows an anchor that no alias uses", () => {
    expect(readYaml("f.yaml", "a: &x 1\n").ok).toBe(true);
  });

  it("records the position of every key and sequence item", () => {
    const result = readYaml("f.yaml", "a:\n  b:\n    - x\n    - y\n");
    expect(result.ok && result.value.positions.get("/a/b")).toEqual({ line: 2, column: 3 });
    expect(result.ok && result.value.positions.get("/a/b/1")).toEqual({ line: 4, column: 7 });
  });

  it("accepts a document exactly at the size limit and at the depth limit", () => {
    const nested = `${"[".repeat(YAML_LIMITS.maxDepth - 1)}${"]".repeat(YAML_LIMITS.maxDepth - 1)}`;
    expect(readYaml("f.yaml", `a: ${nested}\n`).ok).toBe(true);
    const padded = `a: ${"x".repeat(YAML_LIMITS.maxBytes - 4)}\n`;
    expect(new TextEncoder().encode(padded).length).toBe(YAML_LIMITS.maxBytes);
    expect(readYaml("f.yaml", padded).ok).toBe(true);
  });
});

describe("the YAML reader refuses what the Go decoder refuses", () => {
  it("duplicate keys, at the second key", () => {
    expect(refused("a: 1\nb: 2\na: 3\n")).toEqual([
      { code: "syntax.duplicate_key", pointer: "/a", line: 3, column: 1 },
    ]);
  });

  it("aliases", () => {
    expect(refused("a: &x 1\nb: *x\n")).toMatchObject([
      { code: "syntax.alias", pointer: "/b", line: 2, column: 4 },
    ]);
  });

  it("merge keys", () => {
    expect(refused("a:\n  <<: {x: 1}\n")).toMatchObject([
      { code: "syntax.merge_key", pointer: "/a/<<" },
    ]);
  });

  it("a quoted << key is an ordinary key", () => {
    expect(readYaml("f.yaml", `a:\n  "<<": 1\n`).ok).toBe(true);
  });

  it("custom tags and explicit tags outside the core set", () => {
    expect(refused("a: !secret x\n")).toMatchObject([
      { code: "syntax.custom_tag", pointer: "/a", line: 1, column: 4 },
    ]);
    expect(refused("a: !!binary AA\n")).toMatchObject([{ code: "syntax.custom_tag" }]);
    expect(readYaml("f.yaml", "a: !!str 12\n").ok).toBe(true);
  });

  it("non-string keys", () => {
    expect(refused("a:\n  1: x\n")).toMatchObject([
      { code: "syntax.non_string_key", pointer: "/a", line: 2, column: 3 },
    ]);
    expect(refused("true: x\n")).toMatchObject([{ code: "syntax.non_string_key", pointer: "" }]);
  });

  it("null in every spelling", () => {
    for (const spelling of ["null", "~", "Null", ""]) {
      expect(refused(`a: ${spelling}\n`), spelling).toMatchObject([
        { code: "syntax.null_value", pointer: "/a" },
      ]);
    }
  });

  it("numbers JSON cannot write", () => {
    for (const spelling of [".nan", ".inf", "-.inf", "0x1F", "0o17", "+5", ".5", "5."]) {
      expect(refused(`a: ${spelling}\n`), spelling).toMatchObject([
        { code: "syntax.non_json_number", pointer: "/a" },
      ]);
    }
  });

  it("more than one document, at the second", () => {
    expect(refused("a: 1\n---\nb: 2\n")).toMatchObject([
      { code: "syntax.multiple_documents", pointer: "", line: 2, column: 1 },
    ]);
  });

  it("invalid UTF-8, at the first bad byte", () => {
    const bytes = new TextEncoder().encode("a: 1\nb: caf");
    expect(refused(new Uint8Array([...bytes, 0xe9, 0x22, 0x0a]))).toMatchObject([
      { code: "syntax.invalid_encoding", line: 2, column: 7 },
    ]);
    expect(refused(new Uint8Array([...bytes, 0xe9]))).toMatchObject([
      { code: "syntax.invalid_encoding", line: 2, column: 7 },
    ]);
    expect(refused(new Uint8Array([0xff]))).toMatchObject([
      { code: "syntax.invalid_encoding", line: 1, column: 1 },
    ]);
  });

  it("YAML that does not parse, with the line and no column", () => {
    expect(refused("a: b: c\n")).toEqual([
      { code: "syntax.invalid_yaml", pointer: "", line: 1, column: undefined },
    ]);
  });

  it("a file over the size limit and collections nested past the depth limit", () => {
    expect(refused(`a: ${"x".repeat(YAML_LIMITS.maxBytes)}\n`)).toMatchObject([
      { code: "syntax.limit_exceeded", pointer: "" },
    ]);
    const deep = `${"[".repeat(YAML_LIMITS.maxDepth + 1)}${"]".repeat(YAML_LIMITS.maxDepth + 1)}`;
    expect(refused(`a: ${deep}\n`)).toMatchObject([{ code: "syntax.limit_exceeded" }]);
  });

  it("reports the file name on every diagnostic", () => {
    const result = readYaml("services/x.yaml", "a: ~\n");
    expect(!result.ok && result.error.every((item) => item.file === "services/x.yaml")).toBe(true);
  });
});
