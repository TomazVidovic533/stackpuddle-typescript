import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineProject,
  encodeModel,
  input,
  secretProviders,
  service,
  writeModelFile,
} from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";

import { fragmentOf } from "./support.js";

const CANARY = "sp-canary-4417";

let scratch = "";
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "sp-secret-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const EXPECTED = [["structure.secret_literal", "/spec/environments/local/inputs/token/value"]];

function sdkProject() {
  const token = input("token", { sensitivity: "secret" });
  const env = environment("local", {
    context: "desktop-linux",
    secrets: secretProviders.local,
    // @ts-expect-error a secret input takes no literal; the cast below defeats it for the runtime check
    inputs: [{ input: token, value: CANARY }],
  });
  return defineProject("shop", {
    declarations: [token, service("api", { image: "a:1" })],
    environments: [env],
  });
}

function yamlProject() {
  const token = input("token", { sensitivity: "secret" });
  const fragment = fragmentOf(
    "env.yaml",
    `apiVersion: stackpuddle/v1\nkind: Fragment\nspec:\n  environments:\n    local:\n      runtime: {type: compose, context: c}\n      secrets: {provider: local}\n      inputs:\n        token: {value: ${CANARY}}\n`,
  );
  return defineProject("shop", { declarations: [token], imports: [fragment] });
}

describe.each([
  ["declared in code", sdkProject],
  ["imported from YAML", yamlProject],
])("a literal for a secret input %s", (_name, build) => {
  it("is refused without echoing the value", () => {
    const result = encodeModel(build());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.map((item) => [item.code, item.pointer])).toEqual(EXPECTED);
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });

  it("is never written to disk", async () => {
    const path = join(scratch, "model.json");
    const written = await writeModelFile(build(), path);
    expect(written.ok).toBe(false);
    expect(JSON.stringify(written)).not.toContain(CANARY);
    expect(existsSync(path)).toBe(false);
    expect(readFileSyncOrEmpty(scratch)).not.toContain(CANARY);
  });
});

function readFileSyncOrEmpty(dir: string): string {
  const path = join(dir, "model.json");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("a literal for a public input", () => {
  it("is still accepted", () => {
    const region = input("region", { sensitivity: "public" });
    const env = environment("local", {
      context: "c",
      secrets: secretProviders.local,
      inputs: [{ input: region, value: "eu-west-1" }],
    });
    expect(
      encodeModel(defineProject("shop", { declarations: [region], environments: [env] })).ok,
    ).toBe(true);
  });
});
