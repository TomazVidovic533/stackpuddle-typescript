import { defineProject, port, secretProviders, secretRef, service } from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";
import {
  database,
  instance,
  migrationUser,
  permissionRole,
  runtimeUser,
  schema,
} from "@stackpuddle/sdk/postgres";

import type { CaseHalf } from "../support/case.js";

/** One service, one PostgreSQL instance and one environment, declared with typed constructors. */
const half: CaseHalf = () => {
  const api = service("api", {
    image: "ghcr.io/example/api:1.4.2",
    environment: { LOG_LEVEL: "info" },
    listeners: { http: { port: port(8080), protocol: "http" } },
  });

  const writer = permissionRole("writer");
  const migrator = migrationUser("migrator", { password: secretRef("migrator-password") });
  const primary = instance("primary", {
    users: [
      runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] }),
      migrator,
    ],
    roles: [writer],
    databases: [
      database("shop", {
        owner: migrator,
        connectRoles: [writer],
        schemas: [
          schema("public", [{ role: writer, tables: ["SELECT", "INSERT"], sequences: ["USAGE"] }]),
        ],
      }),
    ],
  });

  const local = environment("local", { context: "desktop-linux", secrets: secretProviders.local });

  return Promise.resolve(
    defineProject("shop", { declarations: [api, primary], environments: [local] }),
  );
};

export default half;

/** Every object is declared in code; the YAML half declares the same objects in YAML. */
export const inCode = "all";
