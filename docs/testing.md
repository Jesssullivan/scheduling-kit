# Testing Guide

This repo uses Vitest for unit, integration, component-like, and live tests,
and Playwright for browser E2E coverage. The package is Effect-based, so the
test helpers and examples in this tree assert on `Effect` success and failure
rather than fp-ts `Either` values.

## Test commands

| Lane | Command | Primary paths | Notes |
| --- | --- | --- | --- |
| Unit | `pnpm test:unit` | `src/tests/**`, `src/adapters/__tests__/**`, `src/onboarding/__tests__/**` | Fast default lane |
| Integration | `pnpm test:integration` | `tests/integration/**` | Sequential file execution to avoid shared-state races |
| Component | `pnpm test:component` | `tests/e2e/*.test.ts` | jsdom-driven UI tests that share the browser-facing fixture folder |
| Playwright E2E | `pnpm test:e2e` | `tests/e2e/**` | Real browser run across Chromium, Firefox, WebKit, and mobile presets |
| Live | `pnpm test:live` | `tests/live/**` | Explicit opt-in only |

## Current layout

```text
src/tests/
  helpers/        Effect assertions and factory utilities
  fixtures/       Deterministic test data and raw provider payloads
  mocks/          MSW server and handler set
  unit/           Focused unit coverage
  components/     Pure component state coverage
tests/
  integration/    Adapter-level integration flows
  e2e/            Shared browser-facing tests used by Vitest and Playwright
  live/           Real-provider smoke coverage
cassettes/        Recorded provider interactions
```

## Effect-first helper patterns

Use the helpers in `src/tests/helpers/effect.ts` when asserting on package
behavior:

```ts
import { expectSuccess, expectFailureTag } from '../helpers/effect.js';

it('returns a typed validation error', async () => {
  const error = await expectFailureTag(
    completeBookingWithAltPayment(ctx, invalidInput),
    'ValidationError',
  );

  expect(error._tag).toBe('ValidationError');
});
```

Those helpers execute the `Effect`, assert on the `Exit`, and preserve the
typed `SchedulingError` contract exposed by the public API.

## Fixtures, mocks, and recordings

- Use `src/tests/fixtures/**` for deterministic data and raw provider payloads
- Use `src/tests/mocks/**` for MSW-backed HTTP mocks
- Use `src/testing/**` plus `cassettes/**` for record/replay workflows and API diffing

## Live tests

Live tests are intentionally gated and should never become the default CI path.

```bash
cp .env.test.local.example .env.test.local
RUN_LIVE_TESTS=true pnpm test:live
```

Keep those runs read-only unless a specific operator lane is being defined and
reviewed.

## Validation expectations

- `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:component` are normal local validation lanes
- `pnpm test:e2e` is appropriate when changing interactive browser behavior
- `pnpm test:live` is for intentional provider-state checks only
