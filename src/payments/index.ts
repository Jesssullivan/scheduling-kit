/**
 * Payments module exports
 */

// Types
export * from './types.js';

// Payment capability extraction (canonical; scheduling-bridge delegates here)
export {
  extractCapabilities,
  type PractitionerPaymentSettings,
  type PlatformPaymentEnv,
} from './capabilities.js';

// Venmo Adapter
export { createVenmoAdapter } from './venmo.js';

// Stripe Adapter
export { createStripeAdapter } from './stripe.js';

// Manual Payment Adapters
export {
  createManualPaymentAdapter,
  createCashAdapter,
  createZelleAdapter,
  createCheckAdapter,
  createVenmoDirectAdapter,
} from './manual.js';
