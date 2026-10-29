import { type Diagnostic, diagnostic } from "./result.js";

/** Whether a failure is the caller's cancellation, which is reported as its own outcome. */
function isCancelled(cause: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (cause instanceof Error && cause.name === "AbortError");
}

function errnoOf(cause: unknown): string | undefined {
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** Whether a failure says the path does not exist. */
export function isMissing(cause: unknown): boolean {
  const errno = errnoOf(cause);
  return errno === "ENOENT" || errno === "ENOTDIR";
}

/**
 * Classifies a failed file operation without echoing the path or the message: cancellation by the
 * caller, or any other failure named by the caller's code with the system's error name.
 */
export function ioFailure(
  cause: unknown,
  signal: AbortSignal | undefined,
  other: { readonly code: string; readonly what: string },
): Diagnostic {
  if (isCancelled(cause, signal)) {
    return diagnostic("sdk.cancelled", "", "the operation was cancelled by the caller");
  }
  return diagnostic(
    other.code,
    "",
    `${other.what} could not be used (${errnoOf(cause) ?? "error"})`,
  );
}
