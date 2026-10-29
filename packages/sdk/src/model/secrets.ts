import { type Diagnostic, type Result, diagnostic, fail, succeed } from "./result.js";

/** A logical secret identifier. It is never a secret value. */
export type SecretRef = { readonly kind: "secret-ref"; readonly id: string };

/** The provider that resolves secret references in an environment. */
export type SecretProvider = { readonly kind: "secret-provider"; readonly id: string };

const SECRET_ID_MAX = 128;
const secretIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function parseSecretRef(id: string): Result<SecretRef, Diagnostic> {
  if (id.length === 0 || id.length > SECRET_ID_MAX || !secretIdPattern.test(id)) {
    return fail(
      diagnostic(
        "structure.invalid_value",
        "",
        "a secret reference is a logical identifier of lowercase words joined by hyphens, never a value",
      ),
    );
  }
  return succeed(Object.freeze({ kind: "secret-ref", id }));
}

/** Builds a secret reference; throws RangeError for text that is not an identifier. */
export function secretRef(id: string): SecretRef {
  const parsed = parseSecretRef(id);
  if (!parsed.ok) {
    throw new RangeError(parsed.error.message);
  }
  return parsed.value;
}

export const secretProviders: { readonly local: SecretProvider } = Object.freeze({
  local: Object.freeze({ kind: "secret-provider", id: "local" } as const),
});
