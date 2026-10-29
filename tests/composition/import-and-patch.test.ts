import { describe, expect, it } from "vitest";

import { bind, defineProject, encodeModel, patchWorkload, service } from "@stackpuddle/sdk";

import { ENVIRONMENT_YAML, WORKLOADS_YAML, fragmentOf } from "./support.js";

function modelOf(project: Parameters<typeof encodeModel>[0]) {
  const result = encodeModel(project);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return JSON.parse(result.value) as {
    spec: { objects: { key: string; spec: Record<string, unknown> }[] };
    provenance: Record<
      string,
      { declared: Record<string, unknown>; patched?: { origin: string; fields: string[] }[] }
    >;
  };
}

describe("YAML import with typed patches", () => {
  it("keeps the YAML identity and position and records the patched fields", () => {
    const fragment = fragmentOf("services/workloads.yaml", WORKLOADS_YAML);
    const patch = patchWorkload(fragment.workload("api"), { image: "ghcr.io/example/api:1.5.0" });
    const model = modelOf(defineProject("shop", { imports: [fragment], patches: [patch] }));

    const api = model.spec.objects.find((item) => item.key === "api");
    expect(api?.spec["image"]).toBe("ghcr.io/example/api:1.5.0");
    expect(model.provenance["workload/api"]).toEqual({
      declared: { origin: "yaml", file: "services/workloads.yaml", line: 5, column: 5 },
      patched: [{ origin: "sdk", fields: ["/spec/image"] }],
    });
    expect(model.provenance["workload/web"]?.patched).toBeUndefined();
  });

  it("patches environment variables by key and lists each one as a field", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const patch = patchWorkload(fragment.workload("api"), {
      environment: { LOG_LEVEL: "debug", EXTRA: "1" },
      command: ["./api", "serve"],
    });
    const model = modelOf(defineProject("shop", { imports: [fragment], patches: [patch] }));
    const api = model.spec.objects.find((item) => item.key === "api");
    expect(api?.spec["environment"]).toEqual({ EXTRA: "1", LOG_LEVEL: "debug" });
    expect(model.provenance["workload/api"]?.patched?.[0]?.fields).toEqual([
      "/spec/command",
      "/spec/environment/EXTRA",
      "/spec/environment/LOG_LEVEL",
    ]);
  });

  it("records every patch in the order it was applied", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const first = patchWorkload(fragment.workload("api"), { image: "ghcr.io/example/api:1.5.0" });
    const second = patchWorkload(fragment.workload("api"), { command: ["./api"] });
    const model = modelOf(defineProject("shop", { imports: [fragment], patches: [first, second] }));
    expect(model.provenance["workload/api"]?.patched?.map((entry) => entry.fields)).toEqual([
      ["/spec/image"],
      ["/spec/command"],
    ]);
  });

  it("does not change the fragment, so one import can feed two projects", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const patch = patchWorkload(fragment.workload("api"), { image: "ghcr.io/example/api:9.9.9" });
    modelOf(defineProject("one", { imports: [fragment], patches: [patch] }));
    const plain = modelOf(defineProject("two", { imports: [fragment] }));
    expect(plain.spec.objects.find((item) => item.key === "api")?.spec["image"]).toBe(
      "ghcr.io/example/api:1.4.2",
    );
  });

  it("fails a patch of an object no imported Fragment declares", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const patch = patchWorkload(fragment.workload("ghost"), { image: "ghcr.io/example/ghost:1" });
    const result = encodeModel(defineProject("shop", { imports: [fragment], patches: [patch] }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.map((item) => [item.code, item.pointer])).toEqual([
      ["reference.unknown_object", "/spec/workloads/ghost"],
    ]);
  });

  it("does not patch a declaration written in code", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const own = service("ghost", { image: "ghcr.io/example/ghost:1" });
    const patch = patchWorkload(fragment.workload("ghost"), { image: "ghcr.io/example/ghost:2" });
    const result = encodeModel(
      defineProject("shop", { declarations: [own], imports: [fragment], patches: [patch] }),
    );
    expect(!result.ok && result.error[0]?.code).toBe("reference.unknown_object");
  });

  it("fails a patch member the SDK does not support instead of dropping it", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const patch = patchWorkload(fragment.workload("api"), {
      image: "ghcr.io/example/api:2",
      replicas: 3,
    } as never);
    const result = encodeModel(defineProject("shop", { imports: [fragment], patches: [patch] }));
    expect(!result.ok && result.error.map((item) => [item.code, item.pointer])).toEqual([
      ["sdk.unsupported_field", "/spec/replicas"],
    ]);
  });

  it("replaces a build with the patched image and says so in the fields", () => {
    const fragment = fragmentOf(
      "b.yaml",
      "apiVersion: stackpuddle/v1\nkind: Fragment\nspec:\n  workloads:\n    api:\n      type: service\n      build:\n        context: services/api\n",
    );
    const patch = patchWorkload(fragment.workload("api"), { image: "ghcr.io/example/api:2" });
    const model = modelOf(defineProject("shop", { imports: [fragment], patches: [patch] }));
    expect(model.spec.objects[0]?.spec).toEqual({
      type: "service",
      image: "ghcr.io/example/api:2",
    });
    expect(model.provenance["workload/api"]?.patched?.[0]?.fields).toEqual([
      "/spec/build",
      "/spec/image",
    ]);
  });
});

describe("explicit composition", () => {
  it("composes only what the root names", () => {
    const fragment = fragmentOf("w.yaml", WORKLOADS_YAML);
    const environments = fragmentOf("e.yaml", ENVIRONMENT_YAML);
    const api = fragment.workload("api");
    const web = fragment.workload("web");
    const wired = bind(web, "api", api.export("http"));
    const model = modelOf(
      defineProject("shop", { imports: [fragment, environments], bindings: [wired] }),
    );
    expect(Object.keys(model.provenance).sort()).toEqual([
      "binding/workload/web/api",
      "env/local",
      "workload/api",
      "workload/web",
    ]);
    expect(model.provenance["binding/workload/web/api"]?.declared).toEqual({ origin: "sdk" });
  });
});
