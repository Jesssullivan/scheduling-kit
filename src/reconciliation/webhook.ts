/**
 * Acuity Webhook Verification
 * Verify and parse Acuity webhook payloads
 */

import { Effect, pipe } from 'effect';
import type { SchedulingResult } from '../core/types.js';
import { Errors } from '../core/types.js';
import type { AcuityWebhookPayload, AcuityAppointment, AcuityWebhookEventType } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WebhookConfig {
  /** Acuity API user ID */
  userId: string;
  /** Acuity API key */
  apiKey: string;
}

export interface WebhookVerificationResult {
  /** Whether the webhook is valid */
  valid: boolean;
  /** Parsed webhook payload */
  payload?: AcuityWebhookPayload;
  /** Full appointment details (fetched from API) */
  appointment?: AcuityAppointment;
  /** Error message if invalid */
  error?: string;
}

// =============================================================================
// WEBHOOK VERIFICATION
// =============================================================================

/**
 * Verify Acuity webhook signature
 *
 * Acuity uses HMAC-SHA256 for webhook signatures
 * Header: x-acuity-signature
 */
export const verifyAcuityWebhook = async (
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> => {
  // Note: Acuity webhook verification uses the API key as the secret
  // The signature is base64-encoded HMAC-SHA256 of the payload

  // In Node.js environment
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const data = encoder.encode(payload);

    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await globalThis.crypto.subtle.sign('HMAC', key, data);
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    return signature === computedSignature;
  }

  // Fallback: Return true for development (should use crypto in production)
  console.warn('[Webhook] Crypto API not available, skipping signature verification');
  return true;
};

/**
 * Parse Acuity webhook payload
 */
export const parseAcuityWebhook = (
  body: string | Record<string, unknown>
): E.Either<Error, AcuityWebhookPayload> => {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;

    if (!data.action || !data.id || !data.calendarID || !data.appointmentTypeID) {
      return E.left(new Error('Invalid webhook payload: missing required fields'));
    }

    const validActions: AcuityWebhookEventType[] = [
      'appointment.scheduled',
      'appointment.rescheduled',
      'appointment.canceled',
      'appointment.changed',
      'order.completed',
    ];

    if (!validActions.includes(data.action)) {
      return E.left(new Error(`Invalid webhook action: ${data.action}`));
    }

    return E.right({
      action: data.action,
      id: Number(data.id),
      calendarID: Number(data.calendarID),
      appointmentTypeID: Number(data.appointmentTypeID),
    });
  } catch (e) {
    return E.left(e instanceof Error ? e : new Error(String(e)));
  }
};

// =============================================================================
// APPOINTMENT FETCHING
// =============================================================================

/**
 * Fetch full appointment details from Acuity API
 */
export const fetchAcuityAppointment = (
  config: WebhookConfig,
  appointmentId: number
): SchedulingResult<AcuityAppointment> =>
  Effect.tryPromise({
    try: async () => {
      const auth = Buffer.from(`${config.userId}:${config.apiKey}`).toString('base64');
      const response = await fetch(
        `https://acuityscheduling.com/api/v1/appointments/${appointmentId}`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Acuity API error: ${response.status}`);
      }

      return response.json() as Promise<AcuityAppointment>;
    },
    catch: (e) => Errors.acuity('FETCH_FAILED', String(e), 500, `/appointments/${appointmentId}`),
  });

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

export interface WebhookHandlerOptions {
  /** Webhook configuration */
  config: WebhookConfig;
  /** Callback for new appointments */
  onAppointmentCreated?: (appointment: AcuityAppointment) => Promise<void>;
  /** Callback for rescheduled appointments */
  onAppointmentRescheduled?: (appointment: AcuityAppointment) => Promise<void>;
  /** Callback for cancelled appointments */
  onAppointmentCancelled?: (appointmentId: number) => Promise<void>;
  /** Callback for appointment changes */
  onAppointmentChanged?: (appointment: AcuityAppointment) => Promise<void>;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Create a webhook handler function for use in your API route
 *
 * @example
 * ```typescript
 * // In your SvelteKit route: src/routes/api/webhooks/acuity/+server.ts
 * import { createWebhookHandler } from '@tummycrypt/scheduling-kit/reconciliation';
 *
 * const handler = createWebhookHandler({
 *   config: {
 *     userId: process.env.ACUITY_USER_ID!,
 *     apiKey: process.env.ACUITY_API_KEY!,
 *   },
 *   onAppointmentCreated: async (appointment) => {
 *     await reconciliationService.tryMatch(appointment);
 *   },
 * });
 *
 * export const POST = async ({ request }) => {
 *   const body = await request.text();
 *   const signature = request.headers.get('x-acuity-signature') ?? '';
 *
 *   const result = await handler(body, signature);
 *
 *   return new Response(JSON.stringify(result), {
 *     status: result.valid ? 200 : 400,
 *   });
 * };
 * ```
 */
export const createWebhookHandler = (options: WebhookHandlerOptions) => {
  const { config, debug = false } = options;

  const log = (...args: unknown[]) => {
    if (debug) console.log('[AcuityWebhook]', ...args);
  };

  return async (
    body: string,
    signature: string
  ): Promise<WebhookVerificationResult> => {
    // Verify signature
    const valid = await verifyAcuityWebhook(body, signature, config.apiKey);
    if (!valid) {
      log('Invalid webhook signature');
      return { valid: false, error: 'Invalid signature' };
    }

    // Parse payload
    const parseResult = parseAcuityWebhook(body);
    if (E.isLeft(parseResult)) {
      log('Failed to parse webhook:', parseResult.left.message);
      return { valid: false, error: parseResult.left.message };
    }

    const payload = parseResult.right;
    log('Received webhook:', payload.action, 'for appointment', payload.id);

    // Handle cancellation (no need to fetch full appointment)
    if (payload.action === 'appointment.canceled') {
      await options.onAppointmentCancelled?.(payload.id);
      return { valid: true, payload };
    }

    // Fetch full appointment details for other events
    const fetchResult = await fetchAcuityAppointment(config, payload.id)();
    if (E.isLeft(fetchResult)) {
      const errorMsg = 'message' in fetchResult.left ? fetchResult.left.message : fetchResult.left._tag;
      log('Failed to fetch appointment:', errorMsg);
      return { valid: true, payload, error: 'Failed to fetch appointment details' };
    }

    const appointment = fetchResult.right;

    // Dispatch to appropriate handler
    switch (payload.action) {
      case 'appointment.scheduled':
        await options.onAppointmentCreated?.(appointment);
        break;
      case 'appointment.rescheduled':
        await options.onAppointmentRescheduled?.(appointment);
        break;
      case 'appointment.changed':
      case 'order.completed':
        await options.onAppointmentChanged?.(appointment);
        break;
    }

    return { valid: true, payload, appointment };
  };
};
