/**
 * Stripe API Mock Handlers
 * MSW request handlers for Stripe Payment Intents API
 */

import { http, HttpResponse, delay } from 'msw';

const STRIPE_BASE_URL = 'https://api.stripe.com';

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

interface MockPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action'
    | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
  client_secret: string;
  description?: string;
  metadata: Record<string, string>;
  created: number;
  latest_charge?: string;
}

interface MockState {
  intents: Map<string, MockPaymentIntent>;
  nextIntentId: number;
  failNextRequest: boolean;
  simulateCaptureFailure: boolean;
  simulateRefundFailure: boolean;
  simulateNetworkDelay: number;
}

const defaultState: MockState = {
  intents: new Map(),
  nextIntentId: 1000,
  failNextRequest: false,
  simulateCaptureFailure: false,
  simulateRefundFailure: false,
  simulateNetworkDelay: 0,
};

let state = { ...defaultState };

export const resetStripeMockState = () => {
  state = {
    intents: new Map(),
    nextIntentId: 1000,
    failNextRequest: false,
    simulateCaptureFailure: false,
    simulateRefundFailure: false,
    simulateNetworkDelay: 0,
  };
};

export const configureStripeMock = (config: Partial<MockState>) => {
  Object.assign(state, config);
};

export const getStripeMockState = () => ({ ...state });

// =============================================================================
// HELPER MIDDLEWARE
// =============================================================================

const withMiddleware = async (
  handler: () => Response | Promise<Response>
): Promise<Response> => {
  if (state.simulateNetworkDelay > 0) {
    await delay(state.simulateNetworkDelay);
  }

  if (state.failNextRequest) {
    state.failNextRequest = false;
    return HttpResponse.json(
      {
        error: {
          type: 'api_error',
          message: 'An internal error occurred.',
        },
      },
      { status: 500 }
    );
  }

  return handler();
};

// =============================================================================
// PAYMENT INTENTS
// =============================================================================

const createPaymentIntent = http.post(
  `${STRIPE_BASE_URL}/v1/payment_intents`,
  async ({ request }) => {
    const text = await request.text();
    const params = new URLSearchParams(text);

    return withMiddleware(() => {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer sk_')) {
        return HttpResponse.json(
          {
            error: {
              type: 'authentication_error',
              message: 'Invalid API key provided.',
            },
          },
          { status: 401 }
        );
      }

      const id = `pi_mock_${state.nextIntentId++}`;
      const amount = parseInt(params.get('amount') ?? '0', 10);
      const currency = params.get('currency') ?? 'usd';

      // Extract metadata
      const metadata: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        const match = key.match(/^metadata\[(.+)\]$/);
        if (match) metadata[match[1]] = value;
      }

      const intent: MockPaymentIntent = {
        id,
        amount,
        currency,
        status: 'requires_payment_method',
        client_secret: `${id}_secret_mock`,
        description: params.get('description') ?? undefined,
        metadata,
        created: Math.floor(Date.now() / 1000),
      };

      state.intents.set(id, intent);

      return HttpResponse.json({
        id: intent.id,
        object: 'payment_intent',
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        client_secret: intent.client_secret,
        description: intent.description,
        metadata: intent.metadata,
        created: intent.created,
      });
    });
  }
);

const getPaymentIntent = http.get(
  `${STRIPE_BASE_URL}/v1/payment_intents/:id`,
  async ({ params }) => {
    const id = params.id as string;

    return withMiddleware(() => {
      if (state.simulateCaptureFailure) {
        state.simulateCaptureFailure = false;
        return HttpResponse.json(
          {
            error: {
              type: 'api_error',
              message: 'An internal error occurred while retrieving payment intent.',
            },
          },
          { status: 500 }
        );
      }

      const intent = state.intents.get(id);
      if (!intent) {
        return HttpResponse.json(
          {
            error: {
              type: 'invalid_request_error',
              message: `No such payment_intent: '${id}'`,
              code: 'resource_missing',
            },
          },
          { status: 404 }
        );
      }

      // Simulate auto-capture: mark as succeeded when retrieved
      intent.status = 'succeeded';
      intent.latest_charge = `ch_mock_${id}`;

      return HttpResponse.json({
        id: intent.id,
        object: 'payment_intent',
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        client_secret: intent.client_secret,
        description: intent.description,
        metadata: intent.metadata,
        created: intent.created,
        latest_charge: intent.latest_charge,
      });
    });
  }
);

const cancelPaymentIntent = http.post(
  `${STRIPE_BASE_URL}/v1/payment_intents/:id/cancel`,
  async ({ params }) => {
    const id = params.id as string;

    return withMiddleware(() => {
      const intent = state.intents.get(id);
      if (!intent) {
        return HttpResponse.json(
          {
            error: {
              type: 'invalid_request_error',
              message: `No such payment_intent: '${id}'`,
              code: 'resource_missing',
            },
          },
          { status: 404 }
        );
      }

      intent.status = 'canceled';

      return HttpResponse.json({
        id: intent.id,
        object: 'payment_intent',
        amount: intent.amount,
        currency: intent.currency,
        status: 'canceled',
        client_secret: intent.client_secret,
        created: intent.created,
      });
    });
  }
);

// =============================================================================
// REFUNDS
// =============================================================================

const createRefund = http.post(
  `${STRIPE_BASE_URL}/v1/refunds`,
  async ({ request }) => {
    const text = await request.text();
    const params = new URLSearchParams(text);

    return withMiddleware(() => {
      if (state.simulateRefundFailure) {
        state.simulateRefundFailure = false;
        return HttpResponse.json(
          {
            error: {
              type: 'api_error',
              message: 'An internal error occurred while processing the refund.',
            },
          },
          { status: 500 }
        );
      }

      const paymentIntent = params.get('payment_intent') ?? '';
      const amount = params.get('amount');

      // Look up the intent to get the original amount
      const intent = state.intents.get(paymentIntent);
      const refundAmount = amount ? parseInt(amount, 10) : (intent?.amount ?? 0);

      const refundId = `re_mock_${Date.now()}`;

      return HttpResponse.json({
        id: refundId,
        object: 'refund',
        amount: refundAmount,
        currency: intent?.currency ?? 'usd',
        status: 'succeeded',
        payment_intent: paymentIntent,
        created: Math.floor(Date.now() / 1000),
      });
    });
  }
);

// =============================================================================
// EXPORT ALL HANDLERS
// =============================================================================

export const stripeHandlers = [
  createPaymentIntent,
  getPaymentIntent,
  cancelPaymentIntent,
  createRefund,
];
