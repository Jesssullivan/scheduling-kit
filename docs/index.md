# scheduling-kit

`@tummycrypt/scheduling-kit` is the reusable scheduling library for practitioner
and small-business migration flows. It packages backend-agnostic scheduling
contracts, payment adapters, Svelte checkout components, onboarding helpers, and
Effect-powered orchestration without taking ownership of browser automation or
site-specific control planes.

## What this repo owns

- Scheduling contracts and adapters
- Alternative payment adapters and capability contracts
- Svelte checkout UI primitives
- Onboarding helpers for Stripe and PayPal/Venmo
- Test fixtures, mocks, and cassette tooling

## What this repo does not own

- Playwright or DOM automation against third-party booking UIs
- Modal deployment/runtime control
- App-specific admin surfaces
- Site-local orchestration policies

Browser automation and remote Acuity scraping belong in
`@tummycrypt/scheduling-bridge` plus the adopter app that drives it.

## Build truth

This repo intentionally keeps two build surfaces:

- `pnpm` is the local package-manager and script interface
- Bazel defines and builds the publishable package artifact used by CI

The local flake and `.envrc` exist to provision those tools consistently on a
fresh machine. They do not replace Bazel or become a second package authority.

## Where to go next

- [Build & Release](build-and-release.md) for bootstrap, Bazel, Nix, and publish hygiene
- [Testing](testing.md) for the actual test layout and commands in this tree
- [Tracing](tracing.md) for cassette-based recording and replay details
- [Generated package surface](generated/package-surface.md) for the current export map and source inventory
- [Generated release metadata](generated/release-metadata.md) for version and publish inputs derived from repo files
