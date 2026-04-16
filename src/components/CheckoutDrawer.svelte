<script lang="ts">
  /**
   * CheckoutDrawer Component
   * Main orchestrating component for the entire checkout flow
   */
  import { Effect } from 'effect';
  import type { SchedulingKit } from '../core/pipelines.js';
  import { Errors, type Service, type Provider, type ClientInfo, type AvailableDate, type TimeSlot, type SchedulingError } from '../core/types.js';
  import type { PaymentMethodOption } from '../payments/types.js';
  import { createCheckoutStore, setCheckoutContext } from '../stores/checkout.svelte.js';
  import { generateIdempotencyKey } from '../core/utils.js';
  import ServicePicker from './ServicePicker.svelte';
  import ProviderPicker from './ProviderPicker.svelte';
  import DateTimePicker from './DateTimePicker.svelte';
  import ClientForm from './ClientForm.svelte';
  import PaymentSelector from './PaymentSelector.svelte';
  import BookingConfirmation from './BookingConfirmation.svelte';

  // Props
  let {
    kit,
    open = $bindable(false),
    onClose,
    onBookingComplete,
  }: {
    kit: SchedulingKit;
    open?: boolean;
    onClose?: () => void;
    onBookingComplete?: (bookingId: string) => void;
  } = $props();

  // Create and provide store
  const store = createCheckoutStore();
  setCheckoutContext(store);

  // Data state
  let services = $state<Service[]>([]);
  let providers = $state<Provider[]>([]);
  let availableDates = $state<AvailableDate[]>([]);
  let availableSlots = $state<TimeSlot[]>([]);
  let paymentMethods = $state<PaymentMethodOption[]>([]);

  // Loading states
  let loadingServices = $state(false);
  let loadingProviders = $state(false);
  let loadingDates = $state(false);
  let loadingSlots = $state(false);
  let loadingPayment = $state(false);
  let processingBooking = $state(false);

  // Error state
  let errorMessage = $state<string | undefined>(undefined);

  // Step titles
  const stepTitles: Record<string, string> = {
    service: 'Select a Service',
    provider: 'Choose Your Provider',
    datetime: 'Pick a Date & Time',
    details: 'Your Information',
    payment: 'Payment Method',
    confirm: 'Review & Confirm',
    complete: 'Booking Confirmed',
    error: 'Something Went Wrong',
  };

  // Load services on open
  $effect(() => {
    if (open && services.length === 0) {
      loadServices();
      loadPaymentMethods();
    }
  });

  // Load providers when service selected
  $effect(() => {
    if (store.service) {
      loadProviders(store.service.id);
    }
  });

  // Load dates when moving to datetime step
  $effect(() => {
    if (store.step === 'datetime' && store.service) {
      loadDates();
    }
  });

  // Load services
  const loadServices = async () => {
    loadingServices = true;
    errorMessage = undefined;

    try {
      services = await Effect.runPromise(kit.scheduler.getServices());
    } catch {
      errorMessage = 'Failed to load services. Please try again.';
    }

    loadingServices = false;
  };

  // Load providers for service
  const loadProviders = async (serviceId: string) => {
    loadingProviders = true;

    try {
      providers = await Effect.runPromise(kit.scheduler.getProvidersForService(serviceId));
    } catch {
      providers = [];
    }

    loadingProviders = false;
  };

  // Load available dates
  const loadDates = async () => {
    if (!store.service) return;

    loadingDates = true;
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
      availableDates = await Effect.runPromise(kit.scheduler.getAvailableDates({
        serviceId: store.service.id,
        providerId: store.provider?.id,
        startDate,
        endDate,
      }));
    } catch {
      availableDates = [];
    }

    loadingDates = false;
  };

  // Load time slots for date
  const loadSlots = async (date: string) => {
    if (!store.service) return;

    loadingSlots = true;

    try {
      availableSlots = await Effect.runPromise(kit.scheduler.getAvailableSlots({
        serviceId: store.service.id,
        providerId: store.provider?.id,
        date,
      }));
    } catch {
      availableSlots = [];
    }

    loadingSlots = false;
  };

  // Load payment methods
  const loadPaymentMethods = async () => {
    loadingPayment = true;

    const methods: PaymentMethodOption[] = [];
    for (const adapter of kit.payments.getAll()) {
      const config = adapter.getClientConfig();
      methods.push({
        id: adapter.name,
        name: adapter.name,
        displayName: config.displayName,
        icon: config.icon,
        available: true,
      });
    }

    paymentMethods = methods;
    loadingPayment = false;
  };

  // Handle service selection
  const handleServiceSelect = (service: Service) => {
    store.selectService(service);
  };

  // Handle provider selection
  const handleProviderSelect = (provider: Provider | undefined) => {
    store.selectProvider(provider);
  };

  // Handle date selection
  const handleDateSelect = (date: string) => {
    loadSlots(date);
  };

  // Handle time selection
  const handleTimeSelect = (datetime: string) => {
    store.selectDateTime(datetime);
  };

  // Handle client form submission
  const handleClientSubmit = (client: ClientInfo) => {
    store.setClient(client);
  };

  // Handle payment method selection
  const handlePaymentSelect = (methodId: string) => {
    store.selectPaymentMethod(methodId);
  };

  // Handle final booking
  const handleConfirmBooking = async () => {
    if (!store.service || !store.datetime || !store.client || !store.paymentMethod) {
      return;
    }

    processingBooking = true;
    errorMessage = undefined;

    try {
      const result = await Effect.runPromise(kit.completeBooking(
        {
          serviceId: store.service.id,
          providerId: store.provider?.id,
          datetime: store.datetime,
          client: store.client,
          paymentMethod: store.paymentMethod,
          idempotencyKey: generateIdempotencyKey('booking'),
        },
        store.paymentMethod
      ));
      store.setPaymentResult(result.payment);
      store.setBooking(result.booking);
      onBookingComplete?.(result.booking.id);
    } catch (e) {
      const error = toSchedulingError(e);
      errorMessage = getErrorMessage(error);
      store.setError(error);
    }

    processingBooking = false;
  };

  const toSchedulingError = (error: unknown): SchedulingError => {
    if (typeof error === 'object' && error !== null && '_tag' in error) {
      return error as SchedulingError;
    }

    if (error instanceof Error) {
      return Errors.infrastructure('UNKNOWN', error.message, error);
    }

    return Errors.infrastructure('UNKNOWN', String(error));
  };

  // Get user-friendly error message
  const getErrorMessage = (error: unknown): string => {
    if (typeof error === 'object' && error !== null && '_tag' in error) {
      const e = error as { _tag: string; message?: string; code?: string };
      switch (e._tag) {
        case 'ReservationError':
          return 'This time slot is no longer available. Please select a different time.';
        case 'PaymentError':
          return 'Payment failed. Please try again or choose a different payment method.';
        case 'ValidationError':
          return e.message || 'Please check your information and try again.';
        default:
          return e.message || 'An unexpected error occurred. Please try again.';
      }
    }
    return 'An unexpected error occurred. Please try again.';
  };

  // Handle close
  const handleClose = () => {
    open = false;
    onClose?.();
  };

  // Handle new booking
  const handleNewBooking = () => {
    store.reset();
    loadServices();
  };

  // Handle back navigation
  const handleBack = () => {
    errorMessage = undefined;
    store.goBack();
  };

  // Format price
  const formatPrice = (cents: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="drawer-backdrop fixed inset-0 bg-black/50 z-40"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
    role="button"
    tabindex="-1"
    aria-label="Close drawer"
  ></div>

  <!-- Drawer -->
  <div
    class="drawer fixed right-0 top-0 h-full w-full sm:w-[480px] bg-surface-50-950 shadow-xl z-50 flex flex-col"
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawer-title"
  >
    <!-- Header -->
    <header class="drawer-header flex items-center justify-between p-4 border-b border-surface-200-800">
      <div class="flex items-center gap-3">
        {#if store.canGoBack}
          <button
            type="button"
            class="btn btn-sm preset-tonal"
            onclick={handleBack}
            aria-label="Go back"
          >
            ←
          </button>
        {/if}
        <h2 id="drawer-title" class="text-lg font-semibold">
          {stepTitles[store.step]}
        </h2>
      </div>

      <button
        type="button"
        class="btn btn-sm preset-tonal"
        onclick={handleClose}
        aria-label="Close"
      >
        ✕
      </button>
    </header>

    <!-- Progress Bar -->
    {#if store.step !== 'complete' && store.step !== 'error'}
      <div class="progress-bar h-1 bg-surface-200-800">
        <div
          class="h-full bg-primary-500 transition-all duration-300"
          style="width: {store.progress}%"
        ></div>
      </div>
    {/if}

    <!-- Content -->
    <main class="drawer-content flex-1 overflow-y-auto p-6">
      <!-- Error Message -->
      {#if errorMessage}
        <div class="error-banner bg-error-100-900 text-error-700-300 p-4 rounded-container mb-6">
          <p>{errorMessage}</p>
          <button
            type="button"
            class="text-sm underline mt-2"
            onclick={() => { errorMessage = undefined; store.clearError(); }}
          >
            Try again
          </button>
        </div>
      {/if}

      <!-- Step Content -->
      {#if store.step === 'service'}
        <ServicePicker
          {services}
          selectedService={store.service}
          loading={loadingServices}
          onSelect={handleServiceSelect}
        />

      {:else if store.step === 'provider'}
        <ProviderPicker
          {providers}
          selectedProvider={store.provider}
          loading={loadingProviders}
          allowAny={true}
          onSelect={handleProviderSelect}
        />

      {:else if store.step === 'datetime'}
        <DateTimePicker
          {availableDates}
          {availableSlots}
          loading={loadingDates}
          loadingSlots={loadingSlots}
          onDateSelect={handleDateSelect}
          onTimeSelect={handleTimeSelect}
        />

      {:else if store.step === 'details'}
        <ClientForm
          initialData={store.client}
          loading={processingBooking}
          onSubmit={handleClientSubmit}
        />

      {:else if store.step === 'payment'}
        <PaymentSelector
          methods={paymentMethods}
          selectedMethod={store.paymentMethod}
          amount={store.service?.price ?? 0}
          loading={loadingPayment}
          onSelect={handlePaymentSelect}
          onProceed={handlePaymentSelect}
        />

      {:else if store.step === 'confirm'}
        <!-- Review & Confirm -->
        <div class="confirm-step">
          <div class="booking-summary bg-surface-100-900 rounded-container p-4 mb-6">
            <h3 class="font-medium mb-3">Booking Summary</h3>

            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-surface-600-400">Service</span>
                <span>{store.service?.name}</span>
              </div>

              {#if store.provider}
                <div class="flex justify-between">
                  <span class="text-surface-600-400">Provider</span>
                  <span>{store.provider.name}</span>
                </div>
              {/if}

              <div class="flex justify-between">
                <span class="text-surface-600-400">Date & Time</span>
                <span>
                  {store.datetime ? new Date(store.datetime).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }) : ''}
                </span>
              </div>

              <div class="flex justify-between">
                <span class="text-surface-600-400">Client</span>
                <span>{store.client?.firstName} {store.client?.lastName}</span>
              </div>

              <div class="flex justify-between">
                <span class="text-surface-600-400">Payment</span>
                <span>{paymentMethods.find(m => m.id === store.paymentMethod)?.displayName}</span>
              </div>

              <hr class="border-surface-300-700 my-2" />

              <div class="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span class="text-primary-600-400">
                  {formatPrice(store.service?.price ?? 0)}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="btn w-full preset-filled-primary-500 py-3"
            onclick={handleConfirmBooking}
            disabled={processingBooking}
          >
            {#if processingBooking}
              <span class="spinner mr-2"></span>
              Processing...
            {:else}
              Confirm Booking
            {/if}
          </button>

          <p class="text-xs text-surface-600-400 text-center mt-4">
            By confirming, you agree to our cancellation policy.
          </p>
        </div>

      {:else if store.step === 'complete' && store.booking}
        <BookingConfirmation
          booking={store.booking}
          payment={store.paymentResult}
          onNewBooking={handleNewBooking}
          onClose={handleClose}
        />

      {:else if store.step === 'error'}
        <div class="error-step text-center py-8">
          <div class="w-16 h-16 rounded-full bg-error-100-900 flex items-center justify-center mx-auto mb-4">
            <span class="text-2xl">❌</span>
          </div>
          <h3 class="text-lg font-semibold mb-2">Booking Failed</h3>
          <p class="text-surface-600-400 mb-6">{errorMessage || 'An error occurred during booking.'}</p>
          <button
            type="button"
            class="btn preset-filled-primary-500"
            onclick={() => store.clearError()}
          >
            Try Again
          </button>
        </div>
      {/if}
    </main>
  </div>
{/if}

<style>
  .drawer {
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .drawer-backdrop {
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .spinner {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
