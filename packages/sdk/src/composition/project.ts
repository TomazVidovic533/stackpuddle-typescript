import type {
  BindingDeclaration,
  BindingHandle,
  Declaration,
  DeclarationHandle,
} from "../model/declarations.js";
import { deepFreeze } from "../model/json.js";
import { parseScopeName } from "../model/names.js";
import { type Diagnostic, diagnostic } from "../model/result.js";

import type { ImportedFragment } from "./imports.js";
import type { Patch } from "./patch.js";

export type ProjectParts = {
  /** Workloads, module instances, applications, inputs and clients the SDK declares. */
  readonly declarations?: readonly DeclarationHandle[];
  readonly environments?: readonly DeclarationHandle[];
  readonly bindings?: readonly BindingHandle[];
  /** Fragments imported from YAML. Their declarations keep YAML provenance. */
  readonly imports?: readonly ImportedFragment[];
  readonly patches?: readonly Patch[];
  readonly description?: string;
};

/** The composition root: everything one model file is made of. Immutable. */
export type Project = {
  readonly kind: "project";
  readonly name: string;
  readonly description?: string;
  readonly declarations: readonly Declaration[];
  readonly bindings: readonly BindingDeclaration[];
  /** Problems found while composing; reported when the model encodes. */
  readonly problems: readonly Diagnostic[];
};

function applyPatches(
  declarations: readonly Declaration[],
  patches: readonly Patch[],
): { declarations: Declaration[]; problems: Diagnostic[] } {
  const next = [...declarations];
  const problems: Diagnostic[] = [];
  for (const patch of patches) {
    problems.push(...patch.problems);
    const index = next.findIndex(
      (item) => item.origin.kind === "yaml" && `${item.kind}/${item.key}` === patch.ref,
    );
    const target = next[index];
    if (target === undefined) {
      problems.push(
        diagnostic(
          "reference.unknown_object",
          `/spec/${patch.ref.replace("workload/", "workloads/")}`,
          "a typed patch names an object no imported Fragment declares",
        ),
      );
      continue;
    }
    next[index] = patch.apply(target);
  }
  return { declarations: next, problems };
}

/**
 * Composes a project explicitly: the declarations written in code, the Fragments imported from
 * YAML, and typed patches over imported objects. Nothing is discovered implicitly. Problems do not
 * throw; they are reported by encodeModel.
 */
export function defineProject(name: string, parts: ProjectParts = {}): Project {
  const parsed = parseScopeName(name);
  const written = [...(parts.declarations ?? []), ...(parts.environments ?? [])].map(
    (handle) => handle.declaration,
  );
  const imported = (parts.imports ?? []).flatMap((fragment) => fragment.declarations);
  const patched = applyPatches([...written, ...imported], parts.patches ?? []);
  const bindings = [
    ...(parts.bindings ?? []).map((handle) => handle.declaration),
    ...(parts.imports ?? []).flatMap((fragment) => fragment.bindings),
  ];
  return deepFreeze({
    kind: "project",
    name,
    ...(parts.description === undefined ? {} : { description: parts.description }),
    declarations: patched.declarations,
    bindings,
    problems: [
      ...(parsed.ok ? [] : [{ ...parsed.error, pointer: "/metadata/name" }]),
      ...patched.problems,
    ],
  });
}
