/**
 * Reconciliation module exports
 * Match alternative payment bookings with Acuity appointments
 */

// Types
export type {
  LocalBooking,
  ReconciliationStatus,
  AcuityWebhookEventType,
  AcuityWebhookPayload,
  AcuityAppointment,
  AcuityFormData,
  AcuityFormField,
  AcuityLabel,
  ReconciliationResult,
  ReconciliationDiscrepancy,
  MatchingCriteria,
} from './types.js';

export { DEFAULT_MATCHING_CRITERIA } from './types.js';

// Webhook handling
export type {
  WebhookConfig,
  WebhookVerificationResult,
  WebhookHandlerOptions,
} from './webhook.js';

export {
  verifyAcuityWebhook,
  parseAcuityWebhook,
  fetchAcuityAppointment,
  createWebhookHandler,
} from './webhook.js';

// Matching logic
export type { MatchScore } from './matcher.js';

export {
  calculateMatchScore,
  findDiscrepancies,
  tryMatch,
  findBestMatch,
  findAllPotentialMatches,
} from './matcher.js';
