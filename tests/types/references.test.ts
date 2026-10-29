import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ExportHandle,
  application,
  bind,
  input,
  job,
  parseCapability,
  port,
  service,
  supportsCapability,
} from "@stackpuddle/sdk";
import { secretProviders, secretRef } from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";
import {
  database,
  migrationUser,
  permissionRole,
  runtimeUser,
  schema,
} from "@stackpuddle/sdk/postgres";

const api = service("api", {
  image: "ghcr.io/example/api:1",
  listeners: {
    http: { port: port(8080), protocol: "http" },
    admin: { port: port(8081), protocol: "http" },
  },
  exports: { http: { capability: "http.api/1", listener: "http" } },
});
const web = service("web", {
  image: "ghcr.io/example/web:1",
  dependencies: { api: "http.api/1", cache: "cache.kv/1" },
});

describe("what compiles", () => {
  it("types an export handle by the capability it serves", () => {
    expectTypeOf(api.exports.http).toEqualTypeOf<ExportHandle<"http.api/1">>();
    expectTypeOf(web.dependencies.api).toEqualTypeOf<"http.api/1">();
    expect(bind(web, "api", api.exports.http).kind).toBe("binding");
  });

  it("accepts a job as a prerequisite and a workload in an application", () => {
    const migrate = job("migrate", { image: "m:1" });
    expect(service("worker", { image: "w:1", prerequisites: [migrate] }).ref).toBe(
      "workload/worker",
    );
    expect(application("backend", [api, web]).kind).toBe("application");
  });
});

describe("what must not compile", () => {
  it("rejects an export that names an undeclared listener", () => {
    const declare = () =>
      service("bad", {
        image: "a:1",
        listeners: { http: { port: port(80), protocol: "http" } },
        // @ts-expect-error the listener grpc is not declared in listeners
        exports: { rpc: { capability: "grpc.api/1", listener: "grpc" } },
      });
    expect(declare).toBeTypeOf("function");
  });

  it("rejects an export on a workload with no listeners", () => {
    const declare = () =>
      service("bad", {
        image: "a:1",
        // @ts-expect-error a workload without listeners has none to export
        exports: { rpc: { capability: "grpc.api/1", listener: "grpc" } },
      });
    expect(declare).toBeTypeOf("function");
  });

  it("rejects reading an export the workload does not declare", () => {
    const read = (): unknown => {
      // @ts-expect-error api declares the export http, not grpc
      const missing: unknown = api.exports.grpc;
      return missing;
    };
    expect(read).toBeTypeOf("function");
  });

  it("rejects a binding whose source serves another capability", () => {
    const other = service("other", {
      image: "o:1",
      listeners: { kv: { port: port(6379), protocol: "tcp" } },
      exports: { kv: { capability: "cache.kv/1", listener: "kv" } },
    });
    const wire = () =>
      // @ts-expect-error the dependency api needs http.api/1 and this export serves cache.kv/1
      bind(web, "api", other.exports.kv);
    expect(wire).toBeTypeOf("function");
  });

  it("rejects a binding to a dependency the consumer does not declare", () => {
    // @ts-expect-error web declares the dependencies api and cache, not database
    const wire = () => bind(web, "database", api.exports.http);
    expect(wire).toBeTypeOf("function");
  });

  it("rejects a runtime user as a database owner", () => {
    const writer = permissionRole("writer");
    const runtime = runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] });
    const declare = () =>
      database("shop", {
        // @ts-expect-error only a migration user can own a database
        owner: runtime,
        connectRoles: [writer],
        schemas: [schema("public", [{ role: writer, tables: ["SELECT"] }])],
      });
    expect(declare).toBeTypeOf("function");
    expect(migrationUser("m", { password: secretRef("m-password") }).purpose).toBe("migrations");
  });

  it("rejects a privilege outside the closed set", () => {
    const writer = permissionRole("writer");
    // @ts-expect-error TRUNCATE is not a table privilege the module allows
    const grant = () => schema("public", [{ role: writer, tables: ["TRUNCATE"] }]);
    expect(grant).toBeTypeOf("function");
  });

  it("rejects a grant that grants nothing", () => {
    const writer = permissionRole("writer");
    // @ts-expect-error a grant names tables or sequences
    const grant = () => schema("public", [{ role: writer }]);
    expect(grant).toBeTypeOf("function");
  });

  it("rejects a raw string where a branded capability is required", () => {
    // @ts-expect-error a string must go through parseCapability first
    const check = () => supportsCapability("http.api/1");
    expect(check).toBeTypeOf("function");
    const parsed = parseCapability("http.api/1");
    expect(parsed.ok && supportsCapability(parsed.value)).toBe(false);
  });

  it("rejects assigning to a declaration", () => {
    const assign = () => {
      // @ts-expect-error declarations are readonly
      api.key = "other";
    };
    expect(assign).toBeTypeOf("function");
  });

  it("rejects a secret input that carries a value", () => {
    // @ts-expect-error a secret input never takes a value in code
    const declare = () => input("token", { sensitivity: "secret", value: "x" });
    expect(declare).toBeTypeOf("function");
  });

  it("rejects a literal value for a secret input in an environment", () => {
    const token = input("token", { sensitivity: "secret" });
    const region = input("region", { sensitivity: "public" });
    const ok = () =>
      environment("local", {
        context: "c",
        secrets: secretProviders.local,
        inputs: [{ input: region, value: "eu-west-1" }],
      });
    const declare = () =>
      environment("local", {
        context: "c",
        secrets: secretProviders.local,
        // @ts-expect-error a secret input never takes a literal value
        inputs: [{ input: token, value: "x" }],
      });
    expect(ok).toBeTypeOf("function");
    expect(declare).toBeTypeOf("function");
  });

  it("rejects an image together with a build", () => {
    // @ts-expect-error a workload is built or pulled, never both
    const declare = () => service("both", { image: "a:1", build: { context: "." } });
    expect(declare).toBeTypeOf("function");
  });

  it("rejects an unknown file mode", () => {
    const wire = () =>
      bind(web, "api", api.exports.http, {
        // @ts-expect-error 0777 is not a mode the model allows
        delivery: { files: { cert: { path: "/etc/cert", mode: "0777" } } },
      });
    expect(wire).toBeTypeOf("function");
  });
});
