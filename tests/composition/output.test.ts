import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bind,
  defineProject,
  encodeModel,
  input,
  port,
  readYamlFile,
  secretProviders,
  secretRef,
  service,
  writeModelFile,
} from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "sp-output-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function model(text: string) {
  return JSON.parse(text) as { spec: Record<string, unknown> };
}

describe("secrets are handles, never values", () => {
  it("emits a secret input without a value and a public input with its value", () => {
    const secret = input("db-password", { sensitivity: "secret" });
    const open = input("region", { sensitivity: "public", value: "eu-west-1" });
    const result = encodeModel(defineProject("shop", { declarations: [secret, open] }));
    expect(result.ok && model(result.value).spec["inputs"]).toEqual({
      "db-password": { sensitivity: "secret" },
      region: { sensitivity: "public", value: "eu-west-1" },
    });
  });

  it("refuses a value for a secret input that code smuggles past the types, without echoing it", () => {
    const smuggled = input("db-password", {
      sensitivity: "secret",
      value: "sp-canary-7319",
    } as never);
    const result = encodeModel(defineProject("shop", { declarations: [smuggled] }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sp-canary-7319");
    expect(!result.ok && result.error[0]?.code).toBe("structure.secret_literal");
  });

  it("accepts only a logical identifier as a secret reference and never echoes other text", () => {
    expect(secretRef("app-password").id).toBe("app-password");
    for (const value of ["sp-canary Value!", "hunter2/with/slash", "UPPER", ""]) {
      let message = "";
      try {
        secretRef(value);
      } catch (cause) {
        message = cause instanceof Error ? cause.message : "";
      }
      expect(message, value).not.toBe("");
      expect(message).not.toContain(value === "" ? "\u0000" : value);
    }
  });
});

describe("empty members are omitted as the Go encoder omits them", () => {
  it("leaves out empty environment, listeners, exports, dependencies and volumes", () => {
    const api = service("api", {
      image: "ghcr.io/example/api:1",
      environment: {},
      listeners: {},
      exports: {},
      dependencies: {},
      volumes: {},
      command: [],
    });
    const result = encodeModel(defineProject("shop", { declarations: [api] }));
    expect(
      result.ok && (model(result.value).spec["objects"] as { spec: unknown }[])[0]?.spec,
    ).toEqual({ type: "service", image: "ghcr.io/example/api:1" });
    expect(result.ok && Object.keys(model(result.value).spec)).toEqual(["objects"]);
  });

  it("sorts exposures and drops empty override sections", () => {
    const api = service("api", {
      image: "a:1",
      listeners: {
        http: { port: port(80), protocol: "http" },
        admin: { port: port(81), protocol: "http" },
      },
      exports: {
        http: { capability: "http.api/1", listener: "http" },
        admin: { capability: "http.admin/1", listener: "admin" },
      },
    });
    const env = environment("local", {
      context: "desktop-linux",
      secrets: secretProviders.local,
      exposures: [{ source: api.exports.http, port: port(8080) }, { source: api.exports.admin }],
      workloadOverrides: [],
    });
    const result = encodeModel(defineProject("shop", { declarations: [api], environments: [env] }));
    const environments = result.ok
      ? (model(result.value).spec["environments"] as Record<string, unknown>)
      : {};
    expect(environments["local"]).toEqual({
      runtime: { type: "compose", context: "desktop-linux" },
      secrets: { provider: "local" },
      exposures: [
        { source: { object: "workload/api", export: "admin" } },
        { source: { object: "workload/api", export: "http" }, port: 8080 },
      ],
    });
  });

  it("orders objects by kind then key and bindings by reference", () => {
    const db = service("db", {
      image: "d:1",
      listeners: { sql: { port: port(5432), protocol: "tcp" } },
      exports: { sql: { capability: "sql.db/1", listener: "sql" } },
    });
    const a = service("a", { image: "a:1", dependencies: { db: "sql.db/1" } });
    const ab = service("a-b", { image: "a:2", dependencies: { db: "sql.db/1" } });
    const result = encodeModel(
      defineProject("shop", {
        declarations: [db, ab, a],
        bindings: [bind(ab, "db", db.exports.sql), bind(a, "db", db.exports.sql)],
      }),
    );
    const spec = result.ok ? model(result.value).spec : {};
    expect((spec["objects"] as { key: string }[]).map((item) => item.key)).toEqual([
      "a",
      "a-b",
      "db",
    ]);
    // "binding/workload/a-b/db" sorts before "binding/workload/a/db" because "-" is before "/".
    expect((spec["bindings"] as { consumer: string }[]).map((item) => item.consumer)).toEqual([
      "workload/a-b",
      "workload/a",
    ]);
  });
});

describe("writing the model file", () => {
  it("writes exactly the encoded bytes where the caller says", async () => {
    const project = defineProject("shop", { declarations: [service("api", { image: "a:1" })] });
    const encoded = encodeModel(project);
    const path = join(scratch, "model.json");
    const written = await writeModelFile(project, path);
    expect(written.ok).toBe(true);
    expect(encoded.ok && readFileSync(path, "utf8")).toBe(encoded.ok ? encoded.value : "");
  });

  it("writes nothing for a project with problems", async () => {
    const path = join(scratch, "model.json");
    const written = await writeModelFile(
      defineProject("shop", { declarations: [service("Bad", { image: "a:1" })] }),
      path,
    );
    expect(written.ok).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it("honours an aborted signal and reports it", async () => {
    const path = join(scratch, "model.json");
    const controller = new AbortController();
    controller.abort();
    const written = await writeModelFile(
      defineProject("shop", { declarations: [service("api", { image: "a:1" })] }),
      path,
      { signal: controller.signal },
    );
    expect(!written.ok && written.error[0]?.code).toBe("sdk.cancelled");
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it("keeps the previous file whole when a later write is cancelled", async () => {
    const path = join(scratch, "model.json");
    writeFileSync(path, "previous\n");
    const controller = new AbortController();
    controller.abort();
    const written = await writeModelFile(
      defineProject("shop", { declarations: [service("api", { image: "a:1" })] }),
      path,
      { signal: controller.signal },
    );
    expect(written.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("previous\n");
    expect(readdirSync(scratch)).toEqual(["model.json"]);
  });

  it("reports an unwritable path without the path's contents", async () => {
    const written = await writeModelFile(
      defineProject("shop", { declarations: [service("api", { image: "a:1" })] }),
      join(scratch, "missing", "model.json"),
    );
    expect(!written.ok && written.error[0]?.code).toBe("sdk.write_failed");
  });
});

describe("reading YAML files", () => {
  const fragment =
    "apiVersion: stackpuddle/v1\nkind: Fragment\nspec:\n  workloads:\n    api: {type: service, image: a:1}\n";

  it("records the file name relative to the composition root", async () => {
    mkdirSync(join(scratch, "services"));
    writeFileSync(join(scratch, "services/w.yaml"), fragment);
    const read = await readYamlFile(join(scratch, "services/w.yaml"), { root: scratch });
    expect(read.ok && read.value.file).toBe("services/w.yaml");
    expect(read.ok && read.value.declarations[0]?.origin).toEqual({
      kind: "yaml",
      file: "services/w.yaml",
      line: 5,
      column: 5,
    });
  });

  it("refuses a path outside the root and a missing file", async () => {
    const outside = await readYamlFile("../elsewhere.yaml", { root: scratch });
    expect(!outside.ok && outside.error[0]?.code).toBe("sdk.path_outside_root");
    const missing = await readYamlFile("nope.yaml", { root: scratch });
    expect(!missing.ok && missing.error[0]?.code).toBe("reference.path_not_found");
  });

  it("reports a cancelled read as cancelled, not as a missing file", async () => {
    writeFileSync(join(scratch, "w.yaml"), fragment);
    const controller = new AbortController();
    controller.abort();
    const read = await readYamlFile("w.yaml", { root: scratch, signal: controller.signal });
    expect(!read.ok && read.error[0]?.code).toBe("sdk.cancelled");
  });

  it("gives a path that exists but cannot be read its own code", async () => {
    mkdirSync(join(scratch, "dir.yaml"));
    const read = await readYamlFile("dir.yaml", { root: scratch });
    expect(!read.ok && read.error[0]?.code).toBe("sdk.not_a_regular_file");
  });

  it("refuses a symlink below the root that points outside it", async () => {
    const outside = mkdtempSync(join(tmpdir(), "sp-outside-"));
    try {
      writeFileSync(join(outside, "w.yaml"), fragment);
      symlinkSync(join(outside, "w.yaml"), join(scratch, "link.yaml"));
      const read = await readYamlFile("link.yaml", { root: scratch });
      expect(!read.ok && read.error[0]?.code).toBe("sdk.path_outside_root");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a non-regular file without reading it", async () => {
    symlinkSync("/dev/zero", join(scratch, "zero.yaml"));
    const read = await readYamlFile("zero.yaml", { root: scratch });
    expect(!read.ok && read.error[0]?.code).toMatch(/sdk\.(path_outside_root|not_a_regular_file)/);
  });

  it("refuses a file over 1 MiB before reading it", async () => {
    writeFileSync(join(scratch, "big.yaml"), `a: ${"x".repeat(1_048_577)}\n`);
    const read = await readYamlFile("big.yaml", { root: scratch });
    expect(!read.ok && read.error[0]?.code).toBe("syntax.limit_exceeded");
  });

  it("reports syntax problems with the relative file name", async () => {
    writeFileSync(join(scratch, "bad.yaml"), "a: 1\na: 2\n");
    const read = await readYamlFile("bad.yaml", { root: scratch });
    expect(!read.ok && read.error[0]).toMatchObject({
      code: "syntax.duplicate_key",
      file: "bad.yaml",
      line: 2,
    });
  });
});
