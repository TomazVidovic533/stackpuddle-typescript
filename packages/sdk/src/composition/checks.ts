import {
  type BindingDeclaration,
  type Declaration,
  type Origin,
  sectionOf,
} from "../model/declarations.js";
import { type JsonObject, asList, asObject, asText } from "../model/json.js";
import { type Diagnostic, assertNever, diagnostic, locate, pointerOf } from "../model/result.js";

import type { Project } from "./project.js";

export function bindingRef(binding: BindingDeclaration): string {
  return `binding/${binding.consumer}/${binding.dependency}`;
}

/** Orders bindings by their reference, the order the model lists them in. */
export function sortedBindings(bindings: readonly BindingDeclaration[]): BindingDeclaration[] {
  return [...bindings].sort((a, b) => {
    const left = bindingRef(a);
    const right = bindingRef(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Records findings located at one origin: YAML declarations carry a file and position. */
type Report = (code: string, pointer: string, message: string) => void;

function reporter(found: Diagnostic[], origin: Origin): Report {
  return (code, pointer, message) => {
    const item = diagnostic(code, pointer, message);
    switch (origin.kind) {
      case "yaml":
        found.push(locate(item, { file: origin.file, line: origin.line, column: origin.column }));
        return;
      case "sdk":
        found.push(item);
        return;
      default:
        assertNever(origin);
    }
  };
}

type Catalogue = ReadonlyMap<string, Declaration>;

function refOf(item: Declaration): string {
  return `${item.kind}/${item.key}`;
}

function catalogue(declarations: readonly Declaration[], found: Diagnostic[]): Catalogue {
  const first = new Map<string, Declaration>();
  for (const item of declarations) {
    if (first.has(refOf(item))) {
      reporter(found, item.origin)(
        "identity.duplicate_declaration",
        pointerOf("spec", sectionOf[item.kind], item.key),
        `${refOf(item)} is declared more than once`,
      );
    } else {
      first.set(refOf(item), item);
    }
  }
  return first;
}

function checkListeners(workload: Declaration, report: Report): void {
  const listeners = asObject(workload.spec.listeners);
  for (const [name, entry] of Object.entries(asObject(workload.spec.exports))) {
    const listener = asText(asObject(entry).listener);
    if (listener !== undefined && !(listener in listeners)) {
      report(
        "reference.unknown_listener",
        pointerOf("spec", "workloads", workload.key, "exports", name, "listener"),
        `export ${JSON.stringify(name)} names a listener the workload does not declare`,
      );
    }
  }
}

function checkInputs(workload: Declaration, objects: Catalogue, report: Report): void {
  for (const [name, value] of Object.entries(asObject(workload.spec.environment))) {
    const input = asText(asObject(value).input);
    if (input !== undefined && !objects.has(`input/${input}`)) {
      report(
        "reference.unknown_input",
        pointerOf("spec", "workloads", workload.key, "environment", name, "input"),
        `variable ${JSON.stringify(name)} names an input that is not declared`,
      );
    }
  }
}

function checkPrerequisites(workload: Declaration, objects: Catalogue, report: Report): void {
  asList(workload.spec.prerequisites).forEach((entry, index) => {
    const job = asText(asObject(entry).job);
    if (job === undefined) {
      return;
    }
    const target = objects.get(`workload/${job}`);
    const pointer = pointerOf("spec", "workloads", workload.key, "prerequisites", index, "job");
    if (target === undefined) {
      report("reference.unknown_object", pointer, "the prerequisite is not declared");
    } else if (target.spec.type !== "job") {
      report("reference.wrong_kind", pointer, "a prerequisite must be a job");
    }
  });
}

function checkApplication(item: Declaration, objects: Catalogue, report: Report): void {
  asList(item.spec.workloads).forEach((name, index) => {
    if (typeof name === "string" && !objects.has(`workload/${name}`)) {
      report(
        "reference.unknown_object",
        pointerOf("spec", "applications", item.key, "workloads", index),
        "the application names a workload that is not declared",
      );
    }
  });
}

/** An environment never carries a literal for a secret input, whether declared in code or YAML. */
function checkSecretValues(item: Declaration, objects: Catalogue, report: Report): void {
  for (const [key, source] of Object.entries(asObject(item.spec.inputs))) {
    const declared = objects.get(`input/${key}`);
    if (declared?.spec.sensitivity === "secret" && "value" in asObject(source)) {
      report(
        "structure.secret_literal",
        pointerOf("spec", "environments", item.key, "inputs", key, "value"),
        "a secret input never takes a value in the model",
      );
    }
  }
}

function checkDeclaration(item: Declaration, objects: Catalogue, found: Diagnostic[]): void {
  const report = reporter(found, item.origin);
  if (item.kind === "input" && item.spec.sensitivity === "secret" && "value" in item.spec) {
    report(
      "structure.secret_literal",
      pointerOf("spec", "inputs", item.key, "value"),
      "a secret input never takes a value in the model",
    );
  }
  if (item.kind === "environment") {
    checkSecretValues(item, objects, report);
  }
  if (item.kind === "workload") {
    checkListeners(item, report);
    checkInputs(item, objects, report);
    checkPrerequisites(item, objects, report);
  } else if (item.kind === "application") {
    checkApplication(item, objects, report);
  }
}

function capabilityOf(
  declaration: Declaration | undefined,
  section: "dependencies" | "exports",
  name: string,
): string | undefined {
  if (declaration === undefined) {
    return undefined;
  }
  const entry: JsonObject = asObject(asObject(declaration.spec[section])[name]);
  return asText(entry.capability);
}

type BindingContext = {
  readonly objects: Catalogue;
  readonly report: Report;
  readonly base: string;
};

function checkEndpoints(binding: BindingDeclaration, context: BindingContext): void {
  if (!context.objects.has(binding.consumer)) {
    context.report(
      "reference.unknown_object",
      `${context.base}/consumer`,
      "the consumer is not declared",
    );
  }
  if (!context.objects.has(binding.source.object)) {
    context.report(
      "reference.unknown_object",
      `${context.base}/source/object`,
      "the source is not declared",
    );
  }
}

function checkCapabilities(binding: BindingDeclaration, context: BindingContext): void {
  const consumer = context.objects.get(binding.consumer);
  const source = context.objects.get(binding.source.object);
  const needs = capabilityOf(consumer, "dependencies", binding.dependency);
  if (consumer !== undefined && consumer.kind !== "module" && needs === undefined) {
    context.report(
      "reference.unknown_dependency",
      `${context.base}/dependency`,
      "the consumer does not declare this dependency",
    );
  }
  if (source?.kind !== "workload") {
    return;
  }
  const serves = capabilityOf(source, "exports", binding.source.export);
  if (serves === undefined) {
    context.report(
      "reference.unknown_export",
      `${context.base}/source/export`,
      "the source does not declare this export",
    );
  } else if (needs !== undefined && needs !== serves) {
    context.report(
      "binding.capability_mismatch",
      `${context.base}/source`,
      "the export serves a different capability than the dependency needs",
    );
  }
}

function checkBindings(
  bindings: readonly BindingDeclaration[],
  objects: Catalogue,
  found: Diagnostic[],
): void {
  const firstOfRef = new Map<string, BindingDeclaration>();
  sortedBindings(bindings).forEach((binding, index) => {
    const context = {
      objects,
      report: reporter(found, binding.origin),
      base: pointerOf("spec", "bindings", index),
    };
    const earlier = firstOfRef.get(bindingRef(binding));
    if (earlier === undefined) {
      firstOfRef.set(bindingRef(binding), binding);
      checkEndpoints(binding, context);
      checkCapabilities(binding, context);
      return;
    }
    const same =
      earlier.source.object === binding.source.object &&
      earlier.source.export === binding.source.export;
    context.report(
      same ? "binding.duplicate" : "binding.conflict",
      context.base,
      "the dependency is bound more than once",
    );
  });
}

/**
 * Checks what the compiler cannot: duplicate declarations, and references into objects imported
 * from YAML. Each finding uses the Go model's code and the pointer it would report.
 */
export function checkProject(project: Project): Diagnostic[] {
  const found: Diagnostic[] = [
    ...project.problems,
    ...project.declarations.flatMap((item) => item.problems),
    ...project.bindings.flatMap((item) => item.problems),
  ];
  const objects = catalogue(project.declarations, found);
  for (const item of objects.values()) {
    checkDeclaration(item, objects, found);
  }
  checkBindings(project.bindings, objects, found);
  return found;
}
