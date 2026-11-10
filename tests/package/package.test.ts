import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readRevision, recordedCheckout, verifyCheckout } from "../conformance/support/checkout.js";

const repoRoot = new URL("../../", import.meta.url).pathname;
const distRoot = join(repoRoot, "dist");
const TIMEOUT = 240_000;

const SCRATCH_SCRIPT = `
import { defineProject, encodeModel, port, secretProviders, secretRef, service } from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";
import { database, instance, migrationUser, permissionRole, runtimeUser, schema } from "@stackpuddle/sdk/postgres";

const api = service("api", {
  image: "ghcr.io/example/api:1.4.2",
  environment: { LOG_LEVEL: "info" },
  listeners: { http: { port: port(8080), protocol: "http" } },
});
const writer = permissionRole("writer");
const migrator = migrationUser("migrator", { password: secretRef("migrator-password") });
const primary = instance("primary", {
  users: [runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] }), migrator],
  roles: [writer],
  databases: [
    database("shop", {
      owner: migrator,
      connectRoles: [writer],
      schemas: [schema("public", [{ role: writer, tables: ["SELECT", "INSERT"], sequences: ["USAGE"] }])],
    }),
  ],
});
const local = environment("local", { context: "desktop-linux", secrets: secretProviders.local });
const result = encodeModel(defineProject("shop", { declarations: [api, primary], environments: [local] }));
if (!result.ok) {
  throw new Error(JSON.stringify(result.error));
}
process.stdout.write(result.value);
`;

const MANIFEST_SCRIPT = `
import { defineProject, encodeModel } from "@stackpuddle/sdk";

const result = encodeModel(
  defineProject("shop", { manifest: "stackpuddle.manifest.yaml", lock: "stackpuddle.lock" }),
);
if (!result.ok) {
  throw new Error(JSON.stringify(result.error));
}
process.stdout.write(result.value);
`;

let tarball = "";
let scratch = "";
const extraScratch: string[] = [];

function tarballs(): string[] {
  return existsSync(distRoot) ? readdirSync(distRoot).filter((name) => name.endsWith(".tgz")) : [];
}

beforeAll(() => {
  const found = tarballs();
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(
      `expected exactly one packed tarball in dist/, found ${found.length}; run task test:package`,
    );
  }
  tarball = join(distRoot, found[0]);
  scratch = mkdtempSync(join(tmpdir(), "sp-package-"));
});

afterAll(() => {
  for (const dir of [scratch, ...extraScratch]) {
    if (dir !== "") {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function installTarball(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "scratch", private: true, type: "module" }),
  );
  writeFileSync(join(dir, ".npmrc"), "save-exact=true\n");
  execFileSync(
    "pnpm",
    ["add", tarball, "--ignore-workspace", "--prefer-offline", "--ignore-scripts"],
    { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("the packed SDK", () => {
  it("holds the built files, the schemas it validates with and the licence, and no sources or tests", () => {
    const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const required of [
      "package/package.json",
      "package/LICENSE",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/dist/postgres/index.js",
      "package/dist/compose/index.js",
      "package/dist/schema/generated/v1/model.schema.json",
      "package/dist/schema/generated/v1/fragment.schema.json",
      "package/dist/schema/generated/v1/definitions.schema.json",
    ]) {
      expect(listing, required).toContain(required);
    }
    expect(
      listing.filter(
        (name) => name.includes("/src/") || name.includes("/tests/") || name.endsWith(".test.js"),
      ),
    ).toEqual([]);
  });

  it(
    "imports from a scratch project through its three entry points and emits stackpuddle's expected intent",
    () => {
      installTarball(scratch);
      writeFileSync(join(scratch, "smoke.mjs"), SCRATCH_SCRIPT);
      const emitted = execFileSync("node", ["smoke.mjs"], { cwd: scratch, encoding: "utf8" });

      const revision = readRevision();
      const checkout = recordedCheckout(revision);
      verifyCheckout(revision, checkout);
      const expected = JSON.parse(
        readFileSync(
          join(checkout, "tests/conformance/cases/parity/plain-declarations/expected/model.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const actual = JSON.parse(emitted) as Record<string, unknown>;
      delete expected["provenance"];
      delete actual["provenance"];
      expect(actual).toEqual(expected);
    },
    TIMEOUT,
  );

  it(
    "the packed SDK emits the manifest and lock a project names",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "sp-package-manifest-"));
      extraScratch.push(dir);
      installTarball(dir);
      writeFileSync(join(dir, "manifest.mjs"), MANIFEST_SCRIPT);
      const emitted = JSON.parse(
        execFileSync("node", ["manifest.mjs"], { cwd: dir, encoding: "utf8" }),
      ) as { spec: Record<string, unknown> };
      expect(emitted.spec).toEqual({
        manifest: "stackpuddle.manifest.yaml",
        lock: "stackpuddle.lock",
      });
    },
    TIMEOUT,
  );
});
