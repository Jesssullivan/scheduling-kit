/**
 * Adapters module exports
 */

// Types
export * from './types.js';

// Acuity Adapter (API-based, requires Powerhouse plan).
// Browser automation lives in @tummycrypt/scheduling-bridge.
export { createAcuityAdapter } from './acuity.js';

// Cal.com Adapter (stub for future migration)
export { createCalComAdapter } from './calcom.js';

// Homegrown Adapter (direct PG, replaces Acuity)
export {
  createHomegrownAdapter,
  type HomegrownAdapterConfig,
  type HomegrownAdapterSchemas,
  type HomegrownAdapterSchemaProvider,
  type HomegrownBookingSchemaTables,
  type HomegrownContentSchemaTables,
} from './homegrown.js';

// Recurrence Pre-Pass (TIN-1996 slice 1).
// RRULE parsing uses the optional peer @tummycrypt/tinyland-calendar,
// loaded lazily inside expandRecurrence — safe to re-export statically.
export {
  expandRecurrence,
  RecurrencePeerUnavailableError,
  UnsupportedRecurrenceError,
  type RecurringHoursRule,
  type RecurringBlock,
  type RecurrenceExpansionInput,
  type RecurrenceExpansionRange,
  type RecurrenceExpansion,
} from './recurrence.js';

// CalDAV busy overlay (TIN-1996 slice 2).
// Event conversion is peer-free; only loadCalDavClient touches the optional
// peer @tummycrypt/tinyland-caldav-client (lazily) — safe to re-export.
export {
  busyBlocksFromEvents,
  fetchCalDavBusy,
  loadCalDavClient,
  CalDavPeerUnavailableError,
  type CalDavBusyEvent,
  type CalDavBusyQuery,
  type CalDavBusySource,
} from './caldav-busy.js';

// Availability substrate (TIN-1996 slice 2): RRULE windows minus busy.
// Snapshot freshness attribution (TIN-945 row 3): observedAt/staleAt/expiresAt
// + cold-read cost, wrapping the substrate read for cache-reuse decisions.
export {
  getSubstrateAvailability,
  getAvailabilitySnapshot,
  isSnapshotStale,
  isSnapshotExpired,
  isSnapshotReusable,
  type AvailabilitySubstrate,
  type SubstrateDayAvailability,
  type AvailabilitySnapshot,
  type AvailabilityFreshness,
  type SnapshotFreshnessPolicy,
} from './availability-substrate.js';

// Availability Engine (pure functions)
export {
  getAvailableSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  generateConfirmationCode,
  DEFAULT_CONFIRMATION_CODE_PREFIX,
  getEffectiveHours,
  hasOverlap,
  parseTimeInTz,
  type HoursWindow,
  type HoursOverride,
  type OccupiedBlock,
  type SlotConfig,
  type GeneratedSlot,
} from './availability-engine.js';
