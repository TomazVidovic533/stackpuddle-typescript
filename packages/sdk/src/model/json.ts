/** JSON data as the model holds it: no null, no undefined, no functions. */
export type JsonValue = string | number | boolean | JsonObject | readonly JsonValue[];

export type JsonObject = { readonly [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Returns the value as an object, or an empty object when it is anything else. */
export function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

/** Returns the value as a list, or an empty list when it is anything else. */
export function asList(value: JsonValue | undefined): readonly JsonValue[] {
  return isJsonArray(value) ? value : [];
}

/** Returns the value when it is text. */
export function asText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Freezes a value and everything below it, so a declaration cannot change after construction. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
