# ADR-0001: Runtime dependencies of the authoring SDK

- Status: Proposed
- Date: 2026-10-29

## Context

`@stackpuddle/sdk` reads YAML Fragments and writes the canonical Model file. Both must agree with
the Go engine, byte for byte where the form is specified. The SDK is a library other projects
install, so every runtime dependency becomes theirs too. Today nothing is published and the package
is private.

Two jobs need code the standard library does not hold: parsing YAML with source positions, and
validating documents against stackpuddle's published JSON Schema (draft 2020-12).

## Decision

The package has two runtime dependencies, both pinned to one exact version:

| Package | Version | Job                                                                                                                                                                                                       |
| ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yaml`  | 2.9.1   | Parses YAML 1.2 with line and column positions for provenance. The SDK walks the parsed document itself and refuses what the Go decoder refuses.                                                          |
| `ajv`   | 8.20.0  | Validates imported Fragments and emitted Models against `schemas/v1`. No loader is configured, so a `$ref` outside the registered schemas fails at compile time instead of reading a file or the network. |

The development tools are the ones the TypeScript pack names (compiler, ESLint with
typescript-eslint and import-x, Prettier, dependency-cruiser, knip, vitest, publint and
`@arethetypeswrong/cli`), pinned exactly in the root `package.json`.

The schemas are copied from the stackpuddle checkout into `packages/sdk/src/schema/generated/v1/`
by `task generate:schemas`. `task check:generated` fails, naming each stale file, when the copy
differs from the checkout.

## Rejected alternatives

- `zod` for validation: its schemas would be a hand-written second description of every document.
  The JSON Schema in stackpuddle is the single description of the shape (T5), so the SDK validates
  against that file.
- `js-yaml`: no source positions, and its default schema accepts tags the model refuses.
- A hand-written YAML parser: too much surface to keep identical to the Go decoder.
- Publishing the schemas as a package now: nothing is published before m05. The generated copy is
  the cost until then.

## Consequences

- A change to `schemas/v1` in stackpuddle makes `check:generated` fail until the copy is regenerated
  and `tests/conformance/stackpuddle.revision` is moved to the new tree.
- Both runtime dependencies run in the SDK's host process during authoring. They are trusted client
  or CI code; neither is loaded by the engine or the CLI.
- Adding a third runtime dependency needs a new record.

## Verification

`tests/unit/pins.test.ts` fails on any range operator in a dependency field. `pnpm install
--frozen-lockfile` fails when the lockfile and the manifests disagree. `task test:package` installs
the packed tarball with these two dependencies in a scratch project.
