# Using the SDK

`@stackpuddle/sdk` declares a project in TypeScript and writes the canonical Model file that the
StackPuddle CLI reads (`stackpuddle --file model.json`). Authoring is trusted code that runs in your
own process or CI. The SDK never talks to the engine and never provisions anything.

Nothing is published yet. The package is private, and `task test:package` packs
`dist/stackpuddle-sdk-0.0.0.tgz`.

## Entry points

| Import                      | Holds                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@stackpuddle/sdk`          | Workloads, jobs, inputs, bindings, applications, secret handles, YAML import, patches, `defineProject`, `encodeModel`, `writeModelFile`, `supportedContract` |
| `@stackpuddle/sdk/postgres` | The PostgreSQL module: `instance`, `database`, `schema`, `permissionRole`, `runtimeUser`, `migrationUser`                                                    |
| `@stackpuddle/sdk/compose`  | `environment`, a Docker Compose environment                                                                                                                  |

## A project in code

```ts
import {
  defineProject,
  port,
  secretProviders,
  secretRef,
  service,
  writeModelFile,
} from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";
import {
  database,
  instance,
  migrationUser,
  permissionRole,
  runtimeUser,
  schema,
} from "@stackpuddle/sdk/postgres";

const api = service("api", {
  image: "ghcr.io/example/api:1.4.2",
  listeners: { http: { port: port(8080), protocol: "http" } },
});

const writer = permissionRole("writer");
const migrator = migrationUser("migrator", { password: secretRef("migrator-password") });
const primary = instance("primary", {
  users: [
    runtimeUser("app", { password: secretRef("app-password"), memberOf: [writer] }),
    migrator,
  ],
  roles: [writer],
  databases: [
    database("shop", {
      owner: migrator,
      connectRoles: [writer],
      schemas: [
        schema("public", [{ role: writer, tables: ["SELECT", "INSERT"], sequences: ["USAGE"] }]),
      ],
    }),
  ],
});

const local = environment("local", { context: "desktop-linux", secrets: secretProviders.local });
const project = defineProject("shop", { declarations: [api, primary], environments: [local] });

const written = await writeModelFile(project, "model.json");
if (!written.ok) {
  // Every problem carries a code, a pointer and, for YAML input, a file and position.
  console.error(written.error);
}
```

Secrets are handles. `secretRef` takes a logical identifier such as `app-password`, never a value,
and a secret input cannot take a value at all.

## What the compiler checks

- An export names a listener the workload declares.
- `bind(consumer, dependency, source)` names a dependency the consumer declares, and the source
  serves the capability that dependency needs.
- A database owner is a migration user.
- Privileges, file modes and sensitivities come from closed sets.

## What `encodeModel` checks

References into objects imported from YAML are invisible to the compiler, so `encodeModel` checks
them before it produces any bytes, with the Go model's codes and pointers:
`identity.duplicate_declaration`, `reference.unknown_export`, `reference.unknown_listener`,
`reference.unknown_dependency`, `reference.unknown_object` and `binding.capability_mismatch`. The
published JSON Schema validates the whole document last. Nothing is written for a project with
problems.

The PostgreSQL semantic rules (a role used but not declared, an owner that is not a migration user
by name) belong to the Go validator. The CLI runs it; the SDK does not repeat it.

## Importing YAML and patching it

```ts
import { defineProject, patchWorkload, readYamlFile } from "@stackpuddle/sdk";

const imported = await readYamlFile("services/workloads.yaml", { root: projectRoot });
if (!imported.ok) throw new Error(imported.error.map((item) => item.code).join(", "));

const patch = patchWorkload(imported.value.workload("api"), { image: "ghcr.io/example/api:1.5.0" });
const project = defineProject("shop", { imports: [imported.value], patches: [patch] });
```

The composition root is explicit: only the fragments passed in `imports` take part. An imported
declaration keeps its YAML identity and the file, line and column of its key; each patch is recorded
with the fields it set (`/spec/image`). The same name declared in code and in YAML fails with
`identity.duplicate_declaration`, at the later declaration.

The YAML reader accepts the same subset as the Go decoder: one UTF-8 document up to 1 MiB and 64
levels deep, string keys only, and no duplicate keys, aliases, merge keys, custom tags, null or
numbers JSON cannot write. Unknown fields fail with `structure.unknown_field`. A Fragment with
another `apiVersion` fails with `sdk.unsupported_api_version`; a patch member the SDK does not
support fails with `sdk.unsupported_field`. Nothing is dropped.

## Contract

`supportedContract` lists the model API versions (`stackpuddle/v1`) and the authoring capabilities
this SDK supports. It states no CLI version range: the CLI reads the Model file and checks the API
version itself.

## Developing the SDK

`task check` runs everything below without Docker. It needs the stackpuddle checkout next to this
repository (`../stackpuddle`), at the tree `tests/conformance/stackpuddle.revision` records.

| Task                          | Does                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `task install`                | `pnpm install --frozen-lockfile`                                               |
| `task check:pins`             | Fails on a version range in any dependency field                               |
| `task typecheck`              | `tsc --noEmit` for the package and for the tests                               |
| `task lint`, `task format`    | ESLint (type-aware) and Prettier                                               |
| `task depcruise`, `task knip` | Dependency direction and cycles; unused files, exports and dependencies        |
| `task check:generated`        | The generated schema copy equals stackpuddle's                                 |
| `task test`                   | Unit, type, composition and conformance tests                                  |
| `task test:package`           | Packs the SDK, runs publint and attw, imports the tarball in a scratch project |

The parity cases live in stackpuddle (`tests/conformance/cases/parity/`). This repository holds the
TypeScript half of each case in `tests/conformance/cases/<case>.ts` and a runner that fails by name
when the checkout is missing or is not the recorded tree.
