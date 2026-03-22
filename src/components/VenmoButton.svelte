<script lang="ts">
  /**
   * VenmoButton Component
   * Renders PayPal Venmo button using PayPal JavaScript SDK
   *
   * Requirements:
   * - PayPal SDK script loaded before this component mounts
   * - Valid PayPal Client ID
   */
  import { onMount, onDestroy } from 'svelte';

  // Props
  let {
    clientId,
    amount,
    currency = 'USD',
    description = '',
    onApprove,
    onError,
    onCancel,
    disabled = false,
    debug = false,
  }: {
    /** PayPal Client ID */
    clientId: string;
    /** Amount in cents */
    amount: number;
    /** Currency code (default: USD) */
    currency?: string;
    /** Payment description */
    description?: string;
    /** Called when payment is approved */
    onApprove: (data: VenmoApprovalData) => void | Promise<void>;
    /** Called on error */
    onError?: (error: Error) => void;
    /** Called when user cancels */
    onCancel?: () => void;
    /** Disable the button */
    disabled?: boolean;
    /** Enable debug logging */
    debug?: boolean;
  } = $props();

  // Types
  export interface VenmoApprovalData {
    orderId: string;
    payerId: string;
    payerEmail?: string;
  }

  interface PayPalNamespace {
    Buttons: (config: PayPalButtonConfig) => {
      render: (container: HTMLElement | string) => Promise<void>;
      close: () => void;
    };
  }

  interface PayPalButtonConfig {
    style?: {
      layout?: 'vertical' | 'horizontal';
      color?: 'gold' | 'blue' | 'silver' | 'white' | 'black';
      shape?: 'rect' | 'pill';
      label?: 'paypal' | 'checkout' | 'buynow' | 'pay' | 'installment' | 'subscribe' | 'donate';
      height?: number;
    };
    fundingSource?: string;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string; payerID: string }) => Promise<void>;
    onError?: (error: Error) => void;
    onCancel?: (data: { orderID: string }) => void;
  }

  // State
  let containerRef = $state<HTMLDivElement | null>(null);
  let buttonInstance: { close: () => void; render: (container: HTMLElement) => Promise<void> } | null = null;
  let loading = $state(true);
  let error = $state<string | null>(null);
  let sdkLoaded = $state(false);

  // Format amount for PayPal (dollars with 2 decimals)
  const formatAmount = (cents: number): string => (cents / 100).toFixed(2);

  // Load PayPal SDK
  const loadPayPalSDK = (): Promise<PayPalNamespace> => {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if ((window as unknown as { paypal: PayPalNamespace }).paypal) {
        resolve((window as unknown as { paypal: PayPalNamespace }).paypal);
        return;
      }

      // Check for existing script
      const existingScript = document.querySelector('script[data-paypal-sdk]');
      if (existingScript) {
        // Wait for it to load
        existingScript.addEventListener('load', () => {
          resolve((window as unknown as { paypal: PayPalNamespace }).paypal);
        });
        existingScript.addEventListener('error', () => {
          reject(new Error('PayPal SDK failed to load'));
        });
        return;
      }

      // Create and load script
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&enable-funding=venmo&disable-funding=card,credit,paylater`;
      script.setAttribute('data-paypal-sdk', 'true');
      script.async = true;

      script.onload = () => {
        if (debug) console.log('[VenmoButton] PayPal SDK loaded');
        resolve((window as unknown as { paypal: PayPalNamespace }).paypal);
      };

      script.onerror = () => {
        reject(new Error('Failed to load PayPal SDK'));
      };

      document.head.appendChild(script);
    });
  };

  // Initialize PayPal button
  const initializeButton = async () => {
    if (!containerRef) return;

    try {
      loading = true;
      error = null;

      const paypal = await loadPayPalSDK();
      sdkLoaded = true;

      if (!containerRef) return; // Component might have unmounted

      // Render Venmo button
      buttonInstance = paypal.Buttons({
        fundingSource: 'venmo',
        style: {
          layout: 'vertical',
          color: 'blue',
          shape: 'rect',
          label: 'pay',
          height: 45,
        },
        createOrder: async () => {
          if (debug) console.log('[VenmoButton] Creating order', { amount, currency });

          // Create order via your server endpoint
          // For now, we'll throw an error - the parent should provide server-side order creation
          throw new Error(
            'VenmoButton requires server-side order creation. ' +
            'Integrate with your payment adapter to create orders.'
          );
        },
        onApprove: async (data) => {
          if (debug) console.log('[VenmoButton] Payment approved', data);

          const approvalData: VenmoApprovalData = {
            orderId: data.orderID,
            payerId: data.payerID,
          };

          await onApprove(approvalData);
        },
        onError: (err) => {
          if (debug) console.error('[VenmoButton] Error', err);
          error = err.message || 'Payment error';
          onError?.(err);
        },
        onCancel: (data) => {
          if (debug) console.log('[VenmoButton] Cancelled', data);
          onCancel?.();
        },
      });

      await buttonInstance.render(containerRef);
      loading = false;

      if (debug) console.log('[VenmoButton] Button rendered');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load payment button';
      loading = false;
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  onMount(() => {
    initializeButton();
  });

  onDestroy(() => {
    buttonInstance?.close();
  });
</script>

<div class="venmo-button-container">
  {#if loading}
    <div class="loading-placeholder">
      <div class="skeleton-button"></div>
      <p class="loading-text">Loading Venmo...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-message bg-error-100-900 text-error-700-300 p-3 rounded-container text-sm">
      <p>{error}</p>
      <button
        type="button"
        class="retry-btn text-xs underline mt-1"
        onclick={() => initializeButton()}
      >
        Try again
      </button>
    </div>
  {/if}

  <div
    bind:this={containerRef}
    class="venmo-button"
    class:hidden={loading || error || disabled}
    aria-label="Pay with Venmo"
  ></div>

  {#if disabled}
    <div class="disabled-message text-surface-500 text-sm text-center p-4">
      Please complete the form above to enable payment.
    </div>
  {/if}
</div>

<style>
  .venmo-button-container {
    width: 100%;
    min-height: 45px;
  }

  .loading-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .skeleton-button {
    width: 100%;
    height: 45px;
    background: linear-gradient(
      90deg,
      var(--color-surface-200) 25%,
      var(--color-surface-300) 50%,
      var(--color-surface-200) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  .loading-text {
    font-size: 0.75rem;
    color: var(--color-surface-500);
  }

  .venmo-button {
    width: 100%;
  }

  .hidden {
    display: none;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
