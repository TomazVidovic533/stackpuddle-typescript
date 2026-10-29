/** A problem found in authored input, shaped like the Go model's diagnostics. */
export type Diagnostic = {
  readonly code: string;
  readonly pointer: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
};

/** The outcome of an operation whose failure is expected. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function succeed<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Where a diagnostic points; every member is optional because inputs differ in what they know. */
export type DiagnosticPlace = {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
};

export function diagnostic(code: string, pointer: string, message: string): Diagnostic {
  return { code, pointer, message };
}

/** Returns a copy of a diagnostic that points at a file, line and column. */
export function locate(item: Diagnostic, place: DiagnosticPlace): Diagnostic {
  return {
    ...item,
    ...(place.file === undefined ? {} : { file: place.file }),
    ...(place.line === undefined ? {} : { line: place.line }),
    ...(place.column === undefined ? {} : { column: place.column }),
  };
}

/** Escapes one JSON Pointer segment (RFC 6901). */
function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Joins JSON Pointer segments under a base pointer. */
export function pointerOf(...segments: readonly (string | number)[]): string {
  return segments.map((segment) => `/${escapePointerSegment(String(segment))}`).join("");
}

/** Appends segments to an existing pointer. */
export function pointerUnder(base: string, ...segments: readonly (string | number)[]): string {
  return `${base}${pointerOf(...segments)}`;
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const columns: readonly (readonly [string | number, string | number])[] = [
    [a.file ?? "", b.file ?? ""],
    [a.line ?? 0, b.line ?? 0],
    [a.column ?? 0, b.column ?? 0],
    [a.pointer, b.pointer],
    [a.code, b.code],
  ];
  for (const [left, right] of columns) {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
  }
  return 0;
}

/** Orders diagnostics by file, line, column, pointer and code, comparing strings by UTF-16 units. */
export function sortDiagnostics(items: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...items].sort(compareDiagnostics);
}

/** Closes a switch over a union: a new member makes the call a compile error. */
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
