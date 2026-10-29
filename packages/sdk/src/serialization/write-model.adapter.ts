import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { Project } from "../composition/project.js";
import { ioFailure } from "../model/io-failure.js";
import { type Diagnostic, type Result, fail, succeed } from "../model/result.js";

import { encodeModel } from "./encode-model.js";

export type WriteOptions = { readonly signal?: AbortSignal };

/**
 * Encodes a project and writes the canonical model file where the caller says. Nothing is written
 * when the project has problems. The file holds configuration intent and secret references only.
 * The bytes go to a sibling temporary file that is renamed over the target, so a reader sees the
 * previous file or the new one, never a truncated one.
 */
export async function writeModelFile(
  project: Project,
  path: string,
  options: WriteOptions = {},
): Promise<Result<void, readonly Diagnostic[]>> {
  const encoded = encodeModel(project);
  if (!encoded.ok) {
    return encoded;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, encoded.value, {
      encoding: "utf8",
      flag: "wx",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    options.signal?.throwIfAborted();
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true });
    return fail([
      ioFailure(cause, options.signal, { code: "sdk.write_failed", what: "the model file" }),
    ]);
  }
  return succeed(undefined);
}
