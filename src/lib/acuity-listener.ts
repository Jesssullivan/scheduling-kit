/**
 * Acuity Conversion Tracking Listener
 * Receives booking confirmations via postMessage from Acuity's Custom Conversion Tracking
 *
 * Setup required in Acuity:
 * 1. Go to Acuity Admin > Integrations > Custom conversion tracking
 * 2. Add the postMessage script (see docs/embed-shim.md)
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Booking data received from Acuity conversion tracking
 */
export interface AcuityBookingData {
  event: 'acuityBookingComplete';
  /** Appointment ID */
  appointmentId: string;
  /** Appointment type name */
  appointmentType: string;
  /** Appointment type ID */
  appointmentTypeId: string;
  /** Calendar/provider name */
  calendar: string;
  /** Client email */
  email: string;
  /** Client first name */
  firstName: string;
  /** Client last name */
  lastName: string;
  /** Client phone */
  phone: string;
  /** Appointment date (formatted) */
  date: string;
  /** Appointment time */
  time: string;
  /** Time with timezone */
  timetz: string;
  /** Duration in minutes */
  duration: string;
  /** Location */
  location: string;
  /** Price paid */
  price: string;
  /** Timestamp of event */
  timestamp: string;
  /** Source identifier */
  source: string;
}

/**
 * Listener configuration options
 */
export interface ListenerOptions {
  /** Callback when booking is completed */
  onBookingComplete: (data: AcuityBookingData) => void | Promise<void>;
  /** Callback for any Acuity message (including sizing, load, etc.) */
  onAnyMessage?: (data: unknown, origin: string) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
  /** Additional allowed origins (beyond Acuity defaults) */
  allowedOrigins?: string[];
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid Acuity domains for origin validation
 */
const ACUITY_ORIGINS = [
  'acuityscheduling.com',
  'squarespacescheduling.com',
  '.as.me',
  'acuityinnovation.com', // Conversion tracking domain
  'sandbox.acuityinnovation.com',
];

// =============================================================================
// LISTENER IMPLEMENTATION
// =============================================================================

/**
 * Validate that the message origin is from Acuity
 */
const isValidOrigin = (origin: string, extraOrigins: string[] = []): boolean => {
  const allOrigins = [...ACUITY_ORIGINS, ...extraOrigins];
  return allOrigins.some((domain) => origin.includes(domain));
};

/**
 * Check if data is a booking complete event
 */
const isBookingCompleteEvent = (data: unknown): data is AcuityBookingData => {
  if (typeof data !== 'object' || data === null) return false;
  return (data as AcuityBookingData).event === 'acuityBookingComplete';
};

/**
 * Parse message data (handles both string and object formats)
 */
const parseMessageData = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
};

/**
 * Initialize the Acuity booking listener
 *
 * @returns Cleanup function to remove the listener
 *
 * @example
 * ```typescript
 * // In your Svelte component or layout
 * import { onMount, onDestroy } from 'svelte';
 * import { initAcuityListener } from '@tummycrypt/scheduling-kit';
 *
 * let cleanup: (() => void) | undefined;
 *
 * onMount(() => {
 *   cleanup = initAcuityListener({
 *     onBookingComplete: async (data) => {
 *       console.log('Booking completed:', data);
 *       await fetch('/api/bookings/track', {
 *         method: 'POST',
 *         body: JSON.stringify(data)
 *       });
 *     },
 *     debug: true
 *   });
 * });
 *
 * onDestroy(() => cleanup?.());
 * ```
 */
export const initAcuityListener = (options: ListenerOptions): (() => void) => {
  const { onBookingComplete, onAnyMessage, onError, allowedOrigins = [], debug = false } = options;

  const log = (...args: unknown[]) => {
    if (debug) {
      console.log('[AcuityListener]', ...args);
    }
  };

  const handler = async (event: MessageEvent) => {
    // Validate origin
    if (!isValidOrigin(event.origin, allowedOrigins)) {
      log('Ignoring message from unknown origin:', event.origin);
      return;
    }

    log('Received message from:', event.origin);

    // Parse message data
    const data = parseMessageData(event.data);

    // Call generic handler if provided
    if (onAnyMessage) {
      onAnyMessage(data, event.origin);
    }

    // Check for booking complete event
    if (isBookingCompleteEvent(data)) {
      log('Booking complete event:', data);

      try {
        await onBookingComplete(data);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log('Error in onBookingComplete:', err);
        if (onError) {
          onError(err);
        }
      }
    } else {
      log('Non-booking message:', data);
    }
  };

  // Add listener
  window.addEventListener('message', handler);
  log('Listener initialized');

  // Return cleanup function
  return () => {
    window.removeEventListener('message', handler);
    log('Listener removed');
  };
};

// =============================================================================
// CONVERSION TRACKING SCRIPT GENERATOR
// =============================================================================

/**
 * Generate the JavaScript code to add to Acuity Custom Conversion Tracking
 *
 * This code runs inside the Acuity iframe on the confirmation page
 * and sends booking data back to your parent window via postMessage
 */
export const generateConversionTrackingScript = (): string => `
<script>
(function() {
  try {
    var bookingData = {
      event: 'acuityBookingComplete',
      appointmentId: '%id%',
      appointmentType: '%appointmentType%',
      appointmentTypeId: '%type%',
      calendar: '%calendar%',
      email: '%email%',
      firstName: '%first%',
      lastName: '%last%',
      phone: '%phone%',
      date: '%date%',
      time: '%time%',
      timetz: '%timetz%',
      duration: '%duration%',
      location: '%location%',
      price: '%price%',
      timestamp: new Date().toISOString(),
      source: 'acuity-conversion-tracking'
    };

    // Send to parent window (handles both single and double iframe nesting)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.stringify(bookingData), '*');
    }
    if (window.parent.parent && window.parent.parent !== window.parent) {
      window.parent.parent.postMessage(JSON.stringify(bookingData), '*');
    }

    console.log('[Acuity Conversion] Booking data sent:', bookingData.appointmentId);
  } catch (e) {
    console.error('[Acuity Conversion] Error:', e);
  }
})();
</script>
`.trim();

// =============================================================================
// SIZING EVENT HANDLER
// =============================================================================

/**
 * Handle Acuity sizing events (for iframe height adjustment)
 *
 * @example
 * ```typescript
 * const cleanup = initSizingListener((height, behavior) => {
 *   const iframe = document.querySelector('iframe[src*="acuity"]');
 *   if (iframe) {
 *     iframe.style.height = `${height}px`;
 *   }
 * });
 * ```
 */
export const initSizingListener = (
  onResize: (height: number, behavior: string) => void
): (() => void) => {
  const handler = (event: MessageEvent) => {
    if (!isValidOrigin(event.origin)) return;

    if (typeof event.data === 'string' && event.data.startsWith('sizing:')) {
      const parts = event.data.split(':');
      const height = parseInt(parts[1], 10);
      const behavior = parts[2] || 'auto';

      if (!isNaN(height)) {
        onResize(height, behavior);
      }
    }
  };

  window.addEventListener('message', handler);

  return () => window.removeEventListener('message', handler);
};

// =============================================================================
// COMBINED LISTENER
// =============================================================================

/**
 * Initialize both booking and sizing listeners
 */
export const initFullAcuityListener = (options: {
  onBookingComplete: (data: AcuityBookingData) => void | Promise<void>;
  onResize?: (height: number, behavior: string) => void;
  onError?: (error: Error) => void;
  debug?: boolean;
}): (() => void) => {
  const cleanupBooking = initAcuityListener({
    onBookingComplete: options.onBookingComplete,
    onError: options.onError,
    debug: options.debug,
  });

  let cleanupSizing: (() => void) | undefined;
  if (options.onResize) {
    cleanupSizing = initSizingListener(options.onResize);
  }

  return () => {
    cleanupBooking();
    cleanupSizing?.();
  };
};
