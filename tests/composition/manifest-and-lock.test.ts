import { describe, expect, it } from "vitest";

import { defineProject, encodeModel, secretRef } from "@stackpuddle/sdk";
import {
  database,
  instance,
  migrationUser,
  permissionRole,
  runtimeUser,
  schema,
} from "@stackpuddle/sdk/postgres";

function primary() {
  const writer = permissionRole("writer");
  const migrator = migrationUser("migrator", { password: secretRef("migrator-password") });
  return instance("primary", {
    users: [
      runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] }),
      migrator,
    ],
    roles: [writer],
    databases: [
      database("shop", {
        owner: migrator,
        connectRoles: [writer],
        schemas: [schema("public", [{ role: writer, tables: ["SELECT"] }])],
      }),
    ],
  });
}

function specOf(text: string): Record<string, unknown> {
  return (JSON.parse(text) as { spec: Record<string, unknown> }).spec;
}

describe("a project names its manifest and lock", () => {
  it("emits the manifest and lock paths by value", () => {
    const result = encodeModel(
      defineProject("shop", {
        declarations: [primary()],
        manifest: "stackpuddle.manifest.yaml",
        lock: "stackpuddle.lock",
      }),
    );
    const spec = result.ok ? specOf(result.value) : {};
    expect(result.ok).toBe(true);
    expect(spec["manifest"]).toBe("stackpuddle.manifest.yaml");
    expect(spec["lock"]).toBe("stackpuddle.lock");
  });

  it("emits neither key when the project names neither", () => {
    const result = encodeModel(defineProject("shop", { declarations: [primary()] }));
    const spec = result.ok ? specOf(result.value) : { manifest: "missing result" };
    expect(result.ok).toBe(true);
    expect(Object.keys(spec)).not.toContain("manifest");
    expect(Object.keys(spec)).not.toContain("lock");
  });

  it.each(
    (["manifest", "lock"] as const).flatMap((field) =>
      ["../stackpuddle.manifest.yaml", "/etc/stackpuddle.lock", ""].map(
        (path) => [field, path] as const,
      ),
    ),
  )("refuses %s %j and produces no model", (field, path) => {
    const result = encodeModel(defineProject("shop", { [field]: path }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.map((d) => [d.code, d.pointer])).toContainEqual([
      "structure.invalid_value",
      `/spec/${field}`,
    ]);
  });
});
