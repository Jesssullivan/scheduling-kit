/**
 * PayPal/Venmo API Mock Handlers
 * MSW request handlers for PayPal Checkout API (Venmo integration)
 */

import { http, HttpResponse, delay } from 'msw';

const PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
const PAYPAL_LIVE_URL = 'https://api-m.paypal.com';

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

interface MockOrder {
  id: string;
  status: 'CREATED' | 'APPROVED' | 'COMPLETED' | 'VOIDED';
  amount: {
    currency_code: string;
    value: string;
  };
  paymentSource?: string;
  createTime: string;
  captureId?: string;
}

interface MockState {
  orders: Map<string, MockOrder>;
  captures: Map<string, MockOrder>; // Map capture ID to order for refunds
  accessToken: string;
  nextOrderId: number;
  failNextRequest: boolean;
  simulateDecline: boolean;
  simulateCaptureFailure: boolean;
  simulateRefundFailure: boolean;
  simulateNetworkDelay: number;
}

const defaultState: MockState = {
  orders: new Map(),
  captures: new Map(),
  accessToken: 'mock-access-token-12345',
  nextOrderId: 1000,
  failNextRequest: false,
  simulateDecline: false,
  simulateCaptureFailure: false,
  simulateRefundFailure: false,
  simulateNetworkDelay: 0,
};

let state = { ...defaultState };

/**
 * Reset mock state to defaults
 */
export const resetPayPalMockState = () => {
  state = {
    orders: new Map(),
    captures: new Map(),
    accessToken: 'mock-access-token-12345',
    nextOrderId: 1000,
    failNextRequest: false,
    simulateDecline: false,
    simulateCaptureFailure: false,
    simulateRefundFailure: false,
    simulateNetworkDelay: 0,
  };
};

/**
 * Configure mock behavior for testing
 */
export const configurePayPalMock = (config: Partial<MockState>) => {
  Object.assign(state, config);
};

/**
 * Get current mock state (for assertions)
 */
export const getPayPalMockState = () => ({ ...state });

// =============================================================================
// HELPER MIDDLEWARE
// =============================================================================

const withMiddleware = async (
  handler: () => Response | Promise<Response>
): Promise<Response> => {
  // Simulate network delay
  if (state.simulateNetworkDelay > 0) {
    await delay(state.simulateNetworkDelay);
  }

  // Simulate failure
  if (state.failNextRequest) {
    state.failNextRequest = false;
    return HttpResponse.json(
      {
        name: 'INTERNAL_SERVICE_ERROR',
        message: 'An internal service error occurred.',
      },
      { status: 500 }
    );
  }

  return handler();
};

// =============================================================================
// OAUTH TOKEN
// =============================================================================

const getAccessToken = http.post(
  `${PAYPAL_BASE_URL}/v1/oauth2/token`,
  async ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    return withMiddleware(() => {
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        return HttpResponse.json(
          { error: 'invalid_client', error_description: 'Client authentication failed' },
          { status: 401 }
        );
      }

      return HttpResponse.json({
        scope: 'https://uri.paypal.com/services/payments/orders',
        access_token: state.accessToken,
        token_type: 'Bearer',
        app_id: 'APP-MOCK12345',
        expires_in: 32400,
        nonce: `mock-nonce-${Date.now()}`,
      });
    });
  }
);

// =============================================================================
// ORDERS (Payment Intents)
// =============================================================================

const createOrder = http.post(`${PAYPAL_BASE_URL}/v2/checkout/orders`, async ({ request }) => {
  const body = (await request.json()) as {
    intent: 'CAPTURE' | 'AUTHORIZE';
    purchase_units: Array<{
      amount: {
        currency_code: string;
        value: string;
      };
      description?: string;
    }>;
    payment_source?: {
      venmo?: object;
      paypal?: object;
    };
  };

  return withMiddleware(() => {
    const orderId = `${state.nextOrderId++}MOCK`;
    const purchaseUnit = body.purchase_units[0];

    const order: MockOrder = {
      id: orderId,
      status: 'CREATED',
      amount: purchaseUnit.amount,
      paymentSource: body.payment_source?.venmo ? 'venmo' : 'paypal',
      createTime: new Date().toISOString(),
    };

    state.orders.set(orderId, order);

    return HttpResponse.json({
      id: orderId,
      status: order.status,
      purchase_units: [
        {
          reference_id: orderId,
          amount: order.amount,
        },
      ],
      create_time: order.createTime,
      links: [
        {
          href: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
          rel: 'self',
          method: 'GET',
        },
        {
          href: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
          rel: 'capture',
          method: 'POST',
        },
        {
          href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
          rel: 'payer-action',
          method: 'GET',
        },
      ],
    });
  });
});

const getOrder = http.get(`${PAYPAL_BASE_URL}/v2/checkout/orders/:id`, async ({ params }) => {
  const id = params.id as string;

  return withMiddleware(() => {
    const order = state.orders.get(id);
    if (!order) {
      return HttpResponse.json(
        { name: 'RESOURCE_NOT_FOUND', message: `Order ${id} not found` },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      id: order.id,
      status: order.status,
      create_time: order.createTime,
      purchase_units: [
        {
          amount: order.amount,
          payments: order.captureId
            ? {
                captures: [
                  {
                    id: order.captureId,
                    status: 'COMPLETED',
                    amount: order.amount,
                    final_capture: true,
                    create_time: new Date().toISOString(),
                  },
                ],
              }
            : undefined,
        },
      ],
    });
  });
});

const captureOrder = http.post(
  `${PAYPAL_BASE_URL}/v2/checkout/orders/:id/capture`,
  async ({ params }) => {
    const id = params.id as string;

    return withMiddleware(() => {
      // Simulate capture failure (before checking order exists)
      if (state.simulateCaptureFailure) {
        state.simulateCaptureFailure = false;
        return HttpResponse.json(
          {
            name: 'INTERNAL_SERVICE_ERROR',
            message: 'An internal error occurred while capturing payment.',
          },
          { status: 500 }
        );
      }

      const order = state.orders.get(id);
      if (!order) {
        return HttpResponse.json(
          { name: 'RESOURCE_NOT_FOUND', message: `Order ${id} not found` },
          { status: 404 }
        );
      }

      // Simulate payment decline
      if (state.simulateDecline) {
        state.simulateDecline = false;
        return HttpResponse.json(
          {
            name: 'UNPROCESSABLE_ENTITY',
            details: [
              {
                issue: 'INSTRUMENT_DECLINED',
                description: 'The instrument presented was declined.',
              },
            ],
          },
          { status: 422 }
        );
      }

      // Mark as captured
      const captureId = `CAPTURE-${id}-${Date.now()}`;
      order.status = 'COMPLETED';
      order.captureId = captureId;
      state.captures.set(captureId, order);

      return HttpResponse.json({
        id: order.id,
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: captureId,
                  status: 'COMPLETED',
                  amount: order.amount,
                  final_capture: true,
                  create_time: new Date().toISOString(),
                },
              ],
            },
          },
        ],
        payer: {
          email_address: 'payer@example.com',
          payer_id: 'PAYER12345',
          name: {
            given_name: 'John',
            surname: 'Doe',
          },
        },
      });
    });
  }
);

// =============================================================================
// REFUNDS
// =============================================================================

const createRefund = http.post(
  `${PAYPAL_BASE_URL}/v2/payments/captures/:captureId/refund`,
  async ({ params, request }) => {
    const captureId = params.captureId as string;
    // Body may be empty for full refunds
    let body: { amount?: { currency_code: string; value: string }; note_to_payer?: string } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is valid for full refunds
    }

    return withMiddleware(() => {
      // Simulate refund failure
      if (state.simulateRefundFailure) {
        state.simulateRefundFailure = false;
        return HttpResponse.json(
          {
            name: 'INTERNAL_SERVICE_ERROR',
            message: 'An internal error occurred while processing the refund.',
          },
          { status: 500 }
        );
      }

      // Find order with this capture (check both captures map and orders)
      let order = state.captures.get(captureId);
      if (!order) {
        order = Array.from(state.orders.values()).find((o) => o.captureId === captureId);
      }

      // For testing, create a synthetic order if not found (allows direct refund tests)
      if (!order) {
        order = {
          id: captureId,
          status: 'COMPLETED',
          amount: body.amount || { currency_code: 'USD', value: '200.00' },
          createTime: new Date().toISOString(),
          captureId,
        };
      }

      const refundAmount = body.amount || order.amount;
      const refundId = `REFUND-${captureId}-${Date.now()}`;

      return HttpResponse.json({
        id: refundId,
        status: 'COMPLETED',
        amount: refundAmount,
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          {
            href: `${PAYPAL_BASE_URL}/v2/payments/refunds/${refundId}`,
            rel: 'self',
            method: 'GET',
          },
        ],
      });
    });
  }
);

// =============================================================================
// WEBHOOKS (Verification)
// =============================================================================

const verifyWebhook = http.post(
  `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
  async ({ request }) => {
    const body = (await request.json()) as {
      auth_algo: string;
      cert_url: string;
      transmission_id: string;
      transmission_sig: string;
      transmission_time: string;
      webhook_id: string;
      webhook_event: object;
    };

    return withMiddleware(() => {
      // For testing, validate that all required fields are present
      if (
        !body.auth_algo ||
        !body.transmission_id ||
        !body.transmission_sig ||
        !body.webhook_id ||
        !body.webhook_event
      ) {
        return HttpResponse.json(
          { name: 'INVALID_REQUEST', message: 'Missing required fields' },
          { status: 400 }
        );
      }

      // In testing, signature starting with 'VALID' passes, others fail
      const isValid = body.transmission_sig.startsWith('VALID');

      return HttpResponse.json({
        verification_status: isValid ? 'SUCCESS' : 'FAILURE',
      });
    });
  }
);

// =============================================================================
// ERROR SCENARIOS
// =============================================================================

/**
 * Handler that simulates PayPal being unavailable
 */
export const paypalUnavailableHandler = http.all(`${PAYPAL_BASE_URL}/*`, () => {
  return HttpResponse.json(
    {
      name: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable. Please try again later.',
    },
    { status: 503 }
  );
});

/**
 * Handler that simulates rate limiting
 */
export const paypalRateLimitHandler = http.all(`${PAYPAL_BASE_URL}/*`, () => {
  return HttpResponse.json(
    {
      name: 'RATE_LIMIT_REACHED',
      message: 'Too many requests. Retry after 60 seconds.',
    },
    { status: 429, headers: { 'Retry-After': '60' } }
  );
});

// =============================================================================
// EXPORT ALL HANDLERS
// =============================================================================

export const paypalHandlers = [
  // Also handle sandbox URLs
  getAccessToken,
  createOrder,
  getOrder,
  captureOrder,
  createRefund,
  verifyWebhook,
];
