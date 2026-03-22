/**
 * Tests for HybridCheckoutDrawer state machine logic.
 *
 * The component lives in a .svelte file, so we re-implement the pure
 * state transition functions here and test them in a Node environment.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Re-implemented pure logic from HybridCheckoutDrawer.svelte
// ---------------------------------------------------------------------------

type HybridStep =
  | 'service'
  | 'provider'
  | 'datetime'
  | 'details'
  | 'payment'
  | 'venmo-checkout'
  | 'stripe-checkout'
  | 'processing'
  | 'complete'
  | 'error';

const ALL_STEPS: HybridStep[] = [
  'service',
  'provider',
  'datetime',
  'details',
  'payment',
  'venmo-checkout',
  'stripe-checkout',
  'processing',
  'complete',
  'error',
];

const stepTitles: Record<HybridStep, string> = {
  service: 'Select a Service',
  provider: 'Choose Your Provider',
  datetime: 'Pick a Date & Time',
  details: 'Your Information',
  payment: 'Payment Method',
  'venmo-checkout': 'Pay with Venmo',
  'stripe-checkout': 'Pay with Card',
  processing: 'Processing...',
  complete: 'Booking Confirmed',
  error: 'Something Went Wrong',
};

const calcProgress = (step: HybridStep, skipProvider = false): number => {
  const steps: HybridStep[] = skipProvider
    ? ['service', 'datetime', 'details', 'payment']
    : ['service', 'provider', 'datetime', 'details', 'payment'];
  const index = steps.indexOf(step);
  if (index === -1) return 100;
  return Math.round(((index + 1) / steps.length) * 100);
};

const canGoBack = (step: HybridStep): boolean =>
  step !== 'service' && step !== 'complete' && step !== 'processing' && step !== 'venmo-checkout' && step !== 'stripe-checkout';

const handleBack = (step: HybridStep, skipProvider = false): HybridStep => {
  switch (step) {
    case 'provider':
      return 'service';
    case 'datetime':
      return skipProvider ? 'service' : 'provider';
    case 'details':
      return 'datetime';
    case 'payment':
      return 'details';
    case 'venmo-checkout':
      return 'payment';
    case 'stripe-checkout':
      return 'payment';
    case 'error':
      return 'payment';
    default:
      return step;
  }
};

interface PaymentOption {
  id: string;
}

// Simulates the $derived paymentOptions with all adapters configured
const buildPaymentOptions = (opts: { hasVenmo?: boolean; hasStripe?: boolean } = {}): PaymentOption[] => {
  const { hasVenmo = true, hasStripe = false } = opts;
  const result: PaymentOption[] = [];
  if (hasVenmo) result.push({ id: 'venmo' });
  if (hasStripe) result.push({ id: 'stripe' });
  result.push({ id: 'cash' });
  return result;
};

// Default: Venmo + Cash (no Stripe, matching original behavior)
const paymentOptions = buildPaymentOptions();

const routePayment = (paymentId: string, hasPaypalSdk: boolean, hasStripeSdk: boolean = false): HybridStep => {
  if (paymentId === 'venmo' && hasPaypalSdk) return 'venmo-checkout';
  if (paymentId === 'stripe' && hasStripeSdk) return 'stripe-checkout';
  return 'processing';
};

const formatPrice = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

// Forward transition map for the happy path
const forwardTransitions: Record<string, HybridStep> = {
  service: 'provider',
  provider: 'datetime',
  datetime: 'details',
  details: 'payment',
};

// Forward transition map when skipProvider is true
const forwardTransitionsSkipProvider: Record<string, HybridStep> = {
  service: 'datetime',
  datetime: 'details',
  details: 'payment',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HybridCheckoutDrawer state machine', () => {
  // -----------------------------------------------------------------------
  // 1. Step titles
  // -----------------------------------------------------------------------
  describe('stepTitles', () => {
    it('should have a title for every step', () => {
      for (const step of ALL_STEPS) {
        expect(stepTitles[step]).toBeDefined();
        expect(stepTitles[step].length).toBeGreaterThan(0);
      }
    });

    it('should have exactly 10 step titles', () => {
      expect(Object.keys(stepTitles)).toHaveLength(10);
    });

    it('should use human-readable titles (no camelCase or kebab-case)', () => {
      for (const title of Object.values(stepTitles)) {
        expect(title).toMatch(/^[A-Z]/);
        expect(title).not.toMatch(/[a-z][A-Z]/); // no camelCase
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Progress calculation
  // -----------------------------------------------------------------------
  describe('calcProgress', () => {
    it('should return 20% for service step', () => {
      expect(calcProgress('service')).toBe(20);
    });

    it('should return 40% for provider step', () => {
      expect(calcProgress('provider')).toBe(40);
    });

    it('should return 60% for datetime step', () => {
      expect(calcProgress('datetime')).toBe(60);
    });

    it('should return 80% for details step', () => {
      expect(calcProgress('details')).toBe(80);
    });

    it('should return 100% for payment step', () => {
      expect(calcProgress('payment')).toBe(100);
    });

    it('should return 100% for terminal steps not in the main flow', () => {
      const terminalSteps: HybridStep[] = [
        'venmo-checkout',
        'stripe-checkout',
        'processing',
        'complete',
        'error',
      ];
      for (const step of terminalSteps) {
        expect(calcProgress(step)).toBe(100);
      }
    });

    it('should always return a value between 1 and 100 inclusive', () => {
      for (const step of ALL_STEPS) {
        const progress = calcProgress(step);
        expect(progress).toBeGreaterThanOrEqual(1);
        expect(progress).toBeLessThanOrEqual(100);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. canGoBack
  // -----------------------------------------------------------------------
  describe('canGoBack', () => {
    it('should not allow going back from service (first step)', () => {
      expect(canGoBack('service')).toBe(false);
    });

    it('should not allow going back from complete (terminal)', () => {
      expect(canGoBack('complete')).toBe(false);
    });

    it('should not allow going back from processing (in-flight)', () => {
      expect(canGoBack('processing')).toBe(false);
    });

    it('should not allow going back from venmo-checkout (external flow)', () => {
      expect(canGoBack('venmo-checkout')).toBe(false);
    });

    it('should not allow going back from stripe-checkout (external flow)', () => {
      expect(canGoBack('stripe-checkout')).toBe(false);
    });

    it('should allow going back from provider', () => {
      expect(canGoBack('provider')).toBe(true);
    });

    it('should allow going back from datetime', () => {
      expect(canGoBack('datetime')).toBe(true);
    });

    it('should allow going back from details', () => {
      expect(canGoBack('details')).toBe(true);
    });

    it('should allow going back from payment', () => {
      expect(canGoBack('payment')).toBe(true);
    });

    it('should allow going back from error', () => {
      expect(canGoBack('error')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. handleBack
  // -----------------------------------------------------------------------
  describe('handleBack', () => {
    it('should go from provider back to service', () => {
      expect(handleBack('provider')).toBe('service');
    });

    it('should go from datetime back to provider', () => {
      expect(handleBack('datetime')).toBe('provider');
    });

    it('should go from details back to datetime', () => {
      expect(handleBack('details')).toBe('datetime');
    });

    it('should go from payment back to details', () => {
      expect(handleBack('payment')).toBe('details');
    });

    it('should go from venmo-checkout back to payment', () => {
      expect(handleBack('venmo-checkout')).toBe('payment');
    });

    it('should go from stripe-checkout back to payment', () => {
      expect(handleBack('stripe-checkout')).toBe('payment');
    });

    it('should go from error back to payment', () => {
      expect(handleBack('error')).toBe('payment');
    });

    it('should return the same step for service (no-op)', () => {
      expect(handleBack('service')).toBe('service');
    });

    it('should return the same step for complete (no-op)', () => {
      expect(handleBack('complete')).toBe('complete');
    });

    it('should return the same step for processing (no-op)', () => {
      expect(handleBack('processing')).toBe('processing');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Payment routing
  // -----------------------------------------------------------------------
  describe('routePayment', () => {
    it('should route card to processing when no SDK', () => {
      expect(routePayment('card', false)).toBe('processing');
      expect(routePayment('card', true)).toBe('processing');
    });

    it('should route stripe with Stripe SDK to stripe-checkout', () => {
      expect(routePayment('stripe', false, true)).toBe('stripe-checkout');
    });

    it('should route stripe without Stripe SDK to processing', () => {
      expect(routePayment('stripe', false, false)).toBe('processing');
    });

    it('should route venmo with PayPal SDK to venmo-checkout', () => {
      expect(routePayment('venmo', true)).toBe('venmo-checkout');
    });

    it('should route venmo without PayPal SDK to processing', () => {
      expect(routePayment('venmo', false)).toBe('processing');
    });

    it('should route cash to processing', () => {
      expect(routePayment('cash', false)).toBe('processing');
      expect(routePayment('cash', true)).toBe('processing');
    });

    it('should route unknown payment methods to processing', () => {
      expect(routePayment('bitcoin', false)).toBe('processing');
      expect(routePayment('check', true)).toBe('processing');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Forward transitions
  // -----------------------------------------------------------------------
  describe('forward transitions', () => {
    it('should advance from service to provider on service select', () => {
      expect(forwardTransitions['service']).toBe('provider');
    });

    it('should advance from provider to datetime on provider select', () => {
      expect(forwardTransitions['provider']).toBe('datetime');
    });

    it('should advance from datetime to details on time select', () => {
      expect(forwardTransitions['datetime']).toBe('details');
    });

    it('should advance from details to payment on client submit', () => {
      expect(forwardTransitions['details']).toBe('payment');
    });

    it('should not have a forward transition for payment (branching step)', () => {
      expect(forwardTransitions['payment']).toBeUndefined();
    });

    it('should cover all linear steps before the payment branch', () => {
      const linearSteps: HybridStep[] = ['service', 'provider', 'datetime', 'details'];
      for (const step of linearSteps) {
        expect(forwardTransitions[step]).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. Price formatting
  // -----------------------------------------------------------------------
  describe('formatPrice', () => {
    it('should format zero cents as $0.00', () => {
      expect(formatPrice(0)).toBe('$0.00');
    });

    it('should format 15000 cents as $150.00', () => {
      expect(formatPrice(15000)).toBe('$150.00');
    });

    it('should format 7500 cents as $75.00', () => {
      expect(formatPrice(7500)).toBe('$75.00');
    });

    it('should format 20000 cents as $200.00', () => {
      expect(formatPrice(20000)).toBe('$200.00');
    });

    it('should format 99 cents as $0.99', () => {
      expect(formatPrice(99)).toBe('$0.99');
    });

    it('should format large values correctly', () => {
      expect(formatPrice(100000)).toBe('$1,000.00');
    });

    it('should handle single-digit cents', () => {
      expect(formatPrice(1)).toBe('$0.01');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Full flow simulation
  // -----------------------------------------------------------------------
  describe('full flow simulation', () => {
    it('should complete a venmo flow: service -> ... -> complete', () => {
      let step: HybridStep = 'service';

      // Linear progression through the form
      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('provider');

      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('datetime');

      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('details');

      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('payment');

      // Payment routing
      step = routePayment('venmo', true);
      expect(step).toBe('venmo-checkout');

      // Venmo success -> processing -> complete
      step = 'processing';
      expect(calcProgress(step)).toBe(100);

      step = 'complete';
      expect(canGoBack(step)).toBe(false);
      expect(stepTitles[step]).toBe('Booking Confirmed');
    });

    it('should complete a stripe flow: service -> ... -> stripe-checkout -> complete', () => {
      let step: HybridStep = 'service';

      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('payment');

      step = routePayment('stripe', false, true);
      expect(step).toBe('stripe-checkout');
      expect(canGoBack(step)).toBe(false);

      // Stripe success -> processing -> complete
      step = 'processing';
      expect(calcProgress(step)).toBe(100);

      step = 'complete';
      expect(canGoBack(step)).toBe(false);
      expect(stepTitles[step]).toBe('Booking Confirmed');
    });

    it('should complete a card flow: service -> ... -> processing -> complete', () => {
      let step: HybridStep = 'service';

      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('payment');

      step = routePayment('card', false);
      expect(step).toBe('processing');
      expect(canGoBack(step)).toBe(false);

      step = 'complete';
      expect(stepTitles[step]).toBe('Booking Confirmed');
    });

    it('should complete a cash flow: service -> ... -> processing -> complete', () => {
      let step: HybridStep = 'service';

      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      step = forwardTransitions[step] as HybridStep;
      expect(step).toBe('payment');

      step = routePayment('cash', false);
      expect(step).toBe('processing');
      expect(canGoBack(step)).toBe(false);

      step = 'complete';
      expect(canGoBack(step)).toBe(false);
    });

    it('should allow recovery from error back to payment', () => {
      const step: HybridStep = 'error';
      expect(canGoBack(step)).toBe(true);

      const recovered = handleBack(step);
      expect(recovered).toBe('payment');
      expect(calcProgress(recovered)).toBe(100);
    });

    it('should allow navigating backward through the entire linear flow', () => {
      let step: HybridStep = 'payment';

      step = handleBack(step);
      expect(step).toBe('details');

      step = handleBack(step);
      expect(step).toBe('datetime');

      step = handleBack(step);
      expect(step).toBe('provider');

      step = handleBack(step);
      expect(step).toBe('service');

      // Cannot go back further
      step = handleBack(step);
      expect(step).toBe('service');
      expect(canGoBack(step)).toBe(false);
    });

    it('should show monotonically increasing progress through the linear flow', () => {
      const linearSteps: HybridStep[] = ['service', 'provider', 'datetime', 'details', 'payment'];
      let previousProgress = 0;
      for (const step of linearSteps) {
        const progress = calcProgress(step);
        expect(progress).toBeGreaterThan(previousProgress);
        previousProgress = progress;
      }
    });
  });

  // -----------------------------------------------------------------------
  // 9. Payment options structure
  // -----------------------------------------------------------------------
  describe('paymentOptions', () => {
    it('should have 2 options by default (venmo + cash)', () => {
      expect(paymentOptions).toHaveLength(2);
    });

    it('should keep venmo and cash in-app by default', () => {
      const ids = paymentOptions.map((p) => p.id);
      expect(ids).toContain('venmo');
      expect(ids).toContain('cash');
    });

    it('should include stripe when configured', () => {
      const opts = buildPaymentOptions({ hasVenmo: true, hasStripe: true });
      expect(opts).toHaveLength(3);
      expect(opts.map((p) => p.id)).toEqual(['venmo', 'stripe', 'cash']);
    });

    it('should show only cash when no adapters configured', () => {
      const opts = buildPaymentOptions({ hasVenmo: false, hasStripe: false });
      expect(opts).toHaveLength(1);
      expect(opts[0].id).toBe('cash');
    });

    it('should always put cash last', () => {
      const allOpts = buildPaymentOptions({ hasVenmo: true, hasStripe: true });
      expect(allOpts[allOpts.length - 1].id).toBe('cash');
    });
  });

  // -----------------------------------------------------------------------
  // 10. skipProvider mode
  // -----------------------------------------------------------------------
  describe('skipProvider mode', () => {
    describe('calcProgress with skipProvider', () => {
      it('should return 25% for service step (4 steps)', () => {
        expect(calcProgress('service', true)).toBe(25);
      });

      it('should return 50% for datetime step', () => {
        expect(calcProgress('datetime', true)).toBe(50);
      });

      it('should return 75% for details step', () => {
        expect(calcProgress('details', true)).toBe(75);
      });

      it('should return 100% for payment step', () => {
        expect(calcProgress('payment', true)).toBe(100);
      });

      it('should return 100% for provider step (not in flow)', () => {
        expect(calcProgress('provider', true)).toBe(100);
      });
    });

    describe('handleBack with skipProvider', () => {
      it('should go from datetime back to service (skipping provider)', () => {
        expect(handleBack('datetime', true)).toBe('service');
      });

      it('should go from details back to datetime', () => {
        expect(handleBack('details', true)).toBe('datetime');
      });

      it('should go from payment back to details', () => {
        expect(handleBack('payment', true)).toBe('details');
      });
    });

    describe('forward transitions with skipProvider', () => {
      it('should advance from service directly to datetime', () => {
        expect(forwardTransitionsSkipProvider['service']).toBe('datetime');
      });

      it('should advance from datetime to details', () => {
        expect(forwardTransitionsSkipProvider['datetime']).toBe('details');
      });

      it('should advance from details to payment', () => {
        expect(forwardTransitionsSkipProvider['details']).toBe('payment');
      });

      it('should not have a provider transition', () => {
        expect(forwardTransitionsSkipProvider['provider']).toBeUndefined();
      });
    });

    describe('full flow simulation with skipProvider', () => {
      it('should complete a cash flow without provider step', () => {
        let step: HybridStep = 'service';

        step = forwardTransitionsSkipProvider[step] as HybridStep;
        expect(step).toBe('datetime');

        step = forwardTransitionsSkipProvider[step] as HybridStep;
        expect(step).toBe('details');

        step = forwardTransitionsSkipProvider[step] as HybridStep;
        expect(step).toBe('payment');

        step = routePayment('cash', false);
        expect(step).toBe('processing');

        step = 'complete';
        expect(canGoBack(step)).toBe(false);
      });

      it('should navigate backward through the entire skipProvider flow', () => {
        let step: HybridStep = 'payment';

        step = handleBack(step, true);
        expect(step).toBe('details');

        step = handleBack(step, true);
        expect(step).toBe('datetime');

        step = handleBack(step, true);
        expect(step).toBe('service');

        expect(canGoBack(step)).toBe(false);
      });

      it('should show monotonically increasing progress (skipProvider)', () => {
        const linearSteps: HybridStep[] = ['service', 'datetime', 'details', 'payment'];
        let previousProgress = 0;
        for (const s of linearSteps) {
          const progress = calcProgress(s, true);
          expect(progress).toBeGreaterThan(previousProgress);
          previousProgress = progress;
        }
      });
    });
  });
});
