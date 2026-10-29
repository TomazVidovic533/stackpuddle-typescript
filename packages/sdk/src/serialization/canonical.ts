import { type JsonValue, isJsonArray, isJsonObject } from "../model/json.js";

const INDENT = "  ";

function compareUtf16(a: string, b: string): number {
  // The relational operators compare UTF-16 code units, which is the order the model specifies.
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(value: JsonValue, depth: number): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("a canonical document holds finite numbers only");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (isJsonArray(value)) {
    const items = value.map((item) => `${inner}${write(item, depth + 1)}`);
    return items.length === 0 ? "[]" : `[\n${items.join(",\n")}\n${outer}]`;
  }
  if (isJsonObject(value)) {
    // Object.keys lists integer-like keys first, so the keys are sorted here instead of relied on.
    const members = Object.keys(value)
      .sort(compareUtf16)
      .map((key) => `${inner}${JSON.stringify(key)}: ${write(value[key] ?? "", depth + 1)}`);
    return members.length === 0 ? "{}" : `{\n${members.join(",\n")}\n${outer}}`;
  }
  throw new TypeError("a canonical document holds JSON values only");
}

/**
 * Prints a value in the canonical form every StackPuddle reader and writer shares: UTF-8 JSON, object
 * keys in UTF-16 code-unit order, two-space indentation, a trailing newline.
 */
export function canonicalize(value: JsonValue): string {
  return `${write(value, 0)}\n`;
}
