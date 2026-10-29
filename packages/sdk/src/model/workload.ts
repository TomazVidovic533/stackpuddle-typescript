import type {
  Declaration,
  DependencySpecs,
  ExportHandle,
  NoDependencies,
  WorkloadRef,
} from "./declarations.js";
import { type JsonObject, type JsonValue, deepFreeze } from "./json.js";
import { parseCapability, parseEnvKey, parseObjectKey } from "./names.js";
import type { Port } from "./quantities.js";
import { type Diagnostic, type Result, pointerOf, pointerUnder } from "./result.js";

/** What a listener accepts. */
export type ListenerSpec = { readonly port: Port; readonly protocol: string };

export type ValueSensitivity = "public" | "secret";

/** One exported capability, served by a declared listener. */
export type ExportSpec<Listener extends string> = {
  readonly capability: string;
  readonly listener: NoInfer<Listener>;
  readonly values?: Readonly<Record<string, ValueSensitivity>>;
};

export type ExportSpecs<Listener extends string> = Readonly<Record<string, ExportSpec<Listener>>>;

/** A reference to an input; environment variables take it instead of a literal. */
export type InputHandle<Sensitivity extends ValueSensitivity = ValueSensitivity> = {
  readonly kind: "input";
  readonly key: string;
  readonly sensitivity: Sensitivity;
  readonly declaration: Declaration;
};

export type EnvironmentValue = string | InputHandle;
export type EnvironmentValues = Readonly<Record<string, EnvironmentValue>>;

/** A job a workload waits for. */
export type JobRef = { readonly kind: "workload"; readonly key: string; readonly ref: string };

type BuildSpec = {
  readonly context: string;
  readonly dockerfile?: string;
  readonly target?: string;
};

/** An artifact is an image reference or a build, never both. */
export type ArtifactSpec =
  | { readonly image: string; readonly build?: never }
  | { readonly build: BuildSpec; readonly image?: never };

type CommonSpec<Dependencies extends DependencySpecs> = {
  readonly command?: readonly string[];
  readonly environment?: EnvironmentValues;
  readonly dependencies?: Dependencies;
  readonly volumes?: Readonly<Record<string, { readonly path: string }>>;
  readonly prerequisites?: readonly JobRef[];
  readonly description?: string;
};

export type ServiceSpec<
  Listener extends string,
  Exports extends ExportSpecs<Listener>,
  Dependencies extends DependencySpecs,
> = ArtifactSpec &
  CommonSpec<Dependencies> & {
    readonly listeners?: Readonly<Record<Listener, ListenerSpec>>;
    readonly exports?: Exports;
  };

export type JobSpec<Dependencies extends DependencySpecs> = ArtifactSpec & CommonSpec<Dependencies>;

type ExportHandles<Exports extends Readonly<Record<string, { readonly capability: string }>>> = {
  readonly [Name in keyof Exports & string]: ExportHandle<Exports[Name]["capability"]>;
};

export type WorkloadHandle<
  Listener extends string,
  Exports extends ExportSpecs<Listener>,
  Dependencies extends DependencySpecs,
> = WorkloadRef & {
  readonly declaration: Declaration;
  readonly exports: ExportHandles<Exports>;
  readonly dependencies: Dependencies;
};

export type JobHandle<Dependencies extends DependencySpecs> = JobRef & {
  readonly declaration: Declaration;
  readonly dependencies: Dependencies;
};

type Spec = {
  readonly image?: string | undefined;
  readonly build?: BuildSpec | undefined;
  readonly command?: readonly string[] | undefined;
  readonly environment?: EnvironmentValues | undefined;
  readonly dependencies?: DependencySpecs | undefined;
  readonly volumes?: Readonly<Record<string, { readonly path: string }>> | undefined;
  readonly prerequisites?: readonly JobRef[] | undefined;
  readonly listeners?: Readonly<Record<string, ListenerSpec>> | undefined;
  readonly exports?: Readonly<Record<string, ExportSpec<string>>> | undefined;
  readonly description?: string | undefined;
};

/** Encodes environment values the way the model writes them: a literal or `{input: key}`. */
export function environmentJson(values: EnvironmentValues): JsonObject {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]): [string, JsonValue] => [
      name,
      typeof value === "string" ? value : { input: value.key },
    ]),
  );
}

function mapEntries<T>(
  record: Readonly<Record<string, T>>,
  convert: (value: T) => JsonValue,
): JsonObject {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, convert(value)]));
}

function exportJson(spec: ExportSpec<string>): JsonObject {
  return {
    capability: spec.capability,
    listener: spec.listener,
    ...(spec.values === undefined
      ? {}
      : { values: mapEntries(spec.values, (sensitivity) => ({ sensitivity })) }),
  };
}

function artifactJson(spec: Spec): JsonObject {
  if (spec.image !== undefined) {
    return { image: spec.image };
  }
  const build = spec.build;
  return build === undefined
    ? {}
    : {
        build: {
          context: build.context,
          ...(build.dockerfile === undefined ? {} : { dockerfile: build.dockerfile }),
          ...(build.target === undefined ? {} : { target: build.target }),
        },
      };
}

function specJson(type: "service" | "job", spec: Spec): JsonObject {
  return {
    type,
    ...artifactJson(spec),
    ...(spec.command === undefined ? {} : { command: [...spec.command] }),
    ...(spec.environment === undefined ? {} : { environment: environmentJson(spec.environment) }),
    ...(spec.listeners === undefined
      ? {}
      : {
          listeners: mapEntries(spec.listeners, (listener) => ({
            port: listener.port,
            protocol: listener.protocol,
          })),
        }),
    ...(spec.exports === undefined ? {} : { exports: mapEntries(spec.exports, exportJson) }),
    ...(spec.dependencies === undefined
      ? {}
      : { dependencies: mapEntries(spec.dependencies, (capability) => ({ capability })) }),
    ...(spec.volumes === undefined
      ? {}
      : { volumes: mapEntries(spec.volumes, (volume) => ({ path: volume.path })) }),
    ...(spec.prerequisites === undefined
      ? {}
      : { prerequisites: spec.prerequisites.map((job) => ({ job: job.key })) }),
  };
}

function noteIfInvalid(
  found: Diagnostic[],
  parsed: Result<unknown, Diagnostic>,
  pointer: string,
): void {
  if (!parsed.ok) {
    found.push({ ...parsed.error, pointer });
  }
}

function exportProblems(base: string, spec: Spec, found: Diagnostic[]): void {
  for (const [name, entry] of Object.entries(spec.exports ?? {})) {
    noteIfInvalid(found, parseObjectKey(name), pointerUnder(base, "exports", name));
    noteIfInvalid(
      found,
      parseCapability(entry.capability),
      pointerUnder(base, "exports", name, "capability"),
    );
  }
}

function dependencyProblems(base: string, spec: Spec, found: Diagnostic[]): void {
  for (const [name, capability] of Object.entries(spec.dependencies ?? {})) {
    noteIfInvalid(found, parseObjectKey(name), pointerUnder(base, "dependencies", name));
    noteIfInvalid(
      found,
      parseCapability(capability),
      pointerUnder(base, "dependencies", name, "capability"),
    );
  }
}

function nameProblems(key: string, spec: Spec): readonly Diagnostic[] {
  const base = pointerOf("spec", "workloads", key);
  const found: Diagnostic[] = [];
  noteIfInvalid(found, parseObjectKey(key), base);
  for (const name of Object.keys(spec.listeners ?? {})) {
    noteIfInvalid(found, parseObjectKey(name), pointerUnder(base, "listeners", name));
  }
  exportProblems(base, spec, found);
  dependencyProblems(base, spec, found);
  for (const name of Object.keys(spec.environment ?? {})) {
    noteIfInvalid(found, parseEnvKey(name), pointerUnder(base, "environment", name));
  }
  return found;
}

function declare(type: "service" | "job", key: string, spec: Spec): Declaration {
  return deepFreeze({
    kind: "workload",
    key,
    spec: specJson(type, spec),
    ...(spec.description === undefined ? {} : { description: spec.description }),
    origin: { kind: "sdk" },
    patches: [],
    problems: nameProblems(key, spec),
  });
}

function exportHandles<Exports extends ExportSpecs<string>>(
  ref: string,
  exports: Exports | undefined,
): ExportHandles<Exports> {
  const handles = Object.entries(exports ?? {}).map(([name, spec]) => [
    name,
    Object.freeze({ kind: "export", object: ref, name, capability: spec.capability }),
  ]);
  return Object.freeze(Object.fromEntries(handles)) as ExportHandles<Exports>;
}

/**
 * Declares a long-running workload. Listener names, and the capability each export serves, are
 * literal types, so an export that names an undeclared listener does not compile.
 */
export function service<
  const Listener extends string = never,
  const Exports extends ExportSpecs<Listener> = NoDependencies,
  const Dependencies extends DependencySpecs = NoDependencies,
>(
  key: string,
  spec: ServiceSpec<Listener, Exports, Dependencies>,
): WorkloadHandle<Listener, Exports, Dependencies> {
  const ref = `workload/${key}`;
  return Object.freeze({
    kind: "workload",
    key,
    ref,
    declaration: declare("service", key, spec),
    exports: exportHandles(ref, spec.exports),
    dependencies: Object.freeze({ ...(spec.dependencies ?? {}) }) as Dependencies,
  });
}

/** Declares a run-to-completion workload, which other workloads can list as a prerequisite. */
export function job<const Dependencies extends DependencySpecs = NoDependencies>(
  key: string,
  spec: JobSpec<Dependencies>,
): JobHandle<Dependencies> {
  return Object.freeze({
    kind: "workload",
    key,
    ref: `workload/${key}`,
    declaration: declare("job", key, spec),
    dependencies: Object.freeze({ ...(spec.dependencies ?? {}) }) as Dependencies,
  });
}
