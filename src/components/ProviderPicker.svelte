<script lang="ts">
  /**
   * ProviderPicker Component
   * Select a provider/staff member or "Any Available"
   */
  import type { Provider } from '../core/types.js';

  // Props
  let {
    providers = [],
    selectedProvider = $bindable<Provider | undefined>(undefined),
    allowAny = true,
    loading = false,
    onSelect,
  }: {
    providers: Provider[];
    selectedProvider?: Provider;
    allowAny?: boolean;
    loading?: boolean;
    onSelect?: (provider: Provider | undefined) => void;
  } = $props();

  // Track if "Any" is selected
  let anySelected = $state(false);

  // Handle provider selection
  const handleSelect = (provider: Provider | undefined) => {
    if (provider === undefined) {
      anySelected = true;
      selectedProvider = undefined;
    } else {
      anySelected = false;
      selectedProvider = provider;
    }
    onSelect?.(provider);
  };

  // Get initials for avatar fallback
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };
</script>

<div class="provider-picker">
  {#if loading}
    <div class="loading space-y-3">
      {#each Array(3) as _}
        <div class="skeleton-provider flex items-center gap-4 p-4 rounded-container">
          <div class="skeleton-avatar w-12 h-12 rounded-full"></div>
          <div class="flex-1 space-y-2">
            <div class="skeleton-text h-4 w-32 rounded"></div>
            <div class="skeleton-text h-3 w-48 rounded"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="providers space-y-3">
      <!-- Any Available Option -->
      {#if allowAny}
        <button
          type="button"
          class="provider-card w-full p-4 rounded-container text-left transition-all flex items-center gap-4
                 {anySelected && !selectedProvider
                   ? 'ring-2 ring-primary-500 bg-primary-50-950'
                   : 'bg-surface-100-900 hover:bg-surface-200-800'}"
          onclick={() => handleSelect(undefined)}
          aria-pressed={anySelected && !selectedProvider}
        >
          <div class="avatar w-12 h-12 rounded-full bg-surface-300-700 flex items-center justify-center">
            <span class="text-lg">✨</span>
          </div>

          <div class="flex-1">
            <p class="font-medium text-surface-900-100">Any Available</p>
            <p class="text-sm text-surface-600-400">
              Book with the first available provider
            </p>
          </div>

          {#if anySelected && !selectedProvider}
            <span class="text-primary-600-400">✓</span>
          {/if}
        </button>
      {/if}

      <!-- Provider List -->
      {#each providers as provider (provider.id)}
        <button
          type="button"
          class="provider-card w-full p-4 rounded-container text-left transition-all flex items-center gap-4
                 {selectedProvider?.id === provider.id
                   ? 'ring-2 ring-primary-500 bg-primary-50-950'
                   : 'bg-surface-100-900 hover:bg-surface-200-800'}"
          onclick={() => handleSelect(provider)}
          aria-pressed={selectedProvider?.id === provider.id}
        >
          <div class="avatar w-12 h-12 rounded-full bg-surface-300-700 flex items-center justify-center overflow-hidden">
            {#if provider.image}
              <img
                src={provider.image}
                alt={provider.name}
                class="w-full h-full object-cover"
              />
            {:else}
              <span class="text-sm font-medium text-surface-600-400">
                {getInitials(provider.name)}
              </span>
            {/if}
          </div>

          <div class="flex-1">
            <p class="font-medium text-surface-900-100">{provider.name}</p>
            {#if provider.description}
              <p class="text-sm text-surface-600-400 line-clamp-2">
                {provider.description}
              </p>
            {/if}
          </div>

          {#if selectedProvider?.id === provider.id}
            <span class="text-primary-600-400">✓</span>
          {/if}
        </button>
      {/each}

      {#if providers.length === 0 && !allowAny}
        <p class="text-surface-600-400 text-center py-4">No providers available.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .provider-picker {
    width: 100%;
  }

  .skeleton-provider,
  .skeleton-avatar,
  .skeleton-text {
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

  .line-clamp-2 {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
