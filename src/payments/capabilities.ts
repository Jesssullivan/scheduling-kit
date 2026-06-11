/**
 * Payment capability extraction from practitioner settings and platform env vars.
 *
 * This is the canonical extraction logic used by downstream booking surfaces
 * to produce consistent payment method availability. `scheduling-bridge`
 * will delegate to this implementation once it adopts the next kit release
 * (Refs: scheduling-bridge#82); do not fork the semantics downstream.
 *
 * Inputs are intentionally generic: a flat string map of practitioner-level
 * settings (typically loaded from a database) and a flat string map of
 * platform-level environment variables. No host application or bridge types
 * are required.
 */
import type {
  PaymentCapabilities,
  PaymentMethodOption,
  StripeCapability,
  VenmoCapability,
} from './types.js';

/**
 * Practitioner-scoped settings, e.g. rows from a settings table keyed by
 * setting name. Recognized keys: `stripe_publishable_key`,
 * `stripe_connect_account_id`, `paypal_payee_email`.
 *
 * Empty-string values are treated as absent: a setting explicitly cleared to
 * `''` falls through to the platform env var (and then to disabled).
 */
export type PractitionerPaymentSettings = Record<string, string>;

/**
 * Platform-scoped environment variables. Recognized keys:
 * `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_ACCOUNT_ID`,
 * `PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_PAYEE_EMAIL`, `PAYPAL_ENVIRONMENT`.
 *
 * Empty-string values are treated as absent, the same as unset variables.
 */
export type PlatformPaymentEnv = Record<string, string>;

/**
 * Extract payment capabilities from practitioner settings and platform env vars.
 *
 * Priority hierarchy: practitioner settings (DB) > platform env vars > disabled.
 * Cash at Visit is structurally excluded (cash: false).
 *
 * @param settings - Practitioner-specific settings from database
 * @param env - Platform environment variables
 * @returns PaymentCapabilities contract for booking surfaces
 */
export const extractCapabilities = (
  settings: PractitionerPaymentSettings,
  env: PlatformPaymentEnv,
): PaymentCapabilities => {
  const methods: PaymentMethodOption[] = [];

  // --- Stripe ---
  const stripeKey = settings.stripe_publishable_key || env.PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  const stripeConnectId = settings.stripe_connect_account_id || env.STRIPE_CONNECT_ACCOUNT_ID || '';
  let stripe: StripeCapability | null = null;

  if (stripeKey) {
    stripe = {
      available: true,
      publishableKey: stripeKey,
      ...(stripeConnectId ? { connectedAccountId: stripeConnectId } : {}),
    };
    methods.push({
      id: 'card',
      name: 'card',
      displayName: 'Credit/Debit Card',
      icon: 'card',
      available: true,
    });
  }

  // --- Venmo/PayPal ---
  const paypalClientId = env.PUBLIC_PAYPAL_CLIENT_ID || '';
  const payeeEmail = settings.paypal_payee_email || env.PAYPAL_PAYEE_EMAIL || '';
  const paypalEnv: 'sandbox' | 'production' = env.PAYPAL_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  let venmo: VenmoCapability | null = null;

  if (paypalClientId && payeeEmail) {
    venmo = {
      available: true,
      clientId: paypalClientId,
      environment: paypalEnv,
    };
    methods.push({
      id: 'venmo',
      name: 'venmo',
      displayName: 'Venmo',
      icon: 'venmo',
      available: true,
    });
  }

  return { methods, stripe, venmo, cash: false };
};
