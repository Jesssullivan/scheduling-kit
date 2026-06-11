/**
 * Tests for public payment method id normalization
 *
 * Public booking surfaces use canonical public ids ('card', 'venmo').
 * The internal 'stripe' adapter name must never leak as a public id, and
 * unsupported selections must never be treated as manual methods.
 */

import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import {
  PUBLIC_CARD_PAYMENT_METHOD_ID,
  INTERNAL_STRIPE_PAYMENT_METHOD_ID,
  MANUAL_PAYMENT_METHOD_IDS,
  toPublicPaymentMethodId,
  toInternalPaymentMethodId,
  isCardPaymentMethodId,
  isManualPaymentMethodId,
  toPublicPaymentMethodOption,
  createPaymentRegistry,
  getDefaultCapabilities,
} from '../../../payments/types.js';
import type { PaymentAdapter } from '../../../payments/types.js';

// =============================================================================
// MOCK ADAPTER
// =============================================================================

const createMockAdapter = (
  name: string,
  overrides: { displayName?: string; icon?: string } = {}
): PaymentAdapter => ({
  name,
  displayName: overrides.displayName ?? name,
  icon: overrides.icon,
  isAvailable: vi.fn(() => Effect.succeed(true)),
  createIntent: vi.fn(() =>
    Effect.succeed({
      id: 'pi_test',
      amount: 1000,
      currency: 'USD',
      status: 'pending' as const,
      processor: name,
      createdAt: new Date().toISOString(),
    })
  ),
  capturePayment: vi.fn(() =>
    Effect.succeed({
      success: true,
      transactionId: 'txn_test',
      processor: name,
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    })
  ),
  cancelIntent: vi.fn(() => Effect.succeed(undefined)),
  refund: vi.fn(() =>
    Effect.succeed({
      success: true,
      refundId: 'refund_test',
      originalTransactionId: 'txn_test',
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    })
  ),
  verifyWebhook: vi.fn(() => Effect.succeed(true)),
  parseWebhook: vi.fn(() =>
    Effect.succeed({
      type: 'payment.completed' as const,
      transactionId: 'txn_test',
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
      raw: {},
    })
  ),
  getClientConfig: () => ({
    name,
    displayName: overrides.displayName ?? name,
    icon: overrides.icon,
    environment: 'production' as const,
    supportedCurrencies: ['USD'],
  }),
});

// =============================================================================
// ID NORMALIZATION
// =============================================================================

describe('payment method id normalization', () => {
  describe('toPublicPaymentMethodId', () => {
    it('maps the internal stripe name to the public card id', () => {
      expect(toPublicPaymentMethodId('stripe')).toBe('card');
      expect(toPublicPaymentMethodId(INTERNAL_STRIPE_PAYMENT_METHOD_ID)).toBe(
        PUBLIC_CARD_PAYMENT_METHOD_ID
      );
    });

    it('keeps already-public ids unchanged', () => {
      expect(toPublicPaymentMethodId('card')).toBe('card');
      expect(toPublicPaymentMethodId('venmo')).toBe('venmo');
      expect(toPublicPaymentMethodId('cash')).toBe('cash');
    });
  });

  describe('toInternalPaymentMethodId', () => {
    it('maps the public card id to the internal stripe name', () => {
      expect(toInternalPaymentMethodId('card')).toBe('stripe');
    });

    it('keeps other ids unchanged', () => {
      expect(toInternalPaymentMethodId('stripe')).toBe('stripe');
      expect(toInternalPaymentMethodId('venmo')).toBe('venmo');
      expect(toInternalPaymentMethodId('zelle')).toBe('zelle');
    });

    it('round-trips with toPublicPaymentMethodId', () => {
      expect(toInternalPaymentMethodId(toPublicPaymentMethodId('stripe'))).toBe('stripe');
      expect(toPublicPaymentMethodId(toInternalPaymentMethodId('card'))).toBe('card');
    });
  });

  describe('isCardPaymentMethodId', () => {
    it('accepts the public card id and the legacy stripe alias', () => {
      expect(isCardPaymentMethodId('card')).toBe(true);
      expect(isCardPaymentMethodId('stripe')).toBe(true);
    });

    it('rejects non-card ids', () => {
      expect(isCardPaymentMethodId('venmo')).toBe(false);
      expect(isCardPaymentMethodId('cash')).toBe(false);
      expect(isCardPaymentMethodId('bitcoin')).toBe(false);
    });
  });

  describe('isManualPaymentMethodId', () => {
    it('accepts exactly the manual method ids', () => {
      for (const id of MANUAL_PAYMENT_METHOD_IDS) {
        expect(isManualPaymentMethodId(id)).toBe(true);
      }
    });

    it('rejects card-like and venmo ids so they cannot reach manual completion', () => {
      expect(isManualPaymentMethodId('card')).toBe(false);
      expect(isManualPaymentMethodId('stripe')).toBe(false);
      expect(isManualPaymentMethodId('venmo')).toBe(false);
    });

    it('rejects unknown ids', () => {
      expect(isManualPaymentMethodId('bitcoin')).toBe(false);
      expect(isManualPaymentMethodId('')).toBe(false);
    });
  });
});

// =============================================================================
// PUBLIC METHOD OPTION
// =============================================================================

describe('toPublicPaymentMethodOption', () => {
  it('emits the public card id for stripe adapters', () => {
    const stripe = createMockAdapter('stripe', {
      displayName: 'Credit/Debit Card',
      icon: 'stripe',
    });

    const option = toPublicPaymentMethodOption(stripe);

    expect(option.id).toBe('card');
    expect(option.name).toBe('card');
    expect(option.displayName).toBe('Credit/Debit Card');
    expect(option.icon).toBe('card');
    expect(option.available).toBe(true);
  });

  it('keeps non-stripe adapters unchanged', () => {
    const venmo = createMockAdapter('venmo', { displayName: 'Venmo', icon: 'venmo' });

    const option = toPublicPaymentMethodOption(venmo);

    expect(option.id).toBe('venmo');
    expect(option.name).toBe('venmo');
    expect(option.icon).toBe('venmo');
  });

  it('omits the icon when the adapter config has none', () => {
    const cash = createMockAdapter('cash');
    expect(toPublicPaymentMethodOption(cash).icon).toBeUndefined();
  });
});

// =============================================================================
// REGISTRY RESOLUTION
// =============================================================================

describe('createPaymentRegistry public id resolution', () => {
  it('resolves the public card id to the stripe adapter', () => {
    const registry = createPaymentRegistry();
    const stripe = createMockAdapter('stripe');
    registry.register(stripe);

    expect(registry.get('card')).toBe(stripe);
    expect(registry.get('stripe')).toBe(stripe);
  });

  it('returns undefined for unsupported public selections', () => {
    const registry = createPaymentRegistry();
    registry.register(createMockAdapter('cash'));

    expect(registry.get('card')).toBeUndefined();
    expect(registry.get('venmo')).toBeUndefined();
  });

  it('emits public ids from getAvailableMethods', async () => {
    const registry = createPaymentRegistry();
    registry.register(createMockAdapter('stripe', { displayName: 'Credit/Debit Card' }));
    registry.register(createMockAdapter('venmo', { displayName: 'Venmo' }));

    const methods = await registry.getAvailableMethods();
    const ids = methods.map((m) => m.id);

    expect(ids).toEqual(['card', 'venmo']);
    expect(ids).not.toContain('stripe');
  });

  it('aligns emitted ids with the PaymentCapabilities contract (card/venmo, cash false)', async () => {
    const registry = createPaymentRegistry();
    registry.register(createMockAdapter('stripe'));
    registry.register(createMockAdapter('venmo'));

    const capabilities = {
      ...getDefaultCapabilities(),
      methods: await registry.getAvailableMethods(),
    };

    expect(capabilities.methods.map((m) => m.id)).toEqual(['card', 'venmo']);
    expect(capabilities.cash).toBe(false);
  });
});
