import { describe, expect, it } from "vitest";

import {
  defineProject,
  encodeModel,
  secretRef,
  cpus,
  mebibytes,
  milliseconds,
  port,
  seconds,
} from "@stackpuddle/sdk";
import {
  database,
  instance,
  migrationUser,
  permissionRole,
  runtimeUser,
  schema,
} from "@stackpuddle/sdk/postgres";

const writer = permissionRole("writer");
const migrator = migrationUser("migrator", { password: secretRef("migrator-password") });
const app = runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] });

function optionsOf(handle: ReturnType<typeof instance>) {
  const result = encodeModel(defineProject("shop", { declarations: [handle] }));
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  const objects = (
    JSON.parse(result.value) as {
      spec: { objects: { spec: { definition: string; options: unknown } }[] };
    }
  ).spec.objects;
  return objects[0]?.spec;
}

describe("the postgres instance builder", () => {
  it("encodes users, roles, databases and grants as the module's option schema names them", () => {
    const handle = instance("primary", {
      users: [app, migrator],
      roles: [writer],
      databases: [
        database("shop", {
          owner: migrator,
          connectRoles: [writer],
          schemas: [
            schema("public", [
              { role: writer, tables: ["SELECT", "UPDATE"], sequences: ["USAGE", "SELECT"] },
            ]),
          ],
          connectionLimit: -1,
          settings: { statementTimeout: milliseconds(30_000) },
          userSettings: [{ user: app, timeouts: { lockTimeout: milliseconds(500) } }],
        }),
      ],
      resources: { memory: mebibytes(1024), cpus: cpus(1.5) },
      hostAccess: { enabled: true, port: port(5432) },
      startupTimeout: seconds(60),
      settings: { maxConnections: 100, sharedBuffers: mebibytes(128) },
    });
    expect(optionsOf(handle)).toEqual({
      definition: "postgres",
      options: {
        users: {
          app: { purpose: "runtime", passwordSecretRef: "app-password", memberOf: ["writer"] },
          migrator: { purpose: "migrations", passwordSecretRef: "migrator-password" },
        },
        roles: { writer: { login: false } },
        databases: {
          shop: {
            owner: "migrator",
            connectRoles: ["writer"],
            schemas: {
              public: {
                grants: {
                  writer: { tables: ["SELECT", "UPDATE"], sequences: ["USAGE", "SELECT"] },
                },
              },
            },
            connectionLimit: -1,
            settings: { statementTimeoutMs: 30_000 },
            userSettings: { app: { lockTimeoutMs: 500 } },
          },
        },
        resources: { memoryMiB: 1024, cpus: 1.5 },
        hostAccess: { enabled: true, port: 5432 },
        startupTimeoutSeconds: 60,
        settings: { maxConnections: 100, sharedBuffersMiB: 128 },
      },
    });
  });

  it("writes a secret reference as its logical identifier only", () => {
    const text = JSON.stringify(
      optionsOf(
        instance("primary", {
          users: [app, migrator],
          roles: [writer],
          databases: [
            database("shop", {
              owner: migrator,
              connectRoles: [writer],
              schemas: [schema("public", [{ role: writer, tables: ["SELECT"] }])],
            }),
          ],
        }),
      ),
    );
    expect(text).toContain('"passwordSecretRef":"app-password"');
    expect(text).not.toContain('password":{');
  });

  it("reports a name declared twice instead of letting one win", () => {
    const handle = instance("primary", {
      users: [app, app, migrator],
      roles: [writer],
      databases: [
        database("shop", {
          owner: migrator,
          connectRoles: [writer],
          schemas: [schema("public", [{ role: writer, tables: ["SELECT"] }])],
        }),
      ],
    });
    const result = encodeModel(defineProject("shop", { declarations: [handle] }));
    expect(!result.ok && result.error.map((item) => [item.code, item.pointer])).toEqual([
      ["identity.duplicate_declaration", "/spec/modules/primary/options/users/app"],
    ]);
  });

  it("reports an identifier PostgreSQL would not accept", () => {
    const bad = permissionRole("pg_admin");
    const handle = instance("primary", {
      users: [migrator],
      roles: [bad],
      databases: [
        database("shop", {
          owner: migrator,
          connectRoles: [bad],
          schemas: [schema("public", [{ role: bad, tables: ["SELECT"] }])],
        }),
      ],
    });
    const result = encodeModel(defineProject("shop", { declarations: [handle] }));
    expect(!result.ok && result.error.map((item) => [item.code, item.pointer])).toContainEqual([
      "structure.invalid_value",
      "/spec/modules/primary/options/roles/pg_admin",
    ]);
  });

  it("does not run the module's semantic rules, which belong to the Go validator", () => {
    const stranger = permissionRole("stranger");
    const handle = instance("primary", {
      users: [migrator],
      roles: [writer],
      databases: [
        database("shop", {
          owner: migrator,
          connectRoles: [stranger],
          schemas: [schema("public", [{ role: stranger, tables: ["SELECT"] }])],
        }),
      ],
    });
    expect(encodeModel(defineProject("shop", { declarations: [handle] })).ok).toBe(true);
  });
});
