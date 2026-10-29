import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function manifests(): string[] {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "packages", entry.name, "package.json"));
  return [join(root, "package.json"), ...packages];
}

describe("exact pins", () => {
  it.each(manifests())("%s pins every dependency to one exact version", (file) => {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const loose: string[] = [];
    for (const field of FIELDS) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (!EXACT.test(version)) {
          loose.push(`${field}.${name}@${version}`);
        }
      }
    }
    expect(loose, "dependency fields with a range operator, tag or protocol").toEqual([]);
  });

  it("saves exact versions by default", () => {
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toContain("save-exact=true");
  });
});
