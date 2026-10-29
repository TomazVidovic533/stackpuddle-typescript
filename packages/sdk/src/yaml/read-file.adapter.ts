import type { FileHandle } from "node:fs/promises";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { type ImportedFragment, importYaml } from "../composition/imports.js";
import { ioFailure, isMissing } from "../model/io-failure.js";
import {
  type Diagnostic,
  type Result,
  diagnostic,
  fail,
  locate,
  succeed,
} from "../model/result.js";

import { YAML_LIMITS } from "./read-yaml.adapter.js";

export type ReadFileOptions = {
  /** The composition root; the recorded file name is relative to it. */
  readonly root: string;
  readonly signal?: AbortSignal;
};

/** Reads a YAML Fragment file below the composition root and imports it. */
export async function readYamlFile(
  path: string,
  options: ReadFileOptions,
): Promise<Result<ImportedFragment, readonly Diagnostic[]>> {
  const absolute = resolve(options.root, path);
  const file = relative(resolve(options.root), absolute).split(sep).join("/");
  if (isOutside(file)) {
    return outsideRoot(path);
  }
  const read = await readBounded(absolute, file, options);
  return read.ok ? importYaml(file, read.value) : read;
}

function isOutside(file: string): boolean {
  return file === "" || file.startsWith("..") || isAbsolute(file);
}

function outsideRoot(path: string): Result<never, readonly Diagnostic[]> {
  return fail([
    locate(
      diagnostic(
        "sdk.path_outside_root",
        "",
        "an imported file must lie below the composition root",
      ),
      { file: path },
    ),
  ]);
}

function problem(
  code: string,
  message: string,
  file: string,
): Result<never, readonly Diagnostic[]> {
  return fail([locate(diagnostic(code, "", message), { file })]);
}

const CHUNK = 65_536;

/** Reads at most `limit` bytes; returns undefined when the source holds more. */
async function readUpTo(
  handle: FileHandle,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    signal?.throwIfAborted();
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK, limit + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks);
    }
    total += bytesRead;
    if (total > limit) {
      return undefined;
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
}

async function readBounded(
  absolute: string,
  file: string,
  options: ReadFileOptions,
): Promise<Result<Uint8Array, readonly Diagnostic[]>> {
  const { signal } = options;
  try {
    const real = await realpath(absolute);
    if (isOutside(relative(await realpath(resolve(options.root)), real))) {
      return outsideRoot(file);
    }
    if (!(await stat(real)).isFile()) {
      return problem("sdk.not_a_regular_file", "an imported path must be a regular file", file);
    }
    const handle = await open(real, "r");
    try {
      if (!(await handle.stat()).isFile()) {
        return problem("sdk.not_a_regular_file", "an imported path must be a regular file", file);
      }
      const bytes = await readUpTo(handle, YAML_LIMITS.maxBytes, signal);
      return bytes === undefined
        ? problem(
            "syntax.limit_exceeded",
            `the file is larger than ${YAML_LIMITS.maxBytes} bytes`,
            file,
          )
        : succeed(bytes);
    } finally {
      await handle.close();
    }
  } catch (cause) {
    if (isMissing(cause) && signal?.aborted !== true) {
      return problem("reference.path_not_found", "the file does not exist", file);
    }
    return fail([
      locate(ioFailure(cause, signal, { code: "sdk.read_failed", what: "the file" }), { file }),
    ]);
  }
}
