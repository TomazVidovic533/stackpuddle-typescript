import type { Declaration, ExportHandle } from "./declarations.js";
import { type JsonObject, deepFreeze } from "./json.js";
import { parseModuleName, parseObjectKey } from "./names.js";
import { type Diagnostic, pointerOf } from "./result.js";

/** A module instance declaration. Its exports come from the module definition, not from the SDK. */
export type ModuleInstanceHandle = {
  readonly kind: "module";
  readonly key: string;
  readonly ref: string;
  readonly declaration: Declaration;
  /** Refers to an export the module definition declares; the definition is not visible to the SDK. */
  readonly exportOf: <const CapabilityName extends string>(
    name: string,
    capability: CapabilityName,
  ) => ExportHandle<CapabilityName>;
};

export type ModuleInstanceSpec = {
  readonly definition: string;
  readonly options: JsonObject;
  readonly description?: string;
};

/** Declares an instance of a module definition with options already encoded as JSON. */
export function moduleInstance(key: string, spec: ModuleInstanceSpec): ModuleInstanceHandle {
  const problems: Diagnostic[] = [];
  const base = pointerOf("spec", "modules", key);
  const parsedKey = parseObjectKey(key);
  if (!parsedKey.ok) {
    problems.push({ ...parsedKey.error, pointer: base });
  }
  const parsedDefinition = parseModuleName(spec.definition);
  if (!parsedDefinition.ok) {
    problems.push({ ...parsedDefinition.error, pointer: `${base}/definition` });
  }
  const ref = `module/${key}`;
  return deepFreeze({
    kind: "module",
    key,
    ref,
    declaration: {
      kind: "module",
      key,
      spec: { definition: spec.definition, options: spec.options },
      ...(spec.description === undefined ? {} : { description: spec.description }),
      origin: { kind: "sdk" },
      patches: [],
      problems,
    },
    exportOf: <const CapabilityName extends string>(name: string, capability: CapabilityName) =>
      Object.freeze({ kind: "export", object: ref, name, capability }),
  });
}
