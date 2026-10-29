import type { Declaration } from "../model/declarations.js";
import { type JsonObject, asObject, deepFreeze } from "../model/json.js";
import { type Diagnostic, diagnostic, pointerOf } from "../model/result.js";
import { type EnvironmentValues, environmentJson } from "../model/workload.js";

import type { ImportedWorkload } from "./imports.js";

/** The members of an imported workload a typed patch may set. */
export type WorkloadPatch = {
  readonly image?: string;
  readonly command?: readonly string[];
  /** Variables to add or replace; others stay as the YAML wrote them. */
  readonly environment?: EnvironmentValues;
};

/** A typed change to one imported declaration. */
export type Patch = {
  readonly kind: "patch";
  readonly ref: string;
  /** Members the SDK does not support; reported when the model encodes. */
  readonly problems: readonly Diagnostic[];
  /** Applies the patch and records the JSON pointers of the members it set or removed. */
  readonly apply: (declaration: Declaration) => Declaration;
};

const SUPPORTED_MEMBERS: readonly string[] = ["image", "command", "environment"];

function unsupported(patch: object): Diagnostic[] {
  return Object.keys(patch)
    .filter((member) => !SUPPORTED_MEMBERS.includes(member))
    .map((member) =>
      diagnostic(
        "sdk.unsupported_field",
        pointerOf("spec", member),
        "a typed patch of a workload sets image, command or environment only",
      ),
    );
}

type Applied = { readonly spec: JsonObject; readonly fields: readonly string[] };

function withImage(applied: Applied, image: string): Applied {
  const { build, ...rest } = applied.spec;
  const removed = build === undefined ? [] : ["/spec/build"];
  return { spec: { ...rest, image }, fields: [...applied.fields, ...removed, "/spec/image"] };
}

function withEnvironment(applied: Applied, values: EnvironmentValues): Applied {
  const environment = { ...asObject(applied.spec.environment), ...environmentJson(values) };
  const fields = Object.keys(values).map((name) => `/spec${pointerOf("environment", name)}`);
  return { spec: { ...applied.spec, environment }, fields: [...applied.fields, ...fields] };
}

function applyPatch(spec: JsonObject, patch: WorkloadPatch): Applied {
  let applied: Applied = { spec, fields: [] };
  if (patch.image !== undefined) {
    applied = withImage(applied, patch.image);
  }
  if (patch.command !== undefined) {
    applied = {
      spec: { ...applied.spec, command: [...patch.command] },
      fields: [...applied.fields, "/spec/command"],
    };
  }
  if (patch.environment !== undefined) {
    applied = withEnvironment(applied, patch.environment);
  }
  return { spec: applied.spec, fields: [...new Set(applied.fields)].sort() };
}

/**
 * Sets members of a workload that a YAML Fragment declared. The declaration keeps its YAML identity
 * and position; provenance records the patch and the fields it set.
 */
export function patchWorkload(target: ImportedWorkload, patch: WorkloadPatch): Patch {
  return deepFreeze({
    kind: "patch",
    ref: target.ref,
    problems: unsupported(patch),
    apply: (declaration: Declaration): Declaration => {
      const applied = applyPatch(declaration.spec, patch);
      return {
        ...declaration,
        spec: applied.spec,
        patches: [...declaration.patches, applied.fields],
      };
    },
  });
}
