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

The active workflow contract uses repo-owned runner registration with Tinyland
capability labels. npmjs publication is permanently disabled; the publish path
validates the Bazel artifact and publishes the derived GitHub Packages package.
See the delivery doctrine below.

## Delivery doctrine

Package delivery follows one source of truth:

1. The Bzlmod module graph is the canonical (SSOT) delivery mechanism.
   Consumers depend on `tummycrypt_scheduling_kit` through the
   `tinyland-inc/bazel-registry` registry line already present in `.bazelrc`.
2. GitHub Packages (`@jesssullivan/scheduling-kit`) is a derived package: the
   out-of-ecosystem alternative route for npm-style consumers, built from the
   same Bazel `//:pkg` output (`./bazel-bin/pkg`) that the module graph models.
3. npmjs (`@tummycrypt/scheduling-kit`) is retired for first-party delivery.
   It is frozen at `0.8.0`, and `npm_publish_mode: disabled` in the CI and
   publish workflows is permanent policy, not a temporary outage.

## Bazel Cache Contract

Local Bazel use defaults to the repo-local disk cache in `.bazelrc`:

```bash
bazel build //:pkg
bazel test //:test
```

Contributor machines can opt into a remote cache by adding a private
`user.bazelrc`; this repository intentionally keeps private cache topology out
of public source. CI remote-cache behavior is owned by the shared
`js-bazel-package` workflow and its runner environment. The public contract is
that CI must still publish the Bazel package artifact from `./bazel-bin/pkg`
with local fallback available when the remote cache is unavailable.

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

## Release Checklist

Before cutting a package release, verify these surfaces together:

- Bazel registry entry in `tinyland-inc/bazel-registry` for the new version
  (the SSOT delivery surface)
- GitHub Packages package: `@jesssullivan/scheduling-kit`, derived from the
  Bazel `//:pkg` artifact
- tag and GitHub release for the package version
- Bazel package artifact from `./bazel-bin/pkg`
- consumer dependency range in bridge and app repos
- npmjs stays frozen: `@tummycrypt/scheduling-kit` is retired at `0.8.0`, and
  `npm_publish_mode: disabled` must remain in both workflows

Historical releases before this checklist may have npm versions without matching
GitHub Releases. Document or backfill those explicitly instead of treating the
latest GitHub Release as complete package truth.

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
