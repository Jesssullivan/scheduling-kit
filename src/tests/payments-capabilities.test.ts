// tests for PaymentCapabilities type contract and getDefaultCapabilities factory
import { describe, it, expect } from 'vitest';

describe('PaymentCapabilities', () => {
  it('should export PaymentCapabilities type with required fields', async () => {
    const { getDefaultCapabilities } = await import('../payments/index.js');
    const caps = getDefaultCapabilities();
    expect(caps).toHaveProperty('methods');
    expect(caps).toHaveProperty('stripe');
    expect(caps).toHaveProperty('venmo');
    expect(caps).toHaveProperty('cash');
    expect(caps.cash).toBe(false);
  });

  it('should return empty methods from default capabilities', async () => {
    const { getDefaultCapabilities } = await import('../payments/index.js');
    const caps = getDefaultCapabilities();
    expect(caps.methods).toEqual([]);
    expect(caps.stripe).toBeNull();
    expect(caps.venmo).toBeNull();
  });

  it('should enforce cash is always false', async () => {
    const { getDefaultCapabilities } = await import('../payments/index.js');
    const caps = getDefaultCapabilities();
    const cashValue: false = caps.cash;
    expect(cashValue).toBe(false);
  });
});
