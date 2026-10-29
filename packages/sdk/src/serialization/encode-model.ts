import { SUPPORTED_API_VERSIONS } from "../compatibility/supported-contract.js";
import { bindingRef, checkProject, sortedBindings } from "../composition/checks.js";
import type { Project } from "../composition/project.js";
import {
  type BindingDeclaration,
  type Declaration,
  type DeclarationKind,
  type Origin,
  refPrefixOf,
} from "../model/declarations.js";
import {
  type JsonObject,
  type JsonValue,
  asList,
  asObject,
  asText,
  isJsonArray,
  isJsonObject,
} from "../model/json.js";
import {
  type Diagnostic,
  type Result,
  assertNever,
  fail,
  sortDiagnostics,
  succeed,
} from "../model/result.js";
import { validateDocument } from "../schema/validate.adapter.js";

import { canonicalize } from "./canonical.js";

const API_VERSION = SUPPORTED_API_VERSIONS[0];
const OBJECT_KINDS = {
  client: "Client",
  module: "ModuleInstance",
  workload: "Workload",
} as const satisfies Partial<Record<DeclarationKind, string>>;
const OPTIONAL_WORKLOAD_MEMBERS = [
  "command",
  "environment",
  "listeners",
  "exports",
  "dependencies",
  "volumes",
  "prerequisites",
] as const;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isEmpty(value: JsonValue | undefined): boolean {
  if (isJsonArray(value)) {
    return value.length === 0;
  }
  return isJsonObject(value) && Object.keys(value).length === 0;
}

/** Drops the named members when they are empty, the way the Go encoder omits empty optional members. */
function withoutEmpty(object: JsonObject, names: readonly string[]): JsonObject {
  return Object.fromEntries(
    Object.entries(object).filter(([name, value]) => !names.includes(name) || !isEmpty(value)),
  );
}

function omitEmpty(entries: Readonly<Record<string, JsonValue>>): JsonObject {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => !isEmpty(value)));
}

function exportsOf(value: JsonValue | undefined): JsonObject {
  return Object.fromEntries(
    Object.entries(asObject(value)).map(([name, entry]) => [
      name,
      withoutEmpty(asObject(entry), ["values"]),
    ]),
  );
}

function sortedPrerequisites(value: JsonValue | undefined): JsonValue[] {
  return [...asList(value)].sort((a, b) =>
    compare(asText(asObject(a).job) ?? "", asText(asObject(b).job) ?? ""),
  );
}

function workloadSpec(spec: JsonObject): JsonObject {
  return withoutEmpty(
    {
      ...spec,
      exports: exportsOf(spec.exports),
      prerequisites: sortedPrerequisites(spec.prerequisites),
    },
    OPTIONAL_WORKLOAD_MEMBERS,
  );
}

function objectSpec(item: Declaration): JsonObject {
  if (item.kind === "workload") {
    return workloadSpec(item.spec);
  }
  return item.kind === "module" ? withoutEmpty(item.spec, ["options"]) : item.spec;
}

function withMetadata(object: JsonObject, item: Declaration): JsonObject {
  return item.description === undefined
    ? object
    : { ...object, metadata: { description: item.description } };
}

type Envelope = { readonly kind: string; readonly key: string; readonly object: JsonObject };

function envelopeOf(item: Declaration): Envelope[] {
  if (item.kind !== "workload" && item.kind !== "module" && item.kind !== "client") {
    return [];
  }
  const kind = OBJECT_KINDS[item.kind];
  const object = withMetadata(
    { apiVersion: API_VERSION, kind, key: item.key, spec: objectSpec(item) },
    item,
  );
  return [{ kind, key: item.key, object }];
}

function envelopes(declarations: readonly Declaration[]): JsonValue[] {
  return declarations
    .flatMap(envelopeOf)
    .sort((a, b) => compare(a.kind, b.kind) || compare(a.key, b.key))
    .map((entry) => entry.object);
}

function section(
  declarations: readonly Declaration[],
  kind: DeclarationKind,
  convert: (item: Declaration) => JsonValue,
): JsonObject {
  return Object.fromEntries(
    declarations.filter((item) => item.kind === kind).map((item) => [item.key, convert(item)]),
  );
}

function application(item: Declaration): JsonValue {
  const members = asList(item.spec.workloads).map(String);
  return withMetadata(
    { workloads: members.sort(compare), ...(item.spec.default === true ? { default: true } : {}) },
    item,
  );
}

function exposureKey(exposure: JsonValue): string {
  const source = asObject(asObject(exposure).source);
  return `${asText(source.object) ?? ""}\u0000${asText(source.export) ?? ""}`;
}

function environment(item: Declaration): JsonValue {
  const { exposures, overrides, ...rest } = item.spec;
  return withMetadata(
    withoutEmpty(
      {
        ...rest,
        exposures: [...asList(exposures)].sort((a, b) => compare(exposureKey(a), exposureKey(b))),
        overrides: withoutEmpty(asObject(overrides), ["workloads", "modules"]),
      },
      ["exposures", "inputs", "overrides"],
    ),
    item,
  );
}

function bindingJson(binding: BindingDeclaration): JsonValue {
  return {
    consumer: binding.consumer,
    dependency: binding.dependency,
    source: { object: binding.source.object, export: binding.source.export },
    ...(binding.parameters === undefined || isEmpty(binding.parameters)
      ? {}
      : { parameters: binding.parameters }),
    ...(binding.delivery === undefined ? {} : { delivery: binding.delivery }),
  };
}

function originJson(origin: Origin): JsonObject {
  switch (origin.kind) {
    case "sdk":
      return { origin: "sdk" };
    case "yaml":
      return { origin: "yaml", file: origin.file, line: origin.line, column: origin.column };
    default:
      return assertNever(origin);
  }
}

function provenanceOf(item: Declaration): JsonValue {
  return {
    declared: originJson(item.origin),
    ...(item.patches.length === 0
      ? {}
      : { patched: item.patches.map((fields) => ({ origin: "sdk", fields: [...fields] })) }),
  };
}

function provenance(
  declarations: readonly Declaration[],
  bindings: readonly BindingDeclaration[],
): JsonObject {
  const entries: [string, JsonValue][] = [];
  for (const item of declarations) {
    const prefix = refPrefixOf[item.kind];
    if (prefix !== undefined) {
      entries.push([`${prefix}/${item.key}`, provenanceOf(item)]);
    }
  }
  for (const binding of bindings) {
    entries.push([bindingRef(binding), { declared: originJson(binding.origin) }]);
  }
  return Object.fromEntries(entries);
}

/** Keeps the first declaration of each reference; the checks report the later ones. */
function firstOfEach<Item>(items: readonly Item[], refOf: (item: Item) => string): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const ref = refOf(item);
    return !seen.has(ref) && seen.add(ref);
  });
}

/** Builds the canonical Model document of a project, before it is printed. */
function modelTree(project: Project): JsonObject {
  const declarations = firstOfEach(project.declarations, (item) => `${item.kind}/${item.key}`);
  const bindings = firstOfEach(sortedBindings(project.bindings), bindingRef);
  return {
    apiVersion: API_VERSION,
    kind: "Model",
    metadata: {
      name: project.name,
      ...(project.description === undefined ? {} : { description: project.description }),
    },
    spec: omitEmpty({
      definitions: section(declarations, "definition", (item) => item.spec),
      inputs: section(declarations, "input", (item) => item.spec),
      objects: envelopes(declarations),
      applications: section(declarations, "application", application),
      bindings: bindings.map(bindingJson),
      environments: section(declarations, "environment", environment),
    }),
    provenance: provenance(declarations, bindings),
  };
}

/**
 * Encodes a project as the canonical Model file. Everything the compiler could not check is checked
 * here, before any bytes are produced: nothing is written for a project with problems.
 */
export function encodeModel(project: Project): Result<string, readonly Diagnostic[]> {
  const problems = checkProject(project);
  if (problems.length > 0) {
    return fail(sortDiagnostics(problems));
  }
  const tree = modelTree(project);
  const structural = validateDocument("model", tree);
  if (structural.length > 0) {
    return fail(sortDiagnostics(structural));
  }
  return succeed(canonicalize(tree));
}
