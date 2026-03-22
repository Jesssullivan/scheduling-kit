<script lang="ts">
  /**
   * StripeCheckout Component
   * Stripe Elements payment flow with server-side PaymentIntent management
   *
   * Flow:
   * 1. Load Stripe.js SDK dynamically
   * 2. Mount Payment Element (card, Apple Pay, Google Pay)
   * 3. On submit → stripe.confirmPayment({ clientSecret })
   * 4. On success → call onSuccess with PaymentResult
   *
   * Parent must create the PaymentIntent server-side BEFORE rendering
   * this component (to get the clientSecret).
   */
  import { onDestroy } from 'svelte';
  import type { PaymentResult } from '../core/types.js';

  // Stripe SDK types (minimal)
  interface StripeInstance {
    elements: (opts: { clientSecret: string; appearance?: StripeAppearance }) => StripeElements;
    confirmPayment: (opts: {
      elements: StripeElements;
      confirmParams?: { return_url?: string };
      redirect?: 'if_required';
    }) => Promise<{ error?: StripeError; paymentIntent?: StripePaymentIntent }>;
  }

  interface StripeElements {
    create: (type: 'payment', opts?: Record<string, unknown>) => StripeElement;
    submit: () => Promise<{ error?: StripeError }>;
  }

  interface StripeElement {
    mount: (container: HTMLElement | string) => void;
    destroy: () => void;
    on: (event: string, handler: (e: unknown) => void) => void;
  }

  interface StripeError {
    type: string;
    code?: string;
    message: string;
  }

  interface StripePaymentIntent {
    id: string;
    status: string;
    amount: number;
    currency: string;
  }

  interface StripeAppearance {
    theme?: 'stripe' | 'night' | 'flat';
    variables?: Record<string, string>;
  }

  // Props
  let {
    publishableKey,
    clientSecret,
    amount,
    currency = 'USD',
    connectedAccountId,
    onSuccess,
    onError,
    onCancel,
    disabled = false,
  }: {
    /** Stripe publishable key (pk_test_... or pk_live_...) */
    publishableKey: string;
    /** Client secret from server-side PaymentIntent */
    clientSecret: string;
    /** Amount in cents (for display only; actual amount is in the PaymentIntent) */
    amount: number;
    /** Currency code (default: USD) */
    currency?: string;
    /** Stripe Connect: route payments to this connected account */
    connectedAccountId?: string;
    /** Called on successful payment */
    onSuccess: (result: PaymentResult) => void;
    /** Called on error */
    onError?: (error: Error) => void;
    /** Called when user cancels */
    onCancel?: () => void;
    /** Disable the form */
    disabled?: boolean;
  } = $props();

  // State
  let containerRef = $state<HTMLDivElement | null>(null);
  let stripe = $state<StripeInstance | null>(null);
  let elements = $state<StripeElements | null>(null);
  let paymentElement = $state<StripeElement | null>(null);
  let loading = $state(true);
  let processing = $state(false);
  let error = $state<string | null>(null);
  let elementReady = $state(false);

  // Load Stripe.js
  type StripeFactory = (key: string, opts?: { stripeAccount?: string }) => StripeInstance;

  const loadStripeJs = (): Promise<StripeFactory> => {
    return new Promise((resolve, reject) => {
      const existingStripe = (window as unknown as { Stripe?: StripeFactory }).Stripe;
      if (existingStripe) {
        resolve(existingStripe);
        return;
      }

      const existingScript = document.querySelector('script[src="https://js.stripe.com/v3/"]');
      if (existingScript) {
        const checkLoaded = setInterval(() => {
          const s = (window as unknown as { Stripe?: StripeFactory }).Stripe;
          if (s) {
            clearInterval(checkLoaded);
            resolve(s);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkLoaded);
          reject(new Error('Stripe.js load timeout'));
        }, 10000);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;

      script.onload = () => {
        const s = (window as unknown as { Stripe?: StripeFactory }).Stripe;
        if (s) {
          resolve(s);
        } else {
          reject(new Error('Stripe.js loaded but not available'));
        }
      };

      script.onerror = () => reject(new Error('Failed to load Stripe.js'));
      document.head.appendChild(script);
    });
  };

  // Initialize Stripe Elements
  const initializeElements = async () => {
    if (!containerRef || disabled || stripe) return;

    try {
      loading = true;
      error = null;

      const StripeFactory = await loadStripeJs();
      const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
      const stripeInstance = opts ? StripeFactory(publishableKey, opts) : StripeFactory(publishableKey);
      stripe = stripeInstance;

      const elementsInstance = stripeInstance.elements({
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#6366f1',
            borderRadius: '8px',
          },
        },
      });
      elements = elementsInstance;

      const pe = elementsInstance.create('payment', {
        layout: 'tabs',
      });

      pe.on('ready', () => {
        elementReady = true;
        loading = false;
      });

      pe.on('change', () => {
        error = null;
      });

      if (containerRef) {
        pe.mount(containerRef);
        paymentElement = pe;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load payment form';
      loading = false;
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  $effect(() => {
    if (!disabled && containerRef && !stripe) {
      initializeElements();
    }
  });

  onDestroy(() => {
    paymentElement?.destroy();
  });

  // Handle form submission
  const handleSubmit = async () => {
    if (!stripe || !elements || processing || disabled) return;

    processing = true;
    error = null;

    try {
      // Validate the form first
      const { error: submitError } = await elements.submit();
      if (submitError) {
        error = submitError.message;
        processing = false;
        return;
      }

      // Confirm the payment
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (confirmError) {
        error = confirmError.message;
        onError?.(new Error(confirmError.message));
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess({
          success: true,
          transactionId: paymentIntent.id,
          processor: 'stripe',
          amount: paymentIntent.amount,
          currency: paymentIntent.currency.toUpperCase(),
          timestamp: new Date().toISOString(),
        });
      } else {
        error = 'Payment was not completed. Please try again.';
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      error = err.message;
      onError?.(err);
    }

    processing = false;
  };

  const formatPrice = (cents: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
</script>

<div class="stripe-checkout">
  <!-- Amount Display -->
  <div class="amount-display mb-4 text-center">
    <p class="text-sm text-surface-500">Amount due</p>
    <p class="text-2xl font-bold text-primary-600-400">{formatPrice(amount)}</p>
  </div>

  <!-- Loading State -->
  {#if loading && !disabled}
    <div class="loading-state">
      <div class="skeleton-element"></div>
      <p class="loading-text">Loading payment form...</p>
    </div>
  {/if}

  <!-- Error State -->
  {#if error && !processing}
    <div class="error-state bg-error-100-900 text-error-700-300 p-4 rounded-container mb-4">
      <p class="font-medium">Payment Error</p>
      <p class="text-sm mt-1">{error}</p>
    </div>
  {/if}

  <!-- Stripe Payment Element Container -->
  <div
    bind:this={containerRef}
    class="stripe-element-container"
    class:hidden={loading || disabled}
  ></div>

  <!-- Submit Button -->
  {#if elementReady && !loading}
    <button
      type="button"
      class="btn w-full preset-filled-primary-500 mt-4"
      disabled={processing || disabled}
      onclick={handleSubmit}
    >
      {#if processing}
        <span class="spinner-inline"></span>
        Processing...
      {:else}
        Pay {formatPrice(amount)}
      {/if}
    </button>
  {/if}

  <!-- Cancel Link -->
  {#if onCancel && !processing}
    <button
      type="button"
      class="btn btn-sm preset-tonal mt-3 w-full"
      onclick={() => onCancel?.()}
    >
      Choose a different payment method
    </button>
  {/if}

  <!-- Disabled State -->
  {#if disabled}
    <div class="disabled-state text-center py-6">
      <div class="disabled-element bg-surface-200-800 rounded p-4 opacity-50">
        <p class="text-surface-500">Card Payment</p>
      </div>
      <p class="text-xs text-surface-400-600 mt-2">Complete the form to enable payment</p>
    </div>
  {/if}

  <!-- Security Note -->
  <p class="security-note text-xs text-surface-400-600 text-center mt-4">
    Secure payment powered by Stripe
  </p>
</div>

<style>
  .stripe-checkout {
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 0;
  }

  .skeleton-element {
    width: 100%;
    height: 160px;
    background: linear-gradient(
      90deg,
      var(--color-surface-200) 25%,
      var(--color-surface-300) 50%,
      var(--color-surface-200) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 8px;
  }

  .loading-text {
    font-size: 0.75rem;
    color: var(--color-surface-500);
  }

  .stripe-element-container {
    width: 100%;
    min-height: 100px;
  }

  .hidden {
    display: none;
  }

  .spinner-inline {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    margin-right: 0.5rem;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
