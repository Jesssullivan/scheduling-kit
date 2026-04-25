# Build And Release

## Local bootstrap

The intended fresh-machine path is:

```bash
direnv allow
pnpm install
```

If you are not using `direnv`, enter the same environment with:

```bash
nix develop
```

The dev shell provides:

- Node 22
- pnpm
- Bazel through a Bazelisk wrapper pinned by `.bazelversion`
- MkDocs plus Material
- lightweight repo tooling such as `actionlint`

## Authority model

This repo keeps two deliberately different surfaces:

1. `pnpm` remains the local package-manager and script interface.
2. Bazel defines and builds the publishable package artifact used by CI.

That split is intentional. Nix bootstraps the tools, Bazel models the artifact
graph, and the shared `js-bazel-package` workflow publishes from
`./bazel-bin/pkg`.

## Core commands

```bash
pnpm check:release-metadata
pnpm check
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec publint
bazel build //:pkg
```

## Release metadata guardrails

When you change release metadata, keep these aligned:

- `package.json`
- `MODULE.bazel`
- `BUILD.bazel`

Version drift across those files is a bug.

## Docs and LLM surfaces

Derived docs are generated from repo metadata:

```bash
pnpm docs:generate
pnpm docs:check
pnpm docs:serve
```

Those commands regenerate:

- `docs/generated/package-surface.md`
- `docs/generated/release-metadata.md`
- `llms.txt`

The docs site can also be built as a Nix derivation:

```bash
nix build .#docs
nix flake check
```
