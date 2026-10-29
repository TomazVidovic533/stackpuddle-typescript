import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** What stackpuddle.revision records: the sibling checkout the parity cases were reviewed in. */
export type Revision = {
  readonly path: string;
  readonly commit: string;
  readonly uncommitted: boolean;
  readonly tree: {
    readonly algorithm: "sha256";
    readonly paths: readonly string[];
    readonly digest: string;
  };
};

export class CheckoutError extends Error {
  override readonly name = "CheckoutError";
}

const REVISION_FILE = new URL("../stackpuddle.revision", import.meta.url);

export function readRevision(file: URL | string = REVISION_FILE): Revision {
  return JSON.parse(readFileSync(file, "utf8")) as Revision;
}

function filesUnder(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(root, child) : [child];
  });
}

/**
 * SHA-256 over the sorted relative paths of every file under the given paths, each written as
 * `path NUL size NUL bytes`.
 */
export function treeDigest(root: string, paths: readonly string[]): string {
  const files = paths
    .flatMap((path) => filesUnder(root, path))
    .map((file) => file.split("\\").join("/"))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(join(root, file));
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/**
 * Fails by name when the stackpuddle checkout is missing or is not the recorded tree, so a parity
 * run never compares against cases nobody reviewed.
 */
export function verifyCheckout(revision: Revision, checkout: string): void {
  if (!existsSync(checkout) || !statSync(checkout).isDirectory()) {
    throw new CheckoutError(
      `stackpuddle checkout not found at ${revision.path}; check out the commit in tests/conformance/stackpuddle.revision`,
    );
  }
  const digest = treeDigest(checkout, revision.tree.paths);
  if (digest !== revision.tree.digest) {
    throw new CheckoutError(
      `stackpuddle at ${revision.path} is not the recorded tree: expected ${revision.tree.digest}, found ${digest}; recorded commit ${revision.commit}`,
    );
  }
}

/** The recorded sibling checkout, resolved against the repository root. */
export function recordedCheckout(revision: Revision = readRevision()): string {
  return resolve(new URL("../../..", import.meta.url).pathname, revision.path);
}
