import {
  type Document,
  LineCounter,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
} from "yaml";

import type { JsonValue } from "../model/json.js";
import {
  type Diagnostic,
  type Result,
  diagnostic,
  fail,
  locate,
  pointerOf,
  succeed,
} from "../model/result.js";

/** The size and depth limits the Go decoder applies to every YAML input. */
export const YAML_LIMITS = { maxBytes: 1_048_576, maxDepth: 64 } as const;

export type Position = { readonly line: number; readonly column: number };

/** A YAML document read as plain JSON data, with the position of every member and item. */
export type ReadDocument = {
  readonly tree: JsonValue;
  /** JSON pointer to the position of the member's key, or of the item for a sequence. */
  readonly positions: ReadonlyMap<string, Position>;
};

type SyntaxCode =
  | "invalid_yaml"
  | "multiple_documents"
  | "duplicate_key"
  | "non_string_key"
  | "alias"
  | "merge_key"
  | "custom_tag"
  | "non_json_number"
  | "null_value"
  | "invalid_encoding"
  | "limit_exceeded";

const MESSAGES = {
  invalid_yaml: "the file is not valid YAML",
  multiple_documents: "a file holds one YAML document",
  duplicate_key: "the key is written twice",
  non_string_key: "mapping keys must be strings",
  alias: "aliases are not accepted",
  merge_key: "merge keys are not accepted",
  custom_tag: "only the core YAML tags are accepted",
  non_json_number: "the number is not written in JSON number syntax",
  null_value: "null is not accepted; omit the member instead",
  invalid_encoding: "the file is not valid UTF-8",
  limit_exceeded: "the input is larger or deeper than the limits allow",
} as const satisfies Record<SyntaxCode, string>;

const CORE_TAG_PREFIX = "tag:yaml.org,2002:";
const ALLOWED_TAGS: ReadonlySet<string> = new Set(
  ["str", "bool", "int", "float", "timestamp"].map((name) => `${CORE_TAG_PREFIX}${name}`),
);
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const MERGE_KEY = "<<";

type Place = { readonly file: string; readonly line?: number; readonly column?: number };

function syntax(code: SyntaxCode, pointer: string, place: Place): Diagnostic {
  return locate(diagnostic(`syntax.${code}`, pointer, MESSAGES[code]), place);
}

const CONTINUATION_MASK = 0xc0;
const CONTINUATION = 0x80;
const FIRST_VALID_LEAD = 0xc2;
const LAST_VALID_LEAD = 0xf4;

function isContinuation(byte: number | undefined): boolean {
  return ((byte ?? 0) & CONTINUATION_MASK) === CONTINUATION;
}

function neverValidByte(byte: number | undefined): boolean {
  const value = byte ?? 0;
  return value > LAST_VALID_LEAD || (value >= CONTINUATION_MASK && value < FIRST_VALID_LEAD);
}

function decodes(bytes: Uint8Array, stream: boolean): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream });
    return true;
  } catch {
    return false;
  }
}

function sequenceStart(bytes: Uint8Array, from: number): number {
  let start = from;
  while (start > 0 && isContinuation(bytes[start])) {
    start -= 1;
  }
  return start;
}

/** Returns the smallest prefix length that cannot be the start of valid UTF-8. */
function shortestInvalidPrefix(bytes: Uint8Array): number {
  let low = 1;
  let high = bytes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (decodes(bytes.subarray(0, middle), true)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Returns the byte offset where the first invalid UTF-8 sequence starts, or -1 when there is none. */
function firstInvalidUtf8(bytes: Uint8Array): number {
  if (decodes(bytes, false)) {
    return -1;
  }
  if (decodes(bytes, true)) {
    return sequenceStart(bytes, bytes.length - 1);
  }
  // Byte `last` is the first that makes the prefix invalid. Unless it is invalid by itself, it broke a
  // sequence that started before it.
  const last = shortestInvalidPrefix(bytes) - 1;
  const interrupted = !isContinuation(bytes[last]) && !neverValidByte(bytes[last]);
  return sequenceStart(bytes, interrupted ? last - 1 : last);
}

function decode(bytes: Uint8Array, file: string): Result<string, readonly Diagnostic[]> {
  const bad = firstInvalidUtf8(bytes);
  if (bad < 0) {
    return succeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  const lines = new TextDecoder("utf-8").decode(bytes.subarray(0, bad)).split("\n");
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return fail([syntax("invalid_encoding", "", { file, line: lines.length, column })]);
}

type Tagged = Scalar | YAMLMap | YAMLSeq;

function isNode(value: unknown): value is Node {
  return isScalar(value) || isMap(value) || isSeq(value) || isAlias(value);
}

class Walker {
  readonly problems: Diagnostic[] = [];
  readonly positions = new Map<string, Position>();

  constructor(
    private readonly file: string,
    private readonly lines: LineCounter,
    private readonly text: string,
  ) {}

  private note(code: SyntaxCode, pointer: string, offset: number): void {
    const { line, col } = this.lines.linePos(offset);
    this.problems.push(syntax(code, pointer, { file: this.file, line, column: col }));
  }

  private record(pointer: string, offset: number): void {
    const { line, col } = this.lines.linePos(offset);
    this.positions.set(pointer, { line, column: col });
  }

  /** Where a tag starts: the token before the value, when that token begins with an exclamation mark. */
  private tagStart(valueOffset: number): number {
    let end = valueOffset;
    while (end > 0 && /[ \t]/u.test(this.text.charAt(end - 1))) {
      end -= 1;
    }
    let start = end;
    while (start > 0 && !/\s/u.test(this.text.charAt(start - 1))) {
      start -= 1;
    }
    return this.text.charAt(start) === "!" ? start : valueOffset;
  }

  private tagIsAllowed(node: Tagged, pointer: string): boolean {
    if (node.tag === undefined || ALLOWED_TAGS.has(node.tag)) {
      return true;
    }
    this.note("custom_tag", pointer, this.tagStart(node.range?.[0] ?? 0));
    return false;
  }

  private number(node: Scalar, value: number, pointer: string): JsonValue | undefined {
    const source = node.source ?? String(value);
    if (Number.isFinite(value) && JSON_NUMBER.test(source.trim())) {
      return value;
    }
    this.note("non_json_number", pointer, node.range?.[0] ?? 0);
    return undefined;
  }

  private scalar(node: Scalar, pointer: string): JsonValue | undefined {
    if (!this.tagIsAllowed(node, pointer)) {
      return undefined;
    }
    const value: unknown = node.value;
    if (typeof value === "number") {
      return this.number(node, value, pointer);
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    const offset = node.range?.[0] ?? 0;
    this.note(value === null || value === undefined ? "null_value" : "custom_tag", pointer, offset);
    return undefined;
  }

  /** Returns the key's text, or undefined after reporting why the key is refused. */
  private key(pair: Pair, parent: string, seen: Set<string>): string | undefined {
    const key: unknown = pair.key;
    const offset = isNode(key) ? (key.range?.[0] ?? 0) : 0;
    if (!isScalar(key) || typeof key.value !== "string") {
      this.note("non_string_key", parent, offset);
    } else if (key.value === MERGE_KEY && key.type === "PLAIN") {
      this.note("merge_key", `${parent}/${MERGE_KEY}`, offset);
    } else if (seen.has(key.value)) {
      this.note("duplicate_key", `${parent}${pointerOf(key.value)}`, offset);
    } else {
      seen.add(key.value);
      return key.value;
    }
    return undefined;
  }

  private map(node: YAMLMap, pointer: string, depth: number): JsonValue {
    const seen = new Set<string>();
    const entries: [string, JsonValue][] = [];
    for (const pair of node.items) {
      const name = this.key(pair, pointer, seen);
      if (name === undefined) {
        continue;
      }
      const memberPointer = `${pointer}${pointerOf(name)}`;
      const key: unknown = pair.key;
      if (isScalar(key)) {
        this.record(memberPointer, key.range?.[0] ?? 0);
      }
      const value = this.node(isNode(pair.value) ? pair.value : null, memberPointer, depth + 1);
      if (value !== undefined) {
        entries.push([name, value]);
      }
    }
    return Object.fromEntries(entries);
  }

  private seq(node: YAMLSeq, pointer: string, depth: number): JsonValue {
    const items: JsonValue[] = [];
    node.items.forEach((item: unknown, index) => {
      const itemNode = isNode(item) ? item : null;
      const itemPointer = `${pointer}${pointerOf(index)}`;
      if (itemNode?.range) {
        this.record(itemPointer, itemNode.range[0]);
      }
      const value = this.node(itemNode, itemPointer, depth + 1);
      if (value !== undefined) {
        items.push(value);
      }
    });
    return items;
  }

  private collection(
    node: YAMLMap | YAMLSeq,
    pointer: string,
    depth: number,
  ): JsonValue | undefined {
    if (depth > YAML_LIMITS.maxDepth) {
      this.note("limit_exceeded", pointer, node.range?.[0] ?? 0);
      return undefined;
    }
    if (!this.tagIsAllowed(node, pointer)) {
      return undefined;
    }
    return isMap(node) ? this.map(node, pointer, depth) : this.seq(node, pointer, depth);
  }

  node(node: Node | null, pointer: string, depth: number): JsonValue | undefined {
    if (node === null) {
      this.note("null_value", pointer, 0);
    } else if (isAlias(node)) {
      this.note("alias", pointer, node.range?.[0] ?? 0);
    } else if (isScalar(node)) {
      return this.scalar(node, pointer);
    } else {
      return this.collection(node, pointer, depth);
    }
    return undefined;
  }
}

function firstParseErrorLine(document: Document.Parsed): number | undefined {
  return document.errors[0]?.linePos?.[0].line;
}

function documentProblem(
  documents: readonly Document.Parsed[],
  lines: LineCounter,
  file: string,
): Diagnostic | undefined {
  const broken = documents.find((document) => document.errors.length > 0);
  if (broken !== undefined) {
    const line = firstParseErrorLine(broken);
    return syntax("invalid_yaml", "", line === undefined ? { file } : { file, line });
  }
  const second = documents[1];
  if (second !== undefined) {
    const { line, col } = lines.linePos(second.range[0]);
    return syntax("multiple_documents", "", { file, line, column: col });
  }
  return undefined;
}

/**
 * Reads one YAML document into JSON data, accepting the subset the Go decoder accepts: one UTF-8
 * document, string keys, no duplicate keys, aliases, merge keys, custom tags or null, JSON numbers
 * only, at most 1 MiB and 64 levels of nesting. Pure; the caller supplies the bytes.
 */
export function readYaml(
  file: string,
  input: string | Uint8Array,
): Result<ReadDocument, readonly Diagnostic[]> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.length > YAML_LIMITS.maxBytes) {
    return fail([syntax("limit_exceeded", "", { file })]);
  }
  const decoded = decode(bytes, file);
  if (!decoded.ok) {
    return decoded;
  }
  const lines = new LineCounter();
  const documents = parseAllDocuments(decoded.value, {
    lineCounter: lines,
    version: "1.2",
    schema: "core",
    merge: false,
    uniqueKeys: false,
  });
  const problem = documentProblem(documents, lines, file);
  if (problem !== undefined) {
    return fail([problem]);
  }
  const walker = new Walker(file, lines, decoded.value);
  const tree = walker.node(documents[0]?.contents ?? null, "", 1);
  if (walker.problems.length > 0 || tree === undefined) {
    return fail(walker.problems);
  }
  return succeed({ tree, positions: walker.positions });
}
