import { type Diagnostic, type Result, diagnostic, fail, succeed } from "./result.js";

declare const brand: unique symbol;
type Brand<Name extends string> = string & { readonly [brand]: Name };

/** A workload, module instance, client, application, input, listener, export or dependency key. */
export type ObjectKey = Brand<"ObjectKey">;
/** A project or environment name. */
export type ScopeName = Brand<"ScopeName">;
/** A capability such as `module.postgres/1`. */
export type Capability = Brand<"Capability">;
/** An environment variable name. */
export type EnvKey = Brand<"EnvKey">;
/** A module definition name. */
export type ModuleName = Brand<"ModuleName">;

const kebab = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const OBJECT_KEY_MAX = 30;
const SCOPE_NAME_MAX = 32;
const MODULE_NAME_MAX = 63;
const CAPABILITY_MAX = 128;
const ENV_KEY_MAX = 128;

type NameSpec = { readonly what: string; readonly pattern: RegExp; readonly max: number };

const specs = {
  objectKey: { what: "object key", pattern: new RegExp(`^${kebab}$`, "u"), max: OBJECT_KEY_MAX },
  scopeName: { what: "name", pattern: new RegExp(`^${kebab}$`, "u"), max: SCOPE_NAME_MAX },
  moduleName: { what: "module name", pattern: new RegExp(`^${kebab}$`, "u"), max: MODULE_NAME_MAX },
  capability: {
    what: "capability",
    pattern: new RegExp(`^${kebab}(?:\\.${kebab})+/[1-9][0-9]*$`, "u"),
    max: CAPABILITY_MAX,
  },
  envKey: {
    what: "environment variable name",
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
    max: ENV_KEY_MAX,
  },
} as const satisfies Record<string, NameSpec>;

function parseName<Name extends string>(
  spec: NameSpec,
  text: string,
  pointer: string,
): Result<Brand<Name>, Diagnostic> {
  if (text.length === 0 || text.length > spec.max || !spec.pattern.test(text)) {
    return fail(
      diagnostic(
        "structure.invalid_value",
        pointer,
        `${spec.what} ${JSON.stringify(text)} is not valid: up to ${spec.max} characters matching ${spec.pattern.source}`,
      ),
    );
  }
  return succeed(text as Brand<Name>);
}

export function parseObjectKey(text: string, pointer = ""): Result<ObjectKey, Diagnostic> {
  return parseName<"ObjectKey">(specs.objectKey, text, pointer);
}

export function parseScopeName(text: string, pointer = ""): Result<ScopeName, Diagnostic> {
  return parseName<"ScopeName">(specs.scopeName, text, pointer);
}

export function parseModuleName(text: string, pointer = ""): Result<ModuleName, Diagnostic> {
  return parseName<"ModuleName">(specs.moduleName, text, pointer);
}

export function parseCapability(text: string, pointer = ""): Result<Capability, Diagnostic> {
  return parseName<"Capability">(specs.capability, text, pointer);
}

export function parseEnvKey(text: string, pointer = ""): Result<EnvKey, Diagnostic> {
  return parseName<"EnvKey">(specs.envKey, text, pointer);
}
