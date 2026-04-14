# scheduling-kit Agent Notes

This file is the operating brief for AI agents and LLMs working in `@tummycrypt/scheduling-kit`.

## Repo Role

`scheduling-kit` is the reusable, headless scheduling library.

It should own:

- backend-agnostic scheduling abstractions
- payment adapters
- Effect-powered orchestration types and helpers
- Svelte checkout components
- test utilities and fixtures
- adapter contracts that other sites can reuse

It should **not** own:

- site-specific deployment logic
- Vercel environment heuristics
- Acuity browser automation infrastructure
- Modal deployment control

For browser automation and remote Acuity scraping, use `@tummycrypt/scheduling-bridge`.

## Strategic Goal

This package is the reusable migration layer for businesses moving away from Acuity, GlossGenius, and similar closed platforms toward a controlled path:

1. keep the live business running
2. introduce a middleware-backed off-ramp
3. move toward a homegrown backend when the business is ready

The package should be reusable across multiple businesses. Avoid app-specific assumptions.

## Current Tracking

As of `2026-04-13`, the open program work here is primarily:

- milestone: `Sprint T: Migration Platform Contracts`
- issue: `#41` downstream migration/onboarding contract

Historical Sprint S work already landed:

- Bazel/package truth tightening
- docs cleanup from fp-ts drift to Effect
- package/dependency alignment
- boundary cleanup clarifying what stays here vs in the bridge

## Build Truth

There are **two** build surfaces in this repo:

1. `pnpm` is the real packaging and publish path
2. Bazel is the hermetic build graph and conformity guard

Do not confuse them.

### Canonical publish path

Today, package publication is still driven by:

- `pnpm build`
- GitHub Actions publish workflows
- npm / GitHub Packages release jobs

### Bazel role

Bazel exists to provide:

- hermetic graph definition
- version / metadata conformity checks
- future cacheability and reproducibility

It is not yet the direct npm publish entrypoint.

## Bazel Guardrails

When touching release metadata, keep these in sync:

- `package.json`
- `MODULE.bazel`
- `BUILD.bazel`

Version drift across those files is a bug.

Key points:

- `MODULE.bazel` is the Bzlmod entrypoint.
- `BUILD.bazel` describes the hermetic targets.
- `pnpm-lock.yaml` remains important because Bazel translates the lockfile.

## CI / Publishing Truth

### CI

The current CI validates on Node `20` and `22`.

Primary checks:

- `pnpm check`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm build`
- `publint`

Typecheck/lint may be tolerated temporarily in CI if they are marked `continue-on-error`, but that should not be treated as a steady-state quality bar.

### Publishing

Current publish flows target:

- npmjs as `@tummycrypt/scheduling-kit`
- GitHub Packages as `@jesssullivan/scheduling-kit`

That GitHub Packages rename is operationally real. Do not break it accidentally when editing the publish flow.

## Effect / Architecture Notes

Use Effect where it improves:

- typed workflow composition
- resource lifecycle
- error semantics
- adapter boundary clarity

Do not overcomplicate simple library code with gratuitous Effect wrapping.

The package’s real value is in clear contracts and composable flows, not ideological FP maximalism.

## Adapter Boundary Rules

These boundaries matter:

- Acuity REST and iframe handoff helpers may live here.
- Browser automation and DOM scraping do **not** belong here.
- App-specific admin UI does **not** belong here.
- Payment adapters should stay business-agnostic and site-agnostic.

If a feature requires Playwright, remote HTTP bridge calls, Modal deployment details, or selector maintenance, it almost certainly belongs in `acuity-middleware`, not here.

## Testing Strategy

Important commands:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:component
pnpm test:e2e
pnpm test:live
pnpm build
pnpm check
pnpm exec publint
```

Testing layers:

- unit tests for pure logic
- integration tests for adapter behavior
- component tests for Svelte UI
- live tests only when credentials and provider state are intentionally available

Do not turn live-provider tests into the default CI path.

## Code Patterns

- Keep adapters small and explicit.
- Preserve backend-agnostic abstractions.
- Avoid hard-coding MassageIthaca-specific behavior.
- Keep payment adapter semantics clear about who receives funds and who owns platform state.
- Prefer deterministic tests with fixtures/cassettes over flaky live reads.

## Important Files

- `package.json`
- `MODULE.bazel`
- `BUILD.bazel`
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`
- `src/core/**`
- `src/adapters/**`
- `src/payments/**`
- `src/components/**`
- `src/testing/**`

## Guardrails

- Do not move browser automation into this repo.
- Do not let Bazel metadata drift from npm metadata.
- Do not leak site-specific environment logic into library contracts.
- Do not assume MassageIthaca is the only downstream consumer.
