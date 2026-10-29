import type {
  BindingDeclaration,
  BindingHandle,
  ConsumerHandle,
  Declaration,
  DependencySpecs,
  ExportHandle,
  WorkloadRef,
} from "./declarations.js";
import { type JsonObject, deepFreeze } from "./json.js";
import { parseCapability, parseEnvKey, parseObjectKey } from "./names.js";
import { type Diagnostic, pointerOf } from "./result.js";
import type { InputHandle } from "./workload.js";

/** How a binding hands source values to its consumer. */
export type Delivery = {
  /** Environment variable name to the exported value name it carries. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly files?: Readonly<
    Record<string, { readonly path: string; readonly mode: FileMode; readonly owner?: string }>
  >;
};

/** The file modes the model allows. */
export type FileMode = "0400" | "0440" | "0444" | "0600" | "0640" | "0644";

export type BindOptions = {
  readonly parameters?: JsonObject;
  readonly delivery?: Delivery;
};

function deliveryJson(delivery: Delivery): JsonObject {
  return {
    ...(delivery.environment === undefined ? {} : { environment: { ...delivery.environment } }),
    ...(delivery.files === undefined
      ? {}
      : {
          files: Object.fromEntries(
            Object.entries(delivery.files).map(([value, file]) => [
              value,
              {
                path: file.path,
                mode: file.mode,
                ...(file.owner === undefined ? {} : { owner: file.owner }),
              },
            ]),
          ),
        }),
  };
}

function bindingProblems(
  consumer: string,
  dependency: string,
  delivery: Delivery | undefined,
): readonly Diagnostic[] {
  const found: Diagnostic[] = [];
  const parsed = parseObjectKey(dependency);
  if (!parsed.ok) {
    found.push({ ...parsed.error, pointer: pointerOf("spec", "bindings", consumer, dependency) });
  }
  for (const name of Object.keys(delivery?.environment ?? {})) {
    const key = parseEnvKey(name);
    if (!key.ok) {
      found.push({
        ...key.error,
        pointer: pointerOf("spec", "bindings", consumer, "delivery", name),
      });
    }
  }
  return found;
}

/**
 * Binds one dependency of a consumer to an export. The dependency must be one the consumer
 * declares, and the source must serve the capability that dependency needs; both are compile-time
 * checks for typed handles.
 */
// eslint-disable-next-line max-params -- the public call reads consumer, dependency, source, then options
export function bind<
  const Dependencies extends DependencySpecs,
  const Key extends keyof Dependencies & string,
>(
  consumer: ConsumerHandle<Dependencies>,
  dependency: Key,
  source: ExportHandle<Dependencies[Key]>,
  options: BindOptions = {},
): BindingHandle {
  const declaration: BindingDeclaration = {
    consumer: consumer.ref,
    dependency,
    source: { object: source.object, export: source.name },
    ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
    ...(options.delivery === undefined ? {} : { delivery: deliveryJson(options.delivery) }),
    origin: { kind: "sdk" },
    problems: bindingProblems(consumer.ref, dependency, options.delivery),
  };
  return deepFreeze({ kind: "binding", declaration });
}

export type ApplicationOptions = {
  readonly default?: true;
  readonly description?: string;
};

export type ApplicationHandle = {
  readonly kind: "application";
  readonly key: string;
  readonly declaration: Declaration;
};

/** Groups workloads that start together. */
export function application(
  key: string,
  workloads: readonly WorkloadRef[],
  options: ApplicationOptions = {},
): ApplicationHandle {
  const problems: Diagnostic[] = [];
  const parsed = parseObjectKey(key);
  if (!parsed.ok) {
    problems.push({ ...parsed.error, pointer: pointerOf("spec", "applications", key) });
  }
  return deepFreeze({
    kind: "application",
    key,
    declaration: {
      kind: "application",
      key,
      spec: {
        workloads: workloads.map((workload) => workload.key),
        ...(options.default === undefined ? {} : { default: options.default }),
      },
      ...(options.description === undefined ? {} : { description: options.description }),
      origin: { kind: "sdk" },
      patches: [],
      problems,
    },
  });
}

export type PublicInputSpec = { readonly sensitivity: "public"; readonly value?: string };
export type SecretInputSpec = { readonly sensitivity: "secret"; readonly value?: never };
export type InputSpec = PublicInputSpec | SecretInputSpec;

/** Declares a named input. A secret input never takes a value in code. */
export function input(key: string, spec: PublicInputSpec): InputHandle<"public">;
export function input(key: string, spec: SecretInputSpec): InputHandle<"secret">;
export function input(key: string, spec: InputSpec): InputHandle {
  const problems: Diagnostic[] = [];
  const parsed = parseObjectKey(key);
  if (!parsed.ok) {
    problems.push({ ...parsed.error, pointer: pointerOf("spec", "inputs", key) });
  }
  const declaration: Declaration = {
    kind: "input",
    key,
    spec: {
      sensitivity: spec.sensitivity,
      ...(spec.value === undefined ? {} : { value: spec.value }),
    },
    origin: { kind: "sdk" },
    patches: [],
    problems,
  };
  return deepFreeze({ kind: "input", key, sensitivity: spec.sensitivity, declaration });
}

/** Builds an export reference for an object whose exports the compiler cannot see. */
export function exportOf<const CapabilityName extends string>(
  object: string,
  name: string,
  capability: CapabilityName,
): ExportHandle<CapabilityName> {
  const parsed = parseCapability(capability);
  if (!parsed.ok) {
    throw new RangeError(parsed.error.message);
  }
  return Object.freeze({ kind: "export", object, name, capability });
}
