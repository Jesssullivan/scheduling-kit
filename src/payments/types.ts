/**
 * Payment Adapter Interface
 * Backend-agnostic contract for payment processors (Venmo, Stripe, etc.)
 */

import { Effect } from 'effect';
import type {
  SchedulingResult,
  PaymentIntent,
  PaymentResult,
  RefundResult,
} from '../core/types.js';

// =============================================================================
// PAYMENT ADAPTER INTERFACE
// =============================================================================

export interface PaymentAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly icon?: string;

  /**
   * Check if this payment method is available/enabled
   */
  isAvailable(): SchedulingResult<boolean>;

  /**
   * Initialize a payment intent
   */
  createIntent(params: {
    amount: number; // cents
    currency: string;
    description: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): SchedulingResult<PaymentIntent>;

  /**
   * Capture/complete a payment
   * For two-step payments (authorize then capture)
   */
  capturePayment(intentId: string): SchedulingResult<PaymentResult>;

  /**
   * Cancel a payment intent before completion
   */
  cancelIntent(intentId: string): SchedulingResult<void>;

  /**
   * Process a refund
   */
  refund(params: {
    transactionId: string;
    amount?: number; // partial refund amount in cents, or full if omitted
    reason?: string;
  }): SchedulingResult<RefundResult>;

  /**
   * Verify a webhook signature
   */
  verifyWebhook(params: {
    payload: string;
    signature: string;
    secret: string;
    /** PayPal transmission ID header */
    transmissionId?: string;
    /** PayPal transmission time header */
    transmissionTime?: string;
    /** PayPal certificate URL header */
    certUrl?: string;
  }): SchedulingResult<boolean>;

  /**
   * Parse a webhook payload into a standardized event
   */
  parseWebhook(payload: string): SchedulingResult<PaymentWebhookEvent>;

  /**
   * Get client-side configuration (safe to expose)
   */
  getClientConfig(): PaymentClientConfig;
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export type PaymentWebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'refund.completed'
  | 'refund.failed';

export interface PaymentWebhookEvent {
  readonly type: PaymentWebhookEventType;
  readonly transactionId: string;
  readonly intentId?: string;
  readonly amount: number;
  readonly currency: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
  readonly raw: unknown;
}

// =============================================================================
// CLIENT CONFIG
// =============================================================================

export interface PaymentClientConfig {
  readonly name: string;
  readonly displayName: string;
  readonly icon?: string;
  readonly clientId?: string;
  readonly environment: 'sandbox' | 'production';
  readonly supportedCurrencies: string[];
  readonly minAmount?: number;
  readonly maxAmount?: number;
}

// =============================================================================
// ADAPTER CONFIGURATIONS
// =============================================================================

export interface VenmoAdapterConfig {
  readonly type: 'venmo';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment: 'sandbox' | 'production';
  readonly businessProfileId?: string;
  readonly webhookId?: string;
  readonly brandName?: string;
  /** PayPal email of the payee (practitioner). Routes payments to their account. */
  readonly payeeEmail?: string;
}

export interface StripeAdapterConfig {
  readonly type: 'stripe';
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly webhookSecret: string;
  /** Stripe Connect: route payments to this connected account via direct charges */
  readonly connectedAccountId?: string;
}

export interface ManualPaymentConfig {
  readonly type: 'manual';
  readonly methods: ('cash' | 'check' | 'zelle' | 'venmo-direct' | 'other')[];
  readonly instructions?: Record<string, string>;
}

export type PaymentAdapterConfig =
  | VenmoAdapterConfig
  | StripeAdapterConfig
  | ManualPaymentConfig;

// =============================================================================
// PAYMENT METHOD SELECTION
// =============================================================================

export interface PaymentMethodOption {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly icon?: string;
  readonly description?: string;
  readonly available: boolean;
  readonly processingFee?: number; // cents
  readonly processingFeePercent?: number;
}

// =============================================================================
// PAYMENT REGISTRY
// =============================================================================

export interface PaymentRegistry {
  /**
   * Register a payment adapter
   */
  register(adapter: PaymentAdapter): void;

  /**
   * Get an adapter by name
   */
  get(name: string): PaymentAdapter | undefined;

  /**
   * Get all registered adapters
   */
  getAll(): PaymentAdapter[];

  /**
   * Get available payment methods for display
   */
  getAvailableMethods(): Promise<PaymentMethodOption[]>;
}

export const createPaymentRegistry = (): PaymentRegistry => {
  const adapters = new Map<string, PaymentAdapter>();

  return {
    register: (adapter) => {
      adapters.set(adapter.name, adapter);
    },

    get: (name) => adapters.get(name),

    getAll: () => Array.from(adapters.values()),

    getAvailableMethods: async () => {
      const methods: PaymentMethodOption[] = [];

      for (const adapter of adapters.values()) {
        try {
          const available = await Effect.runPromise(adapter.isAvailable());
          if (available) {
            const config = adapter.getClientConfig();
            methods.push({
              id: adapter.name,
              name: adapter.name,
              displayName: config.displayName,
              icon: config.icon,
              available: true,
            });
          }
        } catch {
          // Adapter unavailable — skip
        }
      }

      return methods;
    },
  };
};
