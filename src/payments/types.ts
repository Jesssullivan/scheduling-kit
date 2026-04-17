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
  /** Return URL after PayPal approval (required for proper popup flow). */
  readonly returnUrl?: string;
  /** Cancel URL when buyer cancels (required for proper popup flow). */
  readonly cancelUrl?: string;
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

// =============================================================================
// PAYMENT CAPABILITIES CONTRACT
// =============================================================================

/** Stripe payment capability for a practitioner */
export interface StripeCapability {
  readonly available: boolean;
  readonly publishableKey: string;
  readonly connectedAccountId?: string;
}

/** Venmo/PayPal payment capability for a practitioner */
export interface VenmoCapability {
  readonly available: boolean;
  readonly clientId: string;
  readonly environment: 'sandbox' | 'production';
}

/**
 * Server-derived payment capabilities for a practitioner.
 *
 * This is the single source of truth for what payment methods
 * are available on any booking surface. Both the drawer and
 * the full-page booking flow must use this contract.
 *
 * `cash: false` is a type-level guarantee — Cash at Visit
 * is structurally impossible without changing this type.
 */
export interface PaymentCapabilities {
  readonly methods: PaymentMethodOption[];
  readonly stripe: StripeCapability | null;
  readonly venmo: VenmoCapability | null;
  readonly cash: false;
}

/** Returns safe default capabilities (nothing available, loading state) */
export const getDefaultCapabilities = (): PaymentCapabilities => ({
  methods: [],
  stripe: null,
  venmo: null,
  cash: false,
});

export const toPublicPaymentMethodId = (paymentMethod: string): string =>
  paymentMethod === 'stripe' ? 'card' : paymentMethod;

export const toInternalPaymentMethodId = (paymentMethod: string): string =>
  paymentMethod === 'card' ? 'stripe' : paymentMethod;

export const toPublicPaymentMethodOption = (adapter: PaymentAdapter): PaymentMethodOption => {
  const config = adapter.getClientConfig();
  const publicId = toPublicPaymentMethodId(adapter.name);

  return {
    id: publicId,
    name: publicId,
    displayName: config.displayName,
    icon: publicId === 'card' ? 'card' : config.icon,
    available: true,
  };
};

export const createPaymentRegistry = (): PaymentRegistry => {
  const adapters = new Map<string, PaymentAdapter>();

  return {
    register: (adapter) => {
      adapters.set(adapter.name, adapter);
    },

    get: (name) => adapters.get(name) ?? adapters.get(toInternalPaymentMethodId(name)),

    getAll: () => Array.from(adapters.values()),

    getAvailableMethods: async () => {
      const methods: PaymentMethodOption[] = [];

      for (const adapter of adapters.values()) {
        try {
          const available = await Effect.runPromise(adapter.isAvailable());
          if (available) {
            methods.push(toPublicPaymentMethodOption(adapter));
          }
        } catch {
          // Adapter unavailable — skip
        }
      }

      return methods;
    },
  };
};
