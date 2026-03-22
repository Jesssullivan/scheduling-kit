<script lang="ts">
  /**
   * ServicePicker Component
   * Displays available services/appointment types for selection
   */
  import type { Service } from '../core/types.js';

  // Props
  let {
    services,
    selectedService = $bindable<Service | undefined>(undefined),
    loading = false,
    error = undefined as string | undefined,
    groupByCategory = true,
    onSelect,
  }: {
    services: Service[];
    selectedService?: Service;
    loading?: boolean;
    error?: string;
    groupByCategory?: boolean;
    onSelect?: (service: Service) => void;
  } = $props();

  // Group services by category
  const groupedServices = $derived.by(() => {
    if (!groupByCategory) {
      return { 'All Services': services };
    }

    return services.reduce((acc, service) => {
      const category = service.category || 'General';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(service);
      return acc;
    }, {} as Record<string, Service[]>);
  });

  // Format price for display
  const formatPrice = (cents: number, currency: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  };

  // Format duration for display
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Handle selection
  const handleSelect = (service: Service) => {
    selectedService = service;
    onSelect?.(service);
  };
</script>

<div class="service-picker">
  {#if loading}
    <div class="loading">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  {:else if error}
    <div class="error preset-filled-error-500 p-4 rounded-container">
      <p>{error}</p>
    </div>
  {:else if services.length === 0}
    <div class="empty text-surface-500 text-center py-8">
      <p>No services available</p>
    </div>
  {:else}
    {#each Object.entries(groupedServices) as [category, categoryServices]}
      <div class="category mb-6">
        {#if groupByCategory && Object.keys(groupedServices).length > 1}
          <h3 class="text-lg font-semibold mb-3 text-surface-700-300">{category}</h3>
        {/if}

        <div class="services-grid grid gap-3">
          {#each categoryServices as service (service.id)}
            <button
              type="button"
              class="service-card p-4 rounded-container text-left transition-all
                     {selectedService?.id === service.id
                       ? 'ring-2 ring-primary-500 bg-primary-50-950'
                       : 'bg-surface-100-900 hover:bg-surface-200-800'}"
              onclick={() => handleSelect(service)}
              aria-pressed={selectedService?.id === service.id}
            >
              <div class="flex justify-between items-start gap-3">
                <div class="flex-1">
                  <h4 class="font-medium text-surface-900-100">{service.name}</h4>
                  {#if service.description}
                    <p class="text-sm text-surface-600-400 mt-1 line-clamp-2">
                      {service.description}
                    </p>
                  {/if}
                </div>

                <div class="text-right shrink-0">
                  <div class="font-semibold text-primary-600-400">
                    {formatPrice(service.price, service.currency)}
                  </div>
                  <div class="text-sm text-surface-500">
                    {formatDuration(service.duration)}
                  </div>
                </div>
              </div>

              {#if service.color}
                <div
                  class="w-full h-1 rounded-full mt-3"
                  style="background-color: {service.color}"
                ></div>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .service-picker {
    width: 100%;
  }

  .skeleton-card {
    height: 100px;
    background: linear-gradient(90deg, var(--color-surface-200) 25%, var(--color-surface-300) 50%, var(--color-surface-200) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-container);
    margin-bottom: 0.75rem;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .services-grid {
    grid-template-columns: 1fr;
  }

  @media (min-width: 640px) {
    .services-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
