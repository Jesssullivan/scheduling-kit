# @tummycrypt/scheduling-kit

Backend-agnostic scheduling library with Svelte 5 components, pluggable
scheduling adapters, alternative payment support, and Effect-powered workflow
composition.

This repo keeps two intentionally different build surfaces:

- `pnpm` is the local package-manager and script interface
- Bazel defines and builds the publishable package artifact used by CI

The recommended local bootstrap path is the repo flake plus `direnv`, which
makes `pnpm`, `bazel` through Bazelisk, and the docs toolchain available from a
clean shell.

## Features

- **Multiple scheduling backends** -- Acuity REST API, Cal.com, or
  bring-your-own PostgreSQL (HomegrownAdapter)
- **Svelte 5 components** -- ServicePicker, DateTimePicker, ClientForm,
  CheckoutDrawer, and more
- **Payment adapters** -- Stripe, Venmo/PayPal SDK, cash, Zelle, check
- **Availability engine** -- Pure-function slot generation, DST-safe via `Intl.DateTimeFormat`
- **Reconciliation** -- Alt-payment matching and webhook handling
- **Test infrastructure** -- Cassette-based API recording/playback, MSW
  mocking, property-based tests
- **Functional core** -- Effect-powered scheduling flows and typed error handling

## Installation

```bash
pnpm add @tummycrypt/scheduling-kit
```

## Development Environment

```bash
direnv allow
pnpm install
```

If `bazel` is missing in your current shell, enter the flake environment with
`nix develop` or let `direnv` load `.envrc`. The dev shell provides a `bazel`
wrapper backed by Bazelisk and pinned by `.bazelversion`.

Peer dependencies (install those you need):

```bash
# Required
pnpm add svelte

# Optional -- for UI components
pnpm add @skeletonlabs/skeleton @skeletonlabs/skeleton-svelte

# Optional -- for E2E tests
pnpm add -D playwright-core
```

## Release Hygiene

```bash
pnpm check:release-metadata
pnpm check:package
bazel build //:pkg
npm pack --dry-run ./bazel-bin/pkg
```

Those checks keep `package.json`, `MODULE.bazel`, and `BUILD.bazel` aligned,
then validate the Bazel-built package artifact before anything gets near a
registry.

## Documentation

```bash
pnpm docs:generate      # Regenerate derived Markdown and llms surfaces
pnpm docs:check         # Validate generated docs and MkDocs config
pnpm docs:serve         # Local docs preview at http://127.0.0.1:8000
nix build .#docs        # Build the static docs site as a derivation
nix flake check         # Evaluate flake outputs and run lightweight checks
```

## Release Authority

Current reality:

- the functional release line is `Jesssullivan/scheduling-kit`
- `tinyland-inc/scheduling-kit` is now a downstream mirror and validation
  surface, not a second publish authority

Treat `Jesssullivan/main` as the release authority for package publication and
metadata changes. Do not assume both `main` branches are equivalent.

Longer term, the intended publish shape is:

1. release metadata declared once
2. Bazel defines and builds the publishable artifact
3. GitHub Actions publishes that artifact to npm
4. downstream apps consume the published package only

## Runner Authority

Package CI and publish currently use the shared `js-bazel-package` workflow with
`runner_mode: shared` and labels from `PRIMARY_LINUX_RUNNER_LABELS_JSON`.

Treat that runner contract as pending proof until the repo Actions runner API
and green workflow runs confirm the lane. Keep private runner topology and
apply details out of this public repo.

## Quick Start

```typescript
import { Effect } from 'effect';
import {
  createSchedulingKit,
  createHomegrownAdapter,
  createStripeAdapter,
  createVenmoAdapter,
} from '@tummycrypt/scheduling-kit';

// Create a scheduling adapter
const scheduler = createHomegrownAdapter({
  db: drizzleInstance,
  timezone: 'America/New_York',
});

// Create payment adapters
const stripe = createStripeAdapter({
  type: 'stripe',
  secretKey: process.env.STRIPE_SECRET_KEY!,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
});

const venmo = createVenmoAdapter({
  type: 'venmo',
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  environment: 'sandbox',
});

// Compose into a scheduling kit
const kit = createSchedulingKit(scheduler, [stripe, venmo]);

// Complete a booking
const result = await Effect.runPromise(
  kit.completeBooking(request, 'stripe')
);
```

## Ownership Boundary

This package owns reusable scheduling contracts, payment adapters, checkout UI,
and Acuity REST plus iframe handoff primitives.

It does **not** own:

- browser automation
- remote Acuity scraping
- Modal deployment/runtime control
- site-specific booking orchestration

If your Acuity flow needs browser automation or remote bridge-backed booking
semantics, that ownership belongs to `@tummycrypt/scheduling-bridge` plus the
adopter app that wires the handoff.

## Adapters

### HomegrownAdapter

Direct PostgreSQL adapter using Drizzle ORM. Replaces third-party scheduling
APIs entirely.

```typescript
import { createHomegrownAdapter } from '@tummycrypt/scheduling-kit/adapters';

const adapter = createHomegrownAdapter({
  db: drizzleInstance,
  timezone: 'America/New_York',
});

// 16 methods: getServices, getAvailability, getSlots, book, cancel,
// reschedule, ...
```

### AcuityAdapter

API-based adapter for Acuity Scheduling (requires Powerhouse plan).
For browser automation and no-API migration flows, use
`@tummycrypt/scheduling-bridge`.

```typescript
import { createAcuityAdapter } from '@tummycrypt/scheduling-kit/adapters';

const config = {
  type: 'acuity' as const,
  userId: process.env.ACUITY_USER_ID!,
  apiKey: process.env['ACUITY_API_KEY']!,  // from Acuity Integrations page
};
const adapter = createAcuityAdapter(config);
```

### CalComAdapter

Stub adapter for future Cal.com integration.

```typescript
import { createCalComAdapter } from '@tummycrypt/scheduling-kit/adapters';

const adapter = createCalComAdapter({
  type: 'calcom',
  apiKey: process.env['CALCOM_API_KEY']!,
  baseUrl: 'https://api.cal.com/v1',
});
```

## Availability Engine

Pure functions for slot generation. DST-safe, timezone-aware, fully tested.

```typescript
import {
  getAvailableSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  getEffectiveHours,
} from '@tummycrypt/scheduling-kit/adapters';

const slots = getAvailableSlots({
  date: '2026-03-22',
  timezone: 'America/New_York',
  hours: [{ dayOfWeek: 6, startTime: '11:00', endTime: '16:00' }],
  overrides: [],
  occupied: [],
  slotDuration: 60,
  bufferMinutes: 15,
});
```

## Components

Svelte 5 components using runes syntax. Optional Skeleton 4 integration for styling.

| Component | Description |
| ----------- | ----------- |
| `ServicePicker` | Service/appointment type selector |
| `DateTimePicker` | Calendar date + time slot picker |
| `ClientForm` | Client info form with Zod validation |
| `PaymentSelector` | Payment method chooser |
| `ProviderPicker` | Practitioner/provider selector |
| `BookingConfirmation` | Post-booking confirmation display |
| `CheckoutDrawer` | Full checkout flow in a slide-out drawer |
| `HybridCheckoutDrawer` | Checkout UI for adopter-provided Acuity handoff |
| `VenmoButton` | Venmo/PayPal payment button |
| `VenmoCheckout` | Full Venmo checkout flow |
| `StripeCheckout` | Stripe Elements checkout |
| `AcuityEmbedHandoff` | Prefilled Acuity iframe handoff with postMessage |

```svelte
<script lang="ts">
  import {
    ServicePicker,
    DateTimePicker,
    ClientForm,
  } from '@tummycrypt/scheduling-kit/components';
</script>

<ServicePicker services={data.services} onselect={handleSelect} />
<DateTimePicker slots={availableSlots} onselect={handleTimeSelect} />
<ClientForm onsubmit={handleSubmit} />
```

## Payment Adapters

```typescript
import {
  createStripeAdapter,
  createVenmoAdapter,
  createCashAdapter,
  createZelleAdapter,
  createCheckAdapter,
  createVenmoDirectAdapter,
} from '@tummycrypt/scheduling-kit/payments';
```

| Adapter | Type | Description |
| --------- | ------ | ------------- |
| `createStripeAdapter` | `stripe` | Stripe Connect with Payment Intents |
| `createVenmoAdapter` | `venmo` | PayPal SDK with Venmo button |
| `createCashAdapter` | `cash` | Cash/in-person manual payment |
| `createZelleAdapter` | `zelle` | Zelle manual payment |
| `createCheckAdapter` | `check` | Check manual payment |
| `createVenmoDirectAdapter` | `venmo-direct` | Venmo deep link (no SDK) |

## Reconciliation

Match alt-payment transactions (Venmo, Zelle, cash) to bookings.

```typescript
import {
  createReconciliationMatcher,
} from '@tummycrypt/scheduling-kit/reconciliation';
```

## Stores

Svelte 5 runes-based checkout state management.

```typescript
import { checkoutStore } from '@tummycrypt/scheduling-kit/stores';
```

## Testing

### Unit Tests

```bash
pnpm test:unit           # Run all unit tests
pnpm test:coverage       # With coverage report
```

### Integration Tests

```bash
pnpm test:integration    # Mocked backend integration tests
```

### Component Tests

```bash
pnpm test:component      # jsdom-based component tests
```

### E2E Tests

```bash
pnpm test:e2e            # Playwright browser tests (starts dev server)
```

### Live Tests

```bash
# Copy .env.test.local.example to .env.test.local and fill in credentials
RUN_LIVE_TESTS=true pnpm test:live
```

### Test Utilities

The `@tummycrypt/scheduling-kit/testing` export provides cassette-based API
recording and playback for deterministic integration tests.

```typescript
import { CassetteRecorder, CassettePlayer } from '@tummycrypt/scheduling-kit/testing';
```

## Development

```bash
pnpm install
pnpm dev              # Start dev server
pnpm build            # Build package
pnpm check            # TypeScript check
pnpm lint             # ESLint
pnpm test:all         # Run all test suites
```

## License

MIT -- see [LICENSE](./LICENSE) for details.
