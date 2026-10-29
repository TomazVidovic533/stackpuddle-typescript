import { describe, expect, it } from "vitest";

import {
  application,
  bind,
  defineProject,
  encodeModel,
  exportOf,
  input,
  job,
  port,
  secretProviders,
  service,
} from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";

import { WORKLOADS_YAML, fragmentOf } from "./support.js";

function failures(project: Parameters<typeof encodeModel>[0]): [string, string][] {
  const result = encodeModel(project);
  expect(result.ok, "the project must not encode").toBe(false);
  return result.ok ? [] : result.error.map((item): [string, string] => [item.code, item.pointer]);
}

describe("duplicates", () => {
  it("fails a workload declared in code and again in an imported Fragment, at the later one", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const result = encodeModel(
      defineProject("shop", {
        declarations: [service("api", { image: "ghcr.io/example/api:9" })],
        imports: [fragment],
      }),
    );
    expect(!result.ok && result.error).toMatchObject([
      {
        code: "identity.duplicate_declaration",
        pointer: "/spec/workloads/api",
        file: "w.yaml",
        line: 5,
        column: 5,
      },
    ]);
  });

  it("fails two declarations in code with no file", () => {
    const result = encodeModel(
      defineProject("shop", {
        declarations: [service("api", { image: "a:1" }), service("api", { image: "a:2" })],
      }),
    );
    expect(!result.ok && result.error).toMatchObject([
      { code: "identity.duplicate_declaration", pointer: "/spec/workloads/api" },
    ]);
    expect(!result.ok && result.error[0]?.file).toBeUndefined();
  });

  it("fails an environment declared in two imports", () => {
    const one = fragmentOf(
      "a.yaml",
      "apiVersion: stackpuddle/v1\nkind: Fragment\nspec:\n  environments:\n    local: {runtime: {type: compose, context: c}, secrets: {provider: local}}\n",
    );
    const two = fragmentOf(
      "b.yaml",
      "apiVersion: stackpuddle/v1\nkind: Fragment\nspec:\n  environments:\n    local: {runtime: {type: compose, context: c}, secrets: {provider: local}}\n",
    );
    expect(failures(defineProject("shop", { imports: [one, two] }))).toEqual([
      ["identity.duplicate_declaration", "/spec/environments/local"],
    ]);
  });

  it("fails the same dependency bound twice, as a duplicate or a conflict", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const api = fragment.workload("api");
    const web = fragment.workload("web");
    const other = service("api2", {
      image: "x:1",
      listeners: { http: { port: port(80), protocol: "http" } },
      exports: { http: { capability: "http.api/1", listener: "http" } },
    });
    expect(
      failures(
        defineProject("shop", {
          imports: [fragment],
          bindings: [bind(web, "api", api.export("http")), bind(web, "api", api.export("http"))],
        }),
      ),
    ).toEqual([["binding.duplicate", "/spec/bindings/1"]]);
    expect(
      failures(
        defineProject("shop", {
          declarations: [other],
          imports: [fragment],
          bindings: [bind(web, "api", api.export("http")), bind(web, "api", other.exports.http)],
        }),
      ),
    ).toEqual([["binding.conflict", "/spec/bindings/1"]]);
  });
});

describe("references into objects the compiler cannot see", () => {
  it("fails an export the imported workload does not declare", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const wired = bind(fragment.workload("web"), "api", fragment.workload("api").export("grpc"));
    expect(failures(defineProject("shop", { imports: [fragment], bindings: [wired] }))).toEqual([
      ["reference.unknown_export", "/spec/bindings/0/source/export"],
    ]);
  });

  it("fails a dependency the imported consumer does not declare", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const wired = bind(fragment.workload("api"), "web", fragment.workload("api").export("http"));
    expect(failures(defineProject("shop", { imports: [fragment], bindings: [wired] }))).toEqual([
      ["reference.unknown_dependency", "/spec/bindings/0/dependency"],
    ]);
  });

  it("fails an incompatible capability between a typed dependency and an imported export", () => {
    const fragment = fragmentOf(
      "w.yaml",
      WORKLOADS_YAML.replace(
        "capability: http.api/1\n          listener",
        "capability: grpc.api/1\n          listener",
      ),
    );
    const wired = bind(fragment.workload("web"), "api", fragment.workload("api").export("http"));
    expect(failures(defineProject("shop", { imports: [fragment], bindings: [wired] }))).toEqual([
      ["binding.capability_mismatch", "/spec/bindings/0/source"],
    ]);
  });

  it("fails an export that names a listener the imported workload lacks", () => {
    const fragment = fragmentOf(
      "w.yaml",
      WORKLOADS_YAML.replace("listener: http\n    web", "listener: grpc\n    web"),
    );
    expect(failures(defineProject("shop", { imports: [fragment] }))).toEqual([
      ["reference.unknown_listener", "/spec/workloads/api/exports/http/listener"],
    ]);
  });

  it("fails a binding whose source object is not declared", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const wired = bind(
      fragment.workload("web"),
      "api",
      exportOf("workload/ghost", "http", "http.api/1"),
    );
    expect(failures(defineProject("shop", { imports: [fragment], bindings: [wired] }))).toEqual([
      ["reference.unknown_object", "/spec/bindings/0/source/object"],
    ]);
  });

  it("fails an application member, an input and a prerequisite that are not declared or not a job", () => {
    const api = service("api", {
      image: "a:1",
      environment: { TOKEN: input("token", { sensitivity: "secret" }) },
      prerequisites: [{ kind: "workload", key: "migrate", ref: "workload/migrate" }],
    });
    const worker = service("worker", { image: "w:1", prerequisites: [api] });
    const project = defineProject("shop", {
      declarations: [
        api,
        worker,
        application("app", [api, { kind: "workload", key: "ghost", ref: "workload/ghost" }]),
      ],
    });
    expect(failures(project)).toEqual(
      expect.arrayContaining([
        ["reference.unknown_input", "/spec/workloads/api/environment/TOKEN/input"],
        ["reference.unknown_object", "/spec/workloads/api/prerequisites/0/job"],
        ["reference.wrong_kind", "/spec/workloads/worker/prerequisites/0/job"],
        ["reference.unknown_object", "/spec/applications/app/workloads/1"],
      ]),
    );
  });

  it("accepts a job as a prerequisite and sorts the list", () => {
    const migrate = job("migrate", { image: "m:1" });
    const seed = job("seed", { image: "m:2" });
    const api = service("api", { image: "a:1", prerequisites: [seed, migrate] });
    const result = encodeModel(defineProject("shop", { declarations: [api, migrate, seed] }));
    expect(
      result.ok &&
        (
          JSON.parse(result.value) as {
            spec: { objects: { key: string; spec: { prerequisites?: unknown } }[] };
          }
        ).spec.objects.find((item) => item.key === "api")?.spec.prerequisites,
    ).toEqual([{ job: "migrate" }, { job: "seed" }]);
  });
});

describe("names and structure checked before any bytes are produced", () => {
  it("reports an invalid key from a builder when the model encodes", () => {
    expect(
      failures(defineProject("shop", { declarations: [service("Bad_Key", { image: "a:1" })] }))[0],
    ).toEqual(["structure.invalid_value", "/spec/workloads/Bad_Key"]);
  });

  it("reports an invalid project name and an invalid environment name", () => {
    const env = environment("local.compose", { context: "c", secrets: secretProviders.local });
    expect(failures(defineProject("Shop", { environments: [env] }))).toEqual(
      expect.arrayContaining([
        ["structure.invalid_value", "/metadata/name"],
        ["structure.invalid_value", "/spec/environments/local.compose"],
      ]),
    );
  });

  it("falls back to the published schema for what the builders do not check", () => {
    const result = encodeModel(
      defineProject("shop", { declarations: [service("api", { image: "NOT AN IMAGE" })] }),
    );
    expect(!result.ok && result.error.map((item) => item.code)).toEqual([
      "structure.invalid_value",
    ]);
  });
});
