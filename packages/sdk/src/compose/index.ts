import type { DeclarationHandle, ExportHandle, WorkloadRef } from "../model/declarations.js";
import { type JsonObject, deepFreeze } from "../model/json.js";
import type { ModuleInstanceHandle } from "../model/module.js";
import { parseEnvKey, parseObjectKey, parseScopeName } from "../model/names.js";
import type { Port } from "../model/quantities.js";
import { type Diagnostic, pointerOf } from "../model/result.js";
import type { SecretProvider } from "../model/secrets.js";
import { type EnvironmentValues, type InputHandle, environmentJson } from "../model/workload.js";

/** Where one input gets its value in an environment. At least one source is required. */
type InputWhere = {
  readonly local?: { readonly file: string; readonly key: string };
  readonly process?: string;
};

/** A literal value is allowed for a public input only; a secret input is read from elsewhere. */
export type InputSource =
  | (InputWhere & { readonly input: InputHandle<"public">; readonly value?: string })
  | (InputWhere & { readonly input: InputHandle<"secret">; readonly value?: never });

export type Exposure = {
  readonly source: ExportHandle;
  /** A loopback host port from 1024 up; absent means one is assigned at run time. */
  readonly port?: Port;
};

export type EnvironmentSpec = {
  /** The Docker context the environment runs in. There is no default. */
  readonly context: string;
  readonly secrets: SecretProvider;
  readonly inputs?: readonly InputSource[];
  readonly workloadOverrides?: readonly {
    readonly workload: WorkloadRef;
    readonly environment: EnvironmentValues;
  }[];
  readonly moduleOverrides?: readonly {
    readonly module: ModuleInstanceHandle;
    readonly options: JsonObject;
  }[];
  readonly exposures?: readonly Exposure[];
  readonly description?: string;
};

function inputJson(source: InputSource): JsonObject {
  return {
    ...(source.value === undefined ? {} : { value: source.value }),
    ...(source.local === undefined
      ? {}
      : { local: { file: source.local.file, key: source.local.key } }),
    ...(source.process === undefined ? {} : { process: source.process }),
  };
}

function problemsOf(name: string, spec: EnvironmentSpec): Diagnostic[] {
  const base = pointerOf("spec", "environments", name);
  const found: Diagnostic[] = [];
  const parsedName = parseScopeName(name);
  if (!parsedName.ok) {
    found.push({ ...parsedName.error, pointer: base });
  }
  for (const source of spec.inputs ?? []) {
    const parsed = parseObjectKey(source.input.key);
    if (!parsed.ok) {
      found.push({ ...parsed.error, pointer: `${base}/inputs/${source.input.key}` });
    }
    const process = source.process === undefined ? undefined : parseEnvKey(source.process);
    if (process?.ok === false) {
      found.push({ ...process.error, pointer: `${base}/inputs/${source.input.key}/process` });
    }
  }
  return found;
}

/**
 * Declares a Docker Compose environment: the context it runs in, the secret provider, where each
 * input gets its value, per-environment overrides and exposed exports.
 */
export function environment(name: string, spec: EnvironmentSpec): DeclarationHandle {
  const inputs = Object.fromEntries(
    (spec.inputs ?? []).map((source) => [source.input.key, inputJson(source)]),
  );
  const workloads = Object.fromEntries(
    (spec.workloadOverrides ?? []).map((entry) => [
      entry.workload.key,
      { environment: environmentJson(entry.environment) },
    ]),
  );
  const modules = Object.fromEntries(
    (spec.moduleOverrides ?? []).map((entry) => [entry.module.key, { options: entry.options }]),
  );
  return deepFreeze({
    kind: "environment",
    declaration: {
      kind: "environment",
      key: name,
      spec: {
        runtime: { type: "compose", context: spec.context },
        secrets: { provider: spec.secrets.id },
        ...(spec.exposures === undefined
          ? {}
          : {
              exposures: spec.exposures.map((exposure) => ({
                source: { object: exposure.source.object, export: exposure.source.name },
                ...(exposure.port === undefined ? {} : { port: exposure.port }),
              })),
            }),
        inputs,
        overrides: { workloads, modules },
      },
      ...(spec.description === undefined ? {} : { description: spec.description }),
      origin: { kind: "sdk" },
      patches: [],
      problems: problemsOf(name, spec),
    },
  });
}
