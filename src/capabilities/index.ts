/**
 * @tummycrypt/scheduling-kit/capabilities
 *
 * Generic scheduling runtime capability contract.
 *
 * A capability row answers, for one deployed scheduling surface: which backend
 * owns booking truth, how the public booking flow is served, which runtime
 * dependencies (remote bridge, postgres, schedule cache) are required /
 * optional / skipped, and whether local booking-provider automation is
 * allowed. Health endpoints and lane guards key off the resolved row instead
 * of raw env vars, so production surfaces cannot drift backends because a
 * shared env var changed.
 *
 * Ownership split:
 *
 * - the kit owns the contract shape and the resolution precedence
 *   (explicit site row > explicit lane row > dynamic synthesis)
 * - the adopting application owns the row tables — its site names, lane
 *   names, and dynamic-host policy
 *
 * For payment-method capabilities (`PaymentCapabilities` /
 * `extractCapabilities`), see `@tummycrypt/scheduling-kit/payments` instead.
 *
 * @example
 * ```typescript
 * import {
 *   resolveSchedulingCapabilities,
 *   type SchedulingCapabilityRowTable,
 * } from '@tummycrypt/scheduling-kit/capabilities';
 *
 * type Backend = 'homegrown' | 'acuity';
 *
 * const SITE_ROWS: SchedulingCapabilityRowTable<Backend> = {
 *   production: {
 *     environment: 'production',
 *     backend: 'acuity',
 *     publicBookingMode: 'acuity',
 *     remoteBridge: 'skipped',
 *     postgres: 'optional',
 *     cache: 'optional',
 *     localAutomation: 'forbidden',
 *     owner: 'acuity',
 *   },
 * };
 *
 * const capabilities = resolveSchedulingCapabilities(
 *   { site: 'production', lane: null, backend: 'acuity' },
 *   {
 *     siteRows: SITE_ROWS,
 *     synthesizeDynamic: ({ backend, environment }) => ({
 *       environment,
 *       backend,
 *       publicBookingMode: backend === 'homegrown' ? 'self-service' : 'acuity',
 *       remoteBridge: backend === 'homegrown' ? 'skipped' : 'optional',
 *       postgres: backend === 'homegrown' ? 'required' : 'optional',
 *       cache: 'optional',
 *       localAutomation: backend === 'homegrown' ? 'forbidden' : 'allowed',
 *       owner: backend === 'homegrown' ? 'homegrown' : 'scheduling-bridge',
 *     }),
 *   },
 * );
 * // capabilities.source === 'site'
 * ```
 */

// Types
export type {
  SchedulingCapabilitySource,
  RuntimeRequirement,
  LocalAutomationPolicy,
  SchedulingRuntimeCapabilities,
  SchedulingCapabilityRow,
  SchedulingCapabilityRowTable,
} from './types.js';

// Resolver
export type {
  DynamicCapabilityInput,
  SchedulingCapabilityTables,
  SchedulingCapabilityQuery,
} from './resolve.js';

export { resolveSchedulingCapabilities } from './resolve.js';
