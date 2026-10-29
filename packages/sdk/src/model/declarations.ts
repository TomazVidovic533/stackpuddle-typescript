import type { JsonObject } from "./json.js";
import type { Diagnostic } from "./result.js";

/** Where a declaration was written. SDK declarations carry no position. */
export type Origin =
  | { readonly kind: "yaml"; readonly file: string; readonly line: number; readonly column: number }
  | { readonly kind: "sdk" };

export type DeclarationKind =
  "workload" | "module" | "client" | "application" | "environment" | "input" | "definition";

/** The section of a Project document that holds each kind, which is also the pointer segment. */
export const sectionOf = {
  workload: "workloads",
  module: "modules",
  client: "clients",
  application: "applications",
  environment: "environments",
  input: "inputs",
  definition: "definitions",
} as const satisfies Record<DeclarationKind, string>;

/** The provenance reference prefix of each kind; inputs and definitions carry no provenance. */
export const refPrefixOf = {
  workload: "workload",
  module: "module",
  client: "client",
  application: "app",
  environment: "env",
  input: undefined,
  definition: undefined,
} as const satisfies Record<DeclarationKind, string | undefined>;

/** One declared object of the model, as the section of a Project document holds it. */
export type Declaration = {
  readonly kind: DeclarationKind;
  readonly key: string;
  /** The declaration body without `metadata`. */
  readonly spec: JsonObject;
  readonly description?: string;
  readonly origin: Origin;
  /** The JSON pointer lists of the typed patches applied since the declaration, oldest first. */
  readonly patches: readonly (readonly string[])[];
  /** Problems found while building it; reported when the project encodes. */
  readonly problems: readonly Diagnostic[];
};

/** A binding of a consumer's dependency to a source export. */
export type BindingDeclaration = {
  readonly consumer: string;
  readonly dependency: string;
  readonly source: { readonly object: string; readonly export: string };
  readonly parameters?: JsonObject;
  readonly delivery?: JsonObject;
  readonly origin: Origin;
  readonly problems: readonly Diagnostic[];
};

/** Dependency key to the capability it needs. */
export type DependencySpecs = Readonly<Record<string, string>>;

/** The dependencies of a consumer that declares none: no key can be bound. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an empty record is the exact type of "no keys"
export type NoDependencies = {};

/** A reference to one export of one object. The capability type separates incompatible sources. */
export type ExportHandle<Capability extends string = string> = {
  readonly kind: "export";
  readonly object: string;
  readonly name: string;
  readonly capability: Capability;
};

/** Anything that can consume a binding: it names its dependencies and their capabilities. */
export type ConsumerHandle<Dependencies extends DependencySpecs = DependencySpecs> = {
  readonly ref: string;
  readonly dependencies: Dependencies;
};

/** The reference a binding or application makes to a workload. */
export type WorkloadRef = {
  readonly kind: "workload";
  readonly key: string;
  readonly ref: string;
};

export type BindingHandle = {
  readonly kind: "binding";
  readonly declaration: BindingDeclaration;
};

/** Everything defineProject accepts as a declaration. */
export type DeclarationHandle = {
  readonly kind: string;
  readonly declaration: Declaration;
};
