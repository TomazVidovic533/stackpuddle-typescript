# StackPuddle TypeScript SDK

Optional authoring SDK for [StackPuddle](https://github.com/TomazVidovic533/stackpuddle). It lets
developers describe application stacks in TypeScript and writes the shared canonical project model
that the StackPuddle CLI and engine read. The SDK never starts or provisions anything.

## Status

Early development. The package `@stackpuddle/sdk` is private and nothing is published yet.

## What works

- Typed declarations for workloads, jobs, inputs, bindings and applications, with the PostgreSQL
  module at `@stackpuddle/sdk/postgres` and a Compose environment at `@stackpuddle/sdk/compose`.
- Explicit import of YAML Fragments and typed patches that keep provenance.
- `encodeModel` and `writeModelFile`, which write the canonical Model file after checking the
  project against stackpuddle's published schemas.
- Parity with stackpuddle's reviewed cases: the same project written in YAML and in TypeScript gives
  the same model.

See [docs/usage.md](docs/usage.md). The runtime dependencies are recorded in
[ADR-0001](docs/architecture/decisions/0001-sdk-dependencies.md).

## Develop

Node 22 and pnpm 10.28.0, with the stackpuddle checkout next to this one (`../stackpuddle`).

```bash
task check
```

## Licence

Apache-2.0. See [LICENSE](LICENSE).
