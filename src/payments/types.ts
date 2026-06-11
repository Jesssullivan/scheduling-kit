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
  readonly instructions?: Record<string, string>;
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
  readonly methods: ManualPaymentMethodId[];
  readonly instructions?: Record<string, string>;
}

export type PaymentAdapterConfig =
  | VenmoAdapterConfig
  | StripeAdapterConfig
  | ManualPaymentConfig;

// =============================================================================
// PUBLIC PAYMENT METHOD ID NORMALIZATION
// =============================================================================
//
// Public booking surfaces use canonical public ids ('card', 'venmo', ...).
// 'stripe' is an internal adapter/processor name and must never leak as a
// public payment method id. This is the single owner of that normalization;
// consumers must not carry their own copies.

/** Canonical public id for card payments on booking surfaces. */
export const PUBLIC_CARD_PAYMENT_METHOD_ID = 'card';

/** Internal adapter name for the Stripe processor. Never a public id. */
export const INTERNAL_STRIPE_PAYMENT_METHOD_ID = 'stripe';

/** Manual payment methods that complete in-app without a processor SDK. */
export const MANUAL_PAYMENT_METHOD_IDS = [
  'cash',
  'check',
  'zelle',
  'venmo-direct',
  'other',
] as const;

export type ManualPaymentMethodId = (typeof MANUAL_PAYMENT_METHOD_IDS)[number];

/** Map an internal adapter name to the canonical public payment method id. */
export const toPublicPaymentMethodId = (paymentMethodId: string): string =>
  paymentMethodId === INTERNAL_STRIPE_PAYMENT_METHOD_ID
    ? PUBLIC_CARD_PAYMENT_METHOD_ID
    : paymentMethodId;

/** Map a public payment method id back to the internal adapter name. */
export const toInternalPaymentMethodId = (paymentMethodId: string): string =>
  paymentMethodId === PUBLIC_CARD_PAYMENT_METHOD_ID
    ? INTERNAL_STRIPE_PAYMENT_METHOD_ID
    : paymentMethodId;

/** True for the public card id and the legacy internal stripe alias. */
export const isCardPaymentMethodId = (paymentMethodId: string): boolean =>
  paymentMethodId === PUBLIC_CARD_PAYMENT_METHOD_ID ||
  paymentMethodId === INTERNAL_STRIPE_PAYMENT_METHOD_ID;

/** True only for explicit manual methods; unknown ids are NOT manual. */
export const isManualPaymentMethodId = (paymentMethodId: string): boolean =>
  (MANUAL_PAYMENT_METHOD_IDS as readonly string[]).includes(paymentMethodId);

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

/**
 * Build the public-facing method option for an adapter.
 *
 * Shared by the registry and checkout surfaces so the public id never
 * diverges from the internal adapter name in one place but not another.
 */
export const toPublicPaymentMethodOption = (adapter: PaymentAdapter): PaymentMethodOption => {
  const config = adapter.getClientConfig();
  const publicId = toPublicPaymentMethodId(adapter.name);

  return {
    id: publicId,
    name: publicId,
    displayName: config.displayName,
    icon: config.icon ? toPublicPaymentMethodId(config.icon) : undefined,
    available: true,
  };
};

export const createPaymentRegistry = (): PaymentRegistry => {
  const adapters = new Map<string, PaymentAdapter>();

  return {
    register: (adapter) => {
      adapters.set(adapter.name, adapter);
    },

    // Resolve public ids ('card') to internally named adapters ('stripe')
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
