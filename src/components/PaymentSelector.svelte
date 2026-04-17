<script lang="ts">
  /**
   * PaymentSelector Component
   * Select and initiate payment method
   */
  import type { PaymentMethodOption } from '../payments/types.js';

  // Props
  let {
    methods = [],
    selectedMethod = $bindable<string | undefined>(undefined),
    amount,
    currency = 'USD',
    loading = false,
    onSelect,
    onProceed,
  }: {
    methods: PaymentMethodOption[];
    selectedMethod?: string;
    amount: number; // cents
    currency?: string;
    loading?: boolean;
    onSelect?: (methodId: string) => void;
    onProceed?: (methodId: string) => void;
  } = $props();

  // Format price
  const formatPrice = (cents: number, curr: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
    }).format(cents / 100);
  };

  // Payment method icons
  const getIcon = (method: PaymentMethodOption): string => {
    const icons: Record<string, string> = {
      venmo: '💙',
      card: '💳',
      stripe: '💳',
      cash: '💵',
      zelle: '⚡',
      check: '📝',
      crypto: '🪙',
    };
    return icons[method.icon ?? method.id] ?? '💳';
  };

  // Handle selection
  const handleSelect = (methodId: string) => {
    selectedMethod = methodId;
    onSelect?.(methodId);
  };

  // Handle proceed
  const handleProceed = () => {
    if (selectedMethod) {
      onProceed?.(selectedMethod);
    }
  };
</script>

<div class="payment-selector">
  <div class="amount-display text-center mb-6">
    <p class="text-sm text-surface-600-400">Amount Due</p>
    <p class="text-3xl font-bold text-primary-600-400">
      {formatPrice(amount, currency)}
    </p>
  </div>

  <h4 class="text-md font-medium mb-4">Select Payment Method</h4>

  {#if loading}
    <div class="loading space-y-3">
      {#each Array(3) as _}
        <div class="skeleton-method h-16 rounded-container"></div>
      {/each}
    </div>
  {:else if methods.length === 0}
    <p class="text-surface-600-400 text-center py-4">No payment methods available.</p>
  {:else}
    <div class="methods space-y-3">
      {#each methods as method (method.id)}
        <button
          type="button"
          class="method-card w-full p-4 rounded-container text-left transition-all flex items-center gap-4
                 {selectedMethod === method.id
                   ? 'ring-2 ring-primary-500 bg-primary-50-950'
                   : method.available
                     ? 'bg-surface-100-900 hover:bg-surface-200-800'
                     : 'bg-surface-100-900 opacity-50 cursor-not-allowed'}"
          disabled={!method.available}
          onclick={() => handleSelect(method.id)}
          aria-pressed={selectedMethod === method.id}
        >
          <span class="text-2xl">{getIcon(method)}</span>

          <div class="flex-1">
            <p class="font-medium text-surface-900-100">{method.displayName}</p>
            {#if method.description}
              <p class="text-sm text-surface-600-400">{method.description}</p>
            {/if}
          </div>

          {#if method.processingFee || method.processingFeePercent}
            <div class="text-sm text-surface-600-400">
              {#if method.processingFee}
                +{formatPrice(method.processingFee, currency)}
              {:else if method.processingFeePercent}
                +{method.processingFeePercent}%
              {/if}
            </div>
          {/if}

          {#if selectedMethod === method.id}
            <span class="text-primary-600-400">✓</span>
          {/if}
        </button>
      {/each}
    </div>

    {#if selectedMethod}
      <div class="proceed-section mt-6">
        <button
          type="button"
          class="btn w-full preset-filled-primary-500 py-3"
          onclick={handleProceed}
        >
          Continue with {methods.find(m => m.id === selectedMethod)?.displayName}
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .payment-selector {
    width: 100%;
  }

  .skeleton-method {
    background: light-dark(
      linear-gradient(90deg, var(--color-surface-200) 25%, var(--color-surface-300) 50%, var(--color-surface-200) 75%),
      linear-gradient(90deg, var(--color-surface-800) 25%, var(--color-surface-700) 50%, var(--color-surface-800) 75%)
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
