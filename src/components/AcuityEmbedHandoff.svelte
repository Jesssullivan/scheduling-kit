<script lang="ts">
  /**
   * AcuityEmbedHandoff Component
   * Shows a pre-filled Acuity embed for completing booking with card payment
   * Listens for postMessage to capture booking confirmation
   */
  import { onMount, onDestroy } from 'svelte';
  import { buildAcuityUrl, type ClientInfo, type BookingParams } from '../lib/url-builder.js';
  import {
    initFullAcuityListener,
    type AcuityBookingData,
  } from '../lib/acuity-listener.js';

  // Props
  let {
    baseUrl,
    client,
    booking,
    height = 600,
    onBookingComplete,
    onError,
    onHeightChange,
    debug = false,
    supportPhone = '+16072014926',
    supportEmail = 'jen@massageithaca.com',
  }: {
    /** Acuity base URL (e.g., https://MassageIthaca.as.me) */
    baseUrl: string;
    /** Client pre-fill information */
    client?: ClientInfo;
    /** Booking parameters */
    booking?: BookingParams;
    /** Iframe height in pixels */
    height?: number;
    /** Callback when booking is completed via postMessage */
    onBookingComplete?: (data: AcuityBookingData) => void;
    /** Callback for errors */
    onError?: (error: Error) => void;
    /** Callback when iframe height changes */
    onHeightChange?: (newHeight: number) => void;
    /** Enable debug logging */
    debug?: boolean;
    /** Support phone for help text */
    supportPhone?: string;
    /** Support email for help text */
    supportEmail?: string;
  } = $props();

  // State - dynamicHeight tracks both initial prop and postMessage updates
  let dynamicHeight = $state(600);
  let isLoading = $state(true);
  let iframeRef = $state<HTMLIFrameElement | null>(null);

  // Sync with prop changes
  $effect(() => {
    dynamicHeight = height;
  });

  // Build the pre-filled URL
  const embedUrl = $derived(
    buildAcuityUrl({
      baseUrl,
      client,
      booking,
    })
  );

  // Listener cleanup
  let cleanup: (() => void) | undefined;

  onMount(() => {
    // Initialize listeners
    cleanup = initFullAcuityListener({
      onBookingComplete: (data) => {
        if (debug) console.log('[AcuityEmbed] Booking complete:', data);
        onBookingComplete?.(data);
      },
      onResize: (newHeight, behavior) => {
        if (debug) console.log('[AcuityEmbed] Height change:', newHeight, behavior);
        dynamicHeight = newHeight;
        onHeightChange?.(newHeight);
      },
      onError,
      debug,
    });
  });

  onDestroy(() => {
    cleanup?.();
  });

  // Handle iframe load
  const handleLoad = () => {
    isLoading = false;
    if (debug) console.log('[AcuityEmbed] Iframe loaded');
  };

  // Handle iframe error
  const handleError = () => {
    isLoading = false;
    onError?.(new Error('Failed to load Acuity embed'));
  };
</script>

<div class="acuity-embed-handoff">
  <!-- Loading indicator -->
  {#if isLoading}
    <div class="loading-overlay absolute inset-0 flex items-center justify-center bg-surface-50-950/80 z-10">
      <div class="loading-spinner">
        <span class="spinner"></span>
        <p class="mt-2 text-sm text-surface-600-400">Loading booking form...</p>
      </div>
    </div>
  {/if}

  <!-- Pre-filled message -->
  <div class="prefill-notice bg-success-100-900 text-success-700-300 p-3 rounded-container mb-4 text-sm">
    <p class="font-medium">Your information has been pre-filled</p>
    <p class="text-success-600-400 mt-1">Complete your booking below to pay with card.</p>
  </div>

  <!-- Acuity iframe -->
  <div class="iframe-container relative" style="min-height: {dynamicHeight}px">
    <iframe
      bind:this={iframeRef}
      src={embedUrl}
      title="Complete Booking with Acuity"
      width="100%"
      height={dynamicHeight}
      frameborder="0"
      scrolling="auto"
      onload={handleLoad}
      onerror={handleError}
      class="acuity-iframe"
    ></iframe>
  </div>

  <!-- Help text -->
  <p class="help-text text-xs text-surface-600-400 text-center mt-4">
    Having trouble? <a href="tel:{supportPhone}" class="text-primary-600-400 underline">Call us</a> or
    <a href="mailto:{supportEmail}" class="text-primary-600-400 underline">send an email</a>.
  </p>
</div>

<style>
  .acuity-embed-handoff {
    position: relative;
    width: 100%;
  }

  .iframe-container {
    transition: min-height 0.3s ease;
  }

  .acuity-iframe {
    display: block;
    border: none;
    width: 100%;
  }

  .spinner {
    display: inline-block;
    width: 2rem;
    height: 2rem;
    border: 3px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-overlay {
    border-radius: var(--rounded-container);
  }
</style>
