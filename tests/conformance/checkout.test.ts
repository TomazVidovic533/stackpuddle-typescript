import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CheckoutError,
  readRevision,
  recordedCheckout,
  treeDigest,
  verifyCheckout,
} from "./support/checkout.js";

const revision = readRevision();
let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "sp-checkout-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function copyRecordedTree(): string {
  const source = recordedCheckout(revision);
  const target = join(scratch, "stackpuddle");
  for (const path of revision.tree.paths) {
    cpSync(join(source, path), join(target, path), { recursive: true });
  }
  return target;
}

describe("the recorded stackpuddle checkout", () => {
  it("is the sibling the revision file names", () => {
    expect(() => {
      verifyCheckout(revision, recordedCheckout(revision));
    }).not.toThrow();
  });

  it("is accepted when a copy holds exactly the recorded tree", () => {
    const copy = copyRecordedTree();
    expect(treeDigest(copy, revision.tree.paths)).toBe(revision.tree.digest);
    expect(() => {
      verifyCheckout(revision, copy);
    }).not.toThrow();
  });

  it("fails by name when the checkout is missing", () => {
    const missing = join(scratch, "absent");
    expect(() => {
      verifyCheckout(revision, missing);
    }).toThrow(CheckoutError);
    expect(() => {
      verifyCheckout(revision, missing);
    }).toThrow(
      /stackpuddle checkout not found at \.\.\/stackpuddle; check out the commit in tests\/conformance\/stackpuddle\.revision/u,
    );
  });

  it("fails by name when one byte of a schema differs", () => {
    const copy = copyRecordedTree();
    const schema = join(copy, "schemas/v1/model.schema.json");
    writeFileSync(schema, `${readFileSync(schema, "utf8")} `);
    expect(() => {
      verifyCheckout(revision, copy);
    }).toThrow(/stackpuddle at \.\.\/stackpuddle is not the recorded tree/u);
  });

  it("fails by name when a case file is added", () => {
    const copy = copyRecordedTree();
    writeFileSync(join(copy, "tests/conformance/cases/parity/extra.yaml"), "a: 1\n");
    expect(() => {
      verifyCheckout(revision, copy);
    }).toThrow(CheckoutError);
  });
});
