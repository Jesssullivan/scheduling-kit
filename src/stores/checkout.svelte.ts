/**
 * Checkout Store
 * Svelte 5 runes-based state management for checkout flow
 */

import { getContext, setContext } from 'svelte';
import type {
  CheckoutStep,
  CheckoutState,
  Service,
  Provider,
  ClientInfo,
  PaymentIntent,
  PaymentResult,
  Booking,
  SlotReservation,
  SchedulingError,
} from '../core/types.js';

// =============================================================================
// STORE KEY
// =============================================================================

const CHECKOUT_STORE_KEY = Symbol('checkout-store');

// =============================================================================
// CHECKOUT STORE
// =============================================================================

export interface CheckoutStore {
  // State (readonly from outside)
  readonly step: CheckoutStep;
  readonly service: Service | undefined;
  readonly provider: Provider | undefined;
  readonly datetime: string | undefined;
  readonly client: ClientInfo | undefined;
  readonly paymentMethod: string | undefined;
  readonly paymentIntent: PaymentIntent | undefined;
  readonly paymentResult: PaymentResult | undefined;
  readonly booking: Booking | undefined;
  readonly reservation: SlotReservation | undefined;
  readonly error: SchedulingError | undefined;
  readonly isLoading: boolean;

  // Derived
  readonly canGoBack: boolean;
  readonly canProceed: boolean;
  readonly progress: number;

  // Actions
  selectService(service: Service): void;
  selectProvider(provider: Provider | undefined): void;
  selectDateTime(datetime: string): void;
  setClient(client: ClientInfo): void;
  selectPaymentMethod(method: string): void;
  setPaymentIntent(intent: PaymentIntent): void;
  setPaymentResult(result: PaymentResult): void;
  setBooking(booking: Booking): void;
  setReservation(reservation: SlotReservation): void;
  setError(error: SchedulingError): void;
  clearError(): void;
  setLoading(loading: boolean): void;
  goBack(): void;
  goToStep(step: CheckoutStep): void;
  reset(): void;
}

// =============================================================================
// STEP CONFIGURATION
// =============================================================================

const STEP_ORDER: CheckoutStep[] = [
  'service',
  'provider',
  'datetime',
  'details',
  'payment',
  'confirm',
  'complete',
];

const getStepIndex = (step: CheckoutStep): number =>
  STEP_ORDER.indexOf(step);

const getPreviousStep = (step: CheckoutStep): CheckoutStep | undefined => {
  const index = getStepIndex(step);
  return index > 0 ? STEP_ORDER[index - 1] : undefined;
};

const getNextStep = (step: CheckoutStep): CheckoutStep | undefined => {
  const index = getStepIndex(step);
  return index < STEP_ORDER.length - 1 ? STEP_ORDER[index + 1] : undefined;
};

// =============================================================================
// STORE FACTORY
// =============================================================================

export const createCheckoutStore = (): CheckoutStore => {
  // Reactive state using Svelte 5 runes
  let step = $state<CheckoutStep>('service');
  let service = $state<Service | undefined>(undefined);
  let provider = $state<Provider | undefined>(undefined);
  let datetime = $state<string | undefined>(undefined);
  let client = $state<ClientInfo | undefined>(undefined);
  let paymentMethod = $state<string | undefined>(undefined);
  let paymentIntent = $state<PaymentIntent | undefined>(undefined);
  let paymentResult = $state<PaymentResult | undefined>(undefined);
  let booking = $state<Booking | undefined>(undefined);
  let reservation = $state<SlotReservation | undefined>(undefined);
  let error = $state<SchedulingError | undefined>(undefined);
  let isLoading = $state(false);

  // Derived state
  const canGoBack = $derived(getStepIndex(step) > 0 && step !== 'complete');

  const canProceed = $derived.by(() => {
    switch (step) {
      case 'service':
        return service !== undefined;
      case 'provider':
        return true; // Provider is optional
      case 'datetime':
        return datetime !== undefined;
      case 'details':
        return client !== undefined && !!client.firstName && !!client.lastName && !!client.email;
      case 'payment':
        return paymentMethod !== undefined;
      case 'confirm':
        return true;
      case 'complete':
        return false;
      case 'error':
        return false;
      default:
        return false;
    }
  });

  const progress = $derived(
    Math.round(((getStepIndex(step) + 1) / STEP_ORDER.length) * 100)
  );

  return {
    // State getters
    get step() { return step; },
    get service() { return service; },
    get provider() { return provider; },
    get datetime() { return datetime; },
    get client() { return client; },
    get paymentMethod() { return paymentMethod; },
    get paymentIntent() { return paymentIntent; },
    get paymentResult() { return paymentResult; },
    get booking() { return booking; },
    get reservation() { return reservation; },
    get error() { return error; },
    get isLoading() { return isLoading; },

    // Derived getters
    get canGoBack() { return canGoBack; },
    get canProceed() { return canProceed; },
    get progress() { return progress; },

    // Actions
    selectService(s: Service) {
      service = s;
      step = 'provider';
    },

    selectProvider(p: Provider | undefined) {
      provider = p;
      step = 'datetime';
    },

    selectDateTime(dt: string) {
      datetime = dt;
      step = 'details';
    },

    setClient(c: ClientInfo) {
      client = c;
      step = 'payment';
    },

    selectPaymentMethod(method: string) {
      paymentMethod = method;
      step = 'confirm';
    },

    setPaymentIntent(intent: PaymentIntent) {
      paymentIntent = intent;
    },

    setPaymentResult(result: PaymentResult) {
      paymentResult = result;
    },

    setBooking(b: Booking) {
      booking = b;
      step = 'complete';
    },

    setReservation(r: SlotReservation) {
      reservation = r;
    },

    setError(e: SchedulingError) {
      error = e;
      step = 'error';
    },

    clearError() {
      error = undefined;
      // Go back to last valid step
      if (booking) step = 'complete';
      else if (paymentResult) step = 'confirm';
      else if (client) step = 'payment';
      else if (datetime) step = 'details';
      else if (service) step = 'datetime';
      else step = 'service';
    },

    setLoading(loading: boolean) {
      isLoading = loading;
    },

    goBack() {
      const prev = getPreviousStep(step);
      if (prev) {
        step = prev;
        error = undefined;
      }
    },

    goToStep(targetStep: CheckoutStep) {
      const targetIndex = getStepIndex(targetStep);
      const currentIndex = getStepIndex(step);

      // Only allow going back, not forward (forward requires validation)
      if (targetIndex < currentIndex) {
        step = targetStep;
        error = undefined;
      }
    },

    reset() {
      step = 'service';
      service = undefined;
      provider = undefined;
      datetime = undefined;
      client = undefined;
      paymentMethod = undefined;
      paymentIntent = undefined;
      paymentResult = undefined;
      booking = undefined;
      reservation = undefined;
      error = undefined;
      isLoading = false;
    },
  };
};

// =============================================================================
// CONTEXT HELPERS
// =============================================================================

export const setCheckoutContext = (store: CheckoutStore): void => {
  setContext(CHECKOUT_STORE_KEY, store);
};

export const getCheckoutContext = (): CheckoutStore => {
  const store = getContext<CheckoutStore>(CHECKOUT_STORE_KEY);
  if (!store) {
    throw new Error('Checkout store not found in context. Did you forget to wrap with CheckoutProvider?');
  }
  return store;
};
