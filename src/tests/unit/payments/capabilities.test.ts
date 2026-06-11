/**
 * Tests for payment capability extraction.
 *
 * Parity-ported from scheduling-bridge's capabilities tests: the bridge
 * delegates to this kit implementation, so these cases pin the canonical
 * semantics (settings > env > disabled, cash structurally false).
 */

import { describe, it, expect } from 'vitest';
import { extractCapabilities } from '../../../payments/capabilities.js';
import type { PaymentCapabilities } from '../../../payments/types.js';

describe('extractCapabilities', () => {
  it('should return empty capabilities when nothing is configured', () => {
    const caps: PaymentCapabilities = extractCapabilities({}, {});
    expect(caps.methods).toEqual([]);
    expect(caps.stripe).toBeNull();
    expect(caps.venmo).toBeNull();
    expect(caps.cash).toBe(false);
  });

  it('should detect Stripe from practitioner settings', () => {
    const settings = { stripe_publishable_key: 'pk_test_123' };
    const caps = extractCapabilities(settings, {});
    expect(caps.stripe).not.toBeNull();
    expect(caps.stripe!.available).toBe(true);
    expect(caps.stripe!.publishableKey).toBe('pk_test_123');
    expect(caps.methods).toContainEqual(expect.objectContaining({ id: 'card', available: true }));
  });

  it('should detect Stripe from env var fallback', () => {
    const env = { PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_env' };
    const caps = extractCapabilities({}, env);
    expect(caps.stripe!.publishableKey).toBe('pk_test_env');
  });

  it('should prefer practitioner settings over env vars for Stripe', () => {
    const settings = { stripe_publishable_key: 'pk_practitioner' };
    const env = { PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_platform' };
    const caps = extractCapabilities(settings, env);
    expect(caps.stripe!.publishableKey).toBe('pk_practitioner');
  });

  it('should detect Venmo when client ID and payee email both exist', () => {
    const settings = { paypal_payee_email: 'practitioner@example.com' };
    const env = { PUBLIC_PAYPAL_CLIENT_ID: 'paypal_123', PAYPAL_ENVIRONMENT: 'sandbox' };
    const caps = extractCapabilities(settings, env);
    expect(caps.venmo).not.toBeNull();
    expect(caps.venmo!.available).toBe(true);
    expect(caps.venmo!.clientId).toBe('paypal_123');
    expect(caps.venmo!.environment).toBe('sandbox');
    expect(caps.methods).toContainEqual(expect.objectContaining({ id: 'venmo', available: true }));
  });

  it('should NOT enable Venmo when payee email is missing', () => {
    const env = { PUBLIC_PAYPAL_CLIENT_ID: 'paypal_123' };
    const caps = extractCapabilities({}, env);
    expect(caps.venmo).toBeNull();
    expect(caps.methods).not.toContainEqual(expect.objectContaining({ id: 'venmo' }));
  });

  it('should NOT enable Venmo when client ID is missing', () => {
    const settings = { paypal_payee_email: 'practitioner@example.com' };
    const caps = extractCapabilities(settings, {});
    expect(caps.venmo).toBeNull();
    expect(caps.methods).not.toContainEqual(expect.objectContaining({ id: 'venmo' }));
  });

  it('should enable Venmo when both practitioner and platform payee emails are present', () => {
    const settings = { paypal_payee_email: 'practitioner@example.com' };
    const env = {
      PUBLIC_PAYPAL_CLIENT_ID: 'paypal_123',
      PAYPAL_PAYEE_EMAIL: 'platform@example.com',
    };
    const caps = extractCapabilities(settings, env);
    expect(caps.venmo).not.toBeNull();
    // Payee email only gates enablement here; which value routes the payment
    // is decided outside this function, so settings-over-env precedence for
    // the payee is not observable (and not asserted) at this API boundary.
    expect(caps.venmo!.clientId).toBe('paypal_123');
  });

  it('should default PayPal environment to sandbox for unknown values', () => {
    const settings = { paypal_payee_email: 'practitioner@example.com' };
    const env = { PUBLIC_PAYPAL_CLIENT_ID: 'paypal_123', PAYPAL_ENVIRONMENT: 'staging' };
    const caps = extractCapabilities(settings, env);
    expect(caps.venmo!.environment).toBe('sandbox');
  });

  it('should return both Stripe and Venmo when both configured', () => {
    const settings = {
      stripe_publishable_key: 'pk_test_123',
      paypal_payee_email: 'practitioner@example.com',
    };
    const env = { PUBLIC_PAYPAL_CLIENT_ID: 'paypal_123', PAYPAL_ENVIRONMENT: 'production' };
    const caps = extractCapabilities(settings, env);
    expect(caps.stripe!.available).toBe(true);
    expect(caps.venmo!.available).toBe(true);
    expect(caps.venmo!.environment).toBe('production');
    expect(caps.methods).toHaveLength(2);
  });

  it('should never enable cash', () => {
    const settings = { allow_cash: 'true', cash_enabled: 'true' };
    const caps = extractCapabilities(settings, {});
    expect(caps.cash).toBe(false);
    expect(caps.methods).not.toContainEqual(expect.objectContaining({ id: 'cash' }));
  });

  it('should include connected account ID when available', () => {
    const settings = {
      stripe_publishable_key: 'pk_test_123',
      stripe_connect_account_id: 'acct_123',
    };
    const caps = extractCapabilities(settings, {});
    expect(caps.stripe!.connectedAccountId).toBe('acct_123');
  });

  it('should omit connected account ID when not configured', () => {
    const settings = { stripe_publishable_key: 'pk_test_123' };
    const caps = extractCapabilities(settings, {});
    expect(caps.stripe).not.toBeNull();
    expect('connectedAccountId' in caps.stripe!).toBe(false);
  });
});
