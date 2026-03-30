/**
 * Tests for Stripe payment adapter
 * Validates Stripe API integration via raw fetch (no SDK)
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Effect } from 'effect';
import { createStripeAdapter } from '../../../payments/stripe.js';
import type { PaymentAdapter } from '../../../payments/types.js';
import { server } from '../../mocks/server.js';
import { resetStripeMockState, configureStripeMock } from '../../mocks/handlers/index.js';
import { expectSuccess, expectFailureTag } from '../../helpers/effect.js';

// MSW server lifecycle
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  resetStripeMockState();
});

afterAll(() => {
  server.close();
});

describe('Stripe Adapter', () => {
  let adapter: PaymentAdapter;

  beforeAll(() => {
    adapter = createStripeAdapter({
      type: 'stripe',
      secretKey: 'sk_test_mock12345',
      publishableKey: 'pk_test_mock12345',
      webhookSecret: 'whsec_mock12345',
    });
  });

  describe('isAvailable', () => {
    it('returns true when secret key is set', async () => {
      const result = await expectSuccess(adapter.isAvailable());
      expect(result).toBe(true);
    });

    it('returns false when secret key is empty', async () => {
      const emptyAdapter = createStripeAdapter({
        type: 'stripe',
        secretKey: '',
        publishableKey: '',
        webhookSecret: '',
      });
      const result = await expectSuccess(emptyAdapter.isAvailable());
      expect(result).toBe(false);
    });
  });

  describe('createIntent', () => {
    it('creates a payment intent successfully', async () => {
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 15000,
          currency: 'USD',
          description: 'TMD 30min massage',
          idempotencyKey: 'test-stripe-key-1',
        })
      );

      expect(intent.id).toMatch(/^pi_mock_/);
      expect(intent.amount).toBe(15000);
      expect(intent.currency).toBe('USD');
      expect(intent.processor).toBe('stripe');
      expect(intent.status).toBe('pending');
      expect(intent.metadata).toBeDefined();
      expect(intent.metadata?.clientSecret).toMatch(/_secret_mock$/);
    });

    it('includes metadata in intent', async () => {
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 20000,
          currency: 'USD',
          description: 'TMD 60min massage',
          metadata: { bookingId: '12345', serviceId: 'tmd-60' },
          idempotencyKey: 'test-stripe-meta-key',
        })
      );

      expect(intent.id).toBeDefined();
      expect(intent.processor).toBe('stripe');
    });

    it('handles API errors gracefully', async () => {
      configureStripeMock({ failNextRequest: true });

      const error = await expectFailureTag(
        adapter.createIntent({
          amount: 15000,
          currency: 'USD',
          description: 'Test payment',
          idempotencyKey: 'fail-stripe-key',
        }),
        'PaymentError'
      );

      expect(error._tag).toBe('PaymentError');
      if (error._tag === 'PaymentError') {
        expect(error.code).toBe('CREATE_INTENT_FAILED');
        expect(error.processor).toBe('stripe');
        expect(error.recoverable).toBe(true);
      }
    });
  });

  describe('capturePayment', () => {
    it('captures (retrieves) a succeeded payment intent', async () => {
      // First create an intent
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 15000,
          currency: 'USD',
          description: 'Test capture',
          idempotencyKey: 'capture-stripe-key',
        })
      );

      // Then capture (GET retrieves the auto-captured intent)
      const result = await expectSuccess(adapter.capturePayment(intent.id));

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.processor).toBe('stripe');
      expect(result.amount).toBe(15000);
      expect(result.currency).toBe('USD');
      expect(result.timestamp).toBeDefined();
    });

    it('handles capture failure', async () => {
      // Create an intent first so a valid ID exists
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 10000,
          currency: 'USD',
          description: 'Will fail capture',
          idempotencyKey: 'capture-fail-key',
        })
      );

      configureStripeMock({ simulateCaptureFailure: true });

      const error = await expectFailureTag(
        adapter.capturePayment(intent.id),
        'PaymentError'
      );

      expect(error._tag).toBe('PaymentError');
      if (error._tag === 'PaymentError') {
        expect(error.code).toBe('CAPTURE_FAILED');
        expect(error.recoverable).toBe(false);
      }
    });
  });

  describe('cancelIntent', () => {
    it('cancels a payment intent', async () => {
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 10000,
          currency: 'USD',
          description: 'To cancel',
          idempotencyKey: 'cancel-stripe-key',
        })
      );

      await Effect.runPromise(adapter.cancelIntent(intent.id));
    });
  });

  describe('refund', () => {
    it('processes a full refund successfully', async () => {
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 20000,
          currency: 'USD',
          description: 'To refund',
          idempotencyKey: 'refund-stripe-key',
        })
      );

      const refund = await expectSuccess(
        adapter.refund({
          transactionId: intent.id,
          reason: 'Customer requested cancellation',
        })
      );

      expect(refund.success).toBe(true);
      expect(refund.refundId).toMatch(/^re_mock_/);
      expect(refund.originalTransactionId).toBe(intent.id);
      expect(refund.amount).toBe(20000);
      expect(refund.currency).toBe('USD');
      expect(refund.timestamp).toBeDefined();
    });

    it('processes a partial refund', async () => {
      const intent = await expectSuccess(
        adapter.createIntent({
          amount: 20000,
          currency: 'USD',
          description: 'Partial refund test',
          idempotencyKey: 'partial-refund-key',
        })
      );

      const refund = await expectSuccess(
        adapter.refund({
          transactionId: intent.id,
          amount: 10000,
          reason: 'Partial service',
        })
      );

      expect(refund.success).toBe(true);
      expect(refund.amount).toBe(10000);
    });

    it('handles refund failure', async () => {
      configureStripeMock({ simulateRefundFailure: true });

      const error = await expectFailureTag(
        adapter.refund({
          transactionId: 'pi_mock_fail',
          reason: 'Test failure',
        }),
        'PaymentError'
      );

      expect(error._tag).toBe('PaymentError');
      if (error._tag === 'PaymentError') {
        expect(error.code).toBe('REFUND_FAILED');
        expect(error.processor).toBe('stripe');
      }
    });
  });

  describe('getClientConfig', () => {
    it('returns correct client configuration for test keys', () => {
      const config = adapter.getClientConfig();

      expect(config.name).toBe('stripe');
      expect(config.displayName).toBe('Credit/Debit Card');
      expect(config.clientId).toBe('pk_test_mock12345');
      expect(config.environment).toBe('sandbox');
      expect(config.supportedCurrencies).toContain('USD');
    });

    it('detects production environment from live keys', () => {
      const liveAdapter = createStripeAdapter({
        type: 'stripe',
        secretKey: 'sk_live_mock12345',
        publishableKey: 'pk_live_mock12345',
        webhookSecret: 'whsec_mock12345',
      });

      const config = liveAdapter.getClientConfig();
      expect(config.environment).toBe('production');
      expect(config.clientId).toBe('pk_live_mock12345');
    });
  });

  describe('parseWebhook', () => {
    it('parses payment_intent.succeeded webhook', async () => {
      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_success',
            amount: 15000,
            currency: 'usd',
            created: 1709136000,
            metadata: { bookingId: '12345' },
          },
        },
      });

      const event = await expectSuccess(adapter.parseWebhook(payload));

      expect(event.type).toBe('payment.completed');
      expect(event.transactionId).toBe('pi_test_success');
      expect(event.amount).toBe(15000);
      expect(event.currency).toBe('USD');
      expect(event.metadata).toEqual({ bookingId: '12345' });
    });

    it('parses payment_intent.payment_failed webhook', async () => {
      const payload = JSON.stringify({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_failed',
            amount: 10000,
            currency: 'usd',
            created: 1709136000,
          },
        },
      });

      const event = await expectSuccess(adapter.parseWebhook(payload));
      expect(event.type).toBe('payment.failed');
      expect(event.transactionId).toBe('pi_test_failed');
    });

    it('parses payment_intent.canceled webhook', async () => {
      const payload = JSON.stringify({
        type: 'payment_intent.canceled',
        data: {
          object: {
            id: 'pi_test_canceled',
            amount: 20000,
            currency: 'usd',
            created: 1709136000,
          },
        },
      });

      const event = await expectSuccess(adapter.parseWebhook(payload));
      expect(event.type).toBe('payment.cancelled');
    });

    it('parses charge.refunded webhook', async () => {
      const payload = JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_refund',
            amount: 15000,
            currency: 'usd',
            created: 1709136000,
            payment_intent: 'pi_test_original',
          },
        },
      });

      const event = await expectSuccess(adapter.parseWebhook(payload));
      expect(event.type).toBe('refund.completed');
      expect(event.intentId).toBe('pi_test_original');
    });

    it('handles unknown event type', async () => {
      const payload = JSON.stringify({
        type: 'unknown.event.type',
        data: {
          object: {
            id: 'obj_unknown',
            amount: 5000,
            currency: 'usd',
            created: 1709136000,
          },
        },
      });

      const event = await expectSuccess(adapter.parseWebhook(payload));
      expect(event.type).toBe('payment.failed');
    });

    it('handles invalid JSON payload', async () => {
      const error = await expectFailureTag(
        adapter.parseWebhook('invalid json'),
        'PaymentError'
      );

      expect(error._tag).toBe('PaymentError');
      if (error._tag === 'PaymentError') {
        expect(error.code).toBe('WEBHOOK_PARSE_FAILED');
      }
    });
  });
});
