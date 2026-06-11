/**
 * Tests for the checkout store payment selector state
 *
 * Selector state must hold the canonical public payment method id:
 * the internal 'stripe' adapter name normalizes to the public 'card' id.
 */

import { describe, it, expect } from 'vitest';
import { createCheckoutStore } from '../../../stores/checkout.svelte.js';

describe('checkout store payment selector state', () => {
  it('normalizes the internal stripe name to the public card id', () => {
    const store = createCheckoutStore();

    store.selectPaymentMethod('stripe');

    expect(store.paymentMethod).toBe('card');
  });

  it('keeps the public card id as-is', () => {
    const store = createCheckoutStore();

    store.selectPaymentMethod('card');

    expect(store.paymentMethod).toBe('card');
  });

  it('keeps non-card public ids unchanged', () => {
    const store = createCheckoutStore();

    store.selectPaymentMethod('venmo');
    expect(store.paymentMethod).toBe('venmo');

    store.selectPaymentMethod('cash');
    expect(store.paymentMethod).toBe('cash');
  });

  it('advances to confirm after payment selection', () => {
    const store = createCheckoutStore();

    store.selectPaymentMethod('card');

    expect(store.step).toBe('confirm');
  });

  it('clears the normalized selection on reset', () => {
    const store = createCheckoutStore();

    store.selectPaymentMethod('stripe');
    store.reset();

    expect(store.paymentMethod).toBeUndefined();
    expect(store.step).toBe('service');
  });
});
