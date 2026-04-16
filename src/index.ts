/**
 * @tummycrypt/scheduling-kit
 *
 * Backend-agnostic scheduling components with alternative payment support.
 * Built with Svelte 5 and Effect for typed workflow composition.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import {
 *   createSchedulingKit,
 *   createHomegrownAdapter,
 *   createVenmoAdapter,
 * } from '@tummycrypt/scheduling-kit';
 *
 * // Create adapters
 * const scheduler = createHomegrownAdapter({
 *   db: drizzleInstance,
 *   timezone: 'America/New_York',
 * });
 *
 * const venmo = createVenmoAdapter({
 *   type: 'venmo',
 *   clientId: process.env.PAYPAL_CLIENT_ID,
 *   clientSecret: process.env.PAYPAL_CLIENT_SECRET,
 *   environment: 'sandbox',
 * });
 *
 * // Create scheduling kit
 * const kit = createSchedulingKit(scheduler, [venmo]);
 *
 * // Complete a booking
 * const result = await Effect.runPromise(
 *   kit.completeBooking(request, 'venmo')
 * );
 * ```
 */

// Core types and utilities
export * from './core/index.js';

// Scheduling adapters
export * from './adapters/index.js';

// Payment adapters
export * from './payments/index.js';

// Svelte components
export * from './components/index.js';

// Svelte stores
export * from './stores/index.js';

// Reconciliation (alt-payment matching)
export * from './reconciliation/index.js';
