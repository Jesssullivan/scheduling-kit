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
} from './homegrown.js';

// Availability Engine (pure functions)
export {
  getAvailableSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  generateConfirmationCode,
  getEffectiveHours,
  hasOverlap,
  parseTimeInTz,
  type HoursWindow,
  type HoursOverride,
  type OccupiedBlock,
  type SlotConfig,
  type GeneratedSlot,
} from './availability-engine.js';
