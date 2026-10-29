import { supportsApiVersion } from "../compatibility/supported-contract.js";
import type {
  BindingDeclaration,
  ConsumerHandle,
  Declaration,
  DeclarationKind,
  ExportHandle,
  Origin,
  WorkloadRef,
} from "../model/declarations.js";
import { sectionOf } from "../model/declarations.js";
import {
  type JsonObject,
  asList,
  asObject,
  asText,
  deepFreeze,
  isJsonObject,
} from "../model/json.js";
import {
  type Diagnostic,
  type Result,
  diagnostic,
  fail,
  locate,
  pointerOf,
  sortDiagnostics,
  succeed,
} from "../model/result.js";
import { validateDocument } from "../schema/validate.adapter.js";
import { type Position, readYaml } from "../yaml/read-yaml.adapter.js";

/** A workload that a YAML Fragment declares. The compiler cannot see its exports or dependencies. */
export type ImportedWorkload = WorkloadRef &
  ConsumerHandle & {
    /** Refers to an export of the imported workload; whether it exists is checked when the model encodes. */
    readonly export: (name: string) => ExportHandle;
  };

/** The declarations of one YAML Fragment, ready to be composed into a project. */
export type ImportedFragment = {
  readonly kind: "fragment";
  readonly file: string;
  readonly declarations: readonly Declaration[];
  readonly bindings: readonly BindingDeclaration[];
  readonly workload: (key: string) => ImportedWorkload;
};

type Source = {
  readonly file: string;
  readonly positions: ReadonlyMap<string, Position>;
};

const IMPORTED_KINDS = [
  "definition",
  "input",
  "workload",
  "module",
  "client",
  "application",
  "environment",
] as const satisfies readonly DeclarationKind[];

const EXPECTED_KIND = "Fragment";

/** Points each diagnostic at the nearest position the document records for its pointer. */
function placed(diagnostics: readonly Diagnostic[], source: Source): Diagnostic[] {
  return diagnostics.map((item) => {
    let pointer = item.pointer;
    while (pointer !== "" && !source.positions.has(pointer)) {
      pointer = pointer.slice(0, pointer.lastIndexOf("/"));
    }
    return locate(item, { file: source.file, ...source.positions.get(pointer) });
  });
}

function originOf(source: Source, pointer: string): Origin {
  const position = source.positions.get(pointer);
  return {
    kind: "yaml",
    file: source.file,
    line: position?.line ?? 1,
    column: position?.column ?? 1,
  };
}

function declarationOf(
  kind: DeclarationKind,
  key: string,
  body: JsonObject,
): Omit<Declaration, "origin"> {
  const { metadata, ...spec } = body;
  const description = asText(asObject(metadata).description);
  return {
    kind,
    key,
    spec,
    ...(description === undefined ? {} : { description }),
    patches: [],
    problems: [],
  };
}

function declarationsOf(spec: JsonObject, source: Source): Declaration[] {
  return IMPORTED_KINDS.flatMap((kind) =>
    Object.entries(asObject(spec[sectionOf[kind]])).flatMap(([key, body]) =>
      isJsonObject(body)
        ? [
            {
              ...declarationOf(kind, key, body),
              origin: originOf(source, pointerOf("spec", sectionOf[kind], key)),
            },
          ]
        : [],
    ),
  );
}

function bindingsOf(spec: JsonObject, source: Source): BindingDeclaration[] {
  return asList(spec.bindings).map((item, index) => {
    const entry = asObject(item);
    const from = asObject(entry.source);
    const { parameters, delivery } = entry;
    return {
      consumer: asText(entry.consumer) ?? "",
      dependency: asText(entry.dependency) ?? "",
      source: { object: asText(from.object) ?? "", export: asText(from.export) ?? "" },
      ...(isJsonObject(parameters) ? { parameters } : {}),
      ...(isJsonObject(delivery) ? { delivery } : {}),
      origin: originOf(source, pointerOf("spec", "bindings", index)),
      problems: [],
    };
  });
}

function capabilitiesOf(section: JsonObject): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(section).map(([name, entry]) => [
      name,
      asText(asObject(entry).capability) ?? "",
    ]),
  );
}

function workloadHandle(declarations: readonly Declaration[], key: string): ImportedWorkload {
  const ref = `workload/${key}`;
  const declared = declarations.find((item) => item.kind === "workload" && item.key === key);
  const exported = capabilitiesOf(asObject(declared?.spec.exports));
  return Object.freeze({
    kind: "workload",
    key,
    ref,
    dependencies: Object.freeze(capabilitiesOf(asObject(declared?.spec.dependencies))),
    export: (name: string): ExportHandle =>
      Object.freeze({ kind: "export", object: ref, name, capability: exported[name] ?? "" }),
  });
}

function compatibilityProblems(tree: JsonObject, source: Source): Diagnostic[] {
  const found: Diagnostic[] = [];
  const apiVersion = tree.apiVersion;
  if (typeof apiVersion === "string" && !supportsApiVersion(apiVersion)) {
    found.push(
      diagnostic(
        "sdk.unsupported_api_version",
        "/apiVersion",
        "this SDK reads stackpuddle/v1 only",
      ),
    );
  }
  const kind = tree.kind;
  if (typeof kind === "string" && kind !== EXPECTED_KIND) {
    found.push(
      diagnostic(
        "structure.unexpected_kind",
        "/kind",
        `an imported file must be a ${EXPECTED_KIND}`,
      ),
    );
  }
  return placed(found, source);
}

/**
 * Reads one YAML Fragment into declarations. The reader accepts the subset the Go decoder accepts,
 * and the Fragment must satisfy stackpuddle's published schema; anything else is refused with the
 * Go model's code and pointer, never dropped. Pure: the caller supplies the text.
 *
 * `file` is the path relative to the composition root; provenance records it.
 */
export function importYaml(
  file: string,
  input: string | Uint8Array,
): Result<ImportedFragment, readonly Diagnostic[]> {
  const read = readYaml(file, input);
  if (!read.ok) {
    return read;
  }
  const { tree } = read.value;
  const source: Source = { file, positions: read.value.positions };
  if (!isJsonObject(tree)) {
    return fail(
      placed([diagnostic("structure.invalid_type", "", "a Fragment is a mapping")], source),
    );
  }
  const early = compatibilityProblems(tree, source);
  const problems = early.length > 0 ? early : placed(validateDocument("fragment", tree), source);
  if (problems.length > 0) {
    return fail(sortDiagnostics(problems));
  }
  const spec = asObject(tree.spec);
  const declarations = deepFreeze(declarationsOf(spec, source));
  return succeed(
    Object.freeze({
      kind: "fragment",
      file,
      declarations,
      bindings: deepFreeze(bindingsOf(spec, source)),
      workload: (key: string) => workloadHandle(declarations, key),
    }),
  );
}
