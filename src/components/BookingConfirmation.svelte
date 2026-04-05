<script lang="ts">
  /**
   * BookingConfirmation Component
   * Success screen after booking is complete
   */
  import type { Booking, PaymentResult } from '../core/types.js';

  // Props
  let {
    booking,
    payment,
    onNewBooking,
    onClose,
    businessName = 'Massage Ithaca',
    businessAddress = '950 Danby Rd (Route 96B), South Hill Business Campus, Ithaca, NY 14850',
    businessDomain = 'massageithaca.com',
    businessShortAddress = '950 Danby Rd, Ithaca, NY 14850',
    mapsUrl = 'https://maps.app.goo.gl/k7aYDcXFfmECfXtT9',
  }: {
    booking: Booking;
    payment?: PaymentResult;
    onNewBooking?: () => void;
    onClose?: () => void;
    /** Business name for generated content */
    businessName?: string;
    /** Full business address for location display */
    businessAddress?: string;
    /** Business domain for generated ICS UIDs */
    businessDomain?: string;
    /** Short address for calendar entries */
    businessShortAddress?: string;
    /** Google Maps directions URL */
    mapsUrl?: string;
  } = $props();

  // Format date for display
  const formatDate = (datetime: string): string => {
    const date = new Date(datetime);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Format time for display
  const formatTime = (datetime: string): string => {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Format price
  const formatPrice = (cents: number, currency: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  };

  // Generate Google Calendar link
  const getGoogleCalendarLink = (): string => {
    const start = new Date(booking.datetime);
    const end = new Date(booking.endTime);

    const formatForGoogle = (date: Date): string => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: booking.serviceName,
      dates: `${formatForGoogle(start)}/${formatForGoogle(end)}`,
      details: `Appointment at ${businessName}\n\nConfirmation #${booking.confirmationCode}`,
      location: businessShortAddress,
    });

    return `https://calendar.google.com/calendar/render?${params}`;
  };

  // Generate ICS file content
  const getIcsContent = (): string => {
    const start = new Date(booking.datetime);
    const end = new Date(booking.endTime);

    const formatForIcs = (date: Date): string => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//${businessName}//Booking//EN
BEGIN:VEVENT
UID:${booking.id}@${businessDomain}
DTSTAMP:${formatForIcs(new Date())}
DTSTART:${formatForIcs(start)}
DTEND:${formatForIcs(end)}
SUMMARY:${booking.serviceName}
DESCRIPTION:Appointment at ${businessName}\\n\\nConfirmation #${booking.confirmationCode}
LOCATION:${businessShortAddress}
END:VEVENT
END:VCALENDAR`;
  };

  // Download ICS file
  const downloadIcs = () => {
    const content = getIcsContent();
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${businessName.toLowerCase().replace(/\s+/g, '-')}-${booking.confirmationCode}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
</script>

<div class="booking-confirmation text-center">
  <!-- Success Icon -->
  <div class="success-icon mx-auto mb-6">
    <div class="w-20 h-20 rounded-full bg-success-100-900 flex items-center justify-center mx-auto">
      <svg class="w-10 h-10 text-success-600-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  </div>

  <!-- Confirmation Header -->
  <h2 class="text-2xl font-bold text-surface-900-100 mb-2">
    Booking Confirmed!
  </h2>
  <p class="text-surface-600-400 mb-6">
    A confirmation email has been sent to {booking.client.email}
  </p>

  <!-- Confirmation Code -->
  <div class="confirmation-code bg-surface-100-900 rounded-container p-4 mb-6">
    <p class="text-sm text-surface-600-400 mb-1">Confirmation Number</p>
    <p class="text-2xl font-mono font-bold text-primary-600-400">
      #{booking.confirmationCode}
    </p>
  </div>

  <!-- Booking Details -->
  <div class="booking-details text-left bg-surface-50-950 rounded-container p-6 mb-6">
    <h3 class="font-semibold text-lg mb-4 text-surface-900-100">Appointment Details</h3>

    <div class="space-y-3">
      <div class="flex justify-between">
        <span class="text-surface-600-400">Service</span>
        <span class="font-medium text-surface-900-100">{booking.serviceName}</span>
      </div>

      <div class="flex justify-between">
        <span class="text-surface-600-400">Date</span>
        <span class="font-medium text-surface-900-100">{formatDate(booking.datetime)}</span>
      </div>

      <div class="flex justify-between">
        <span class="text-surface-600-400">Time</span>
        <span class="font-medium text-surface-900-100">
          {formatTime(booking.datetime)} - {formatTime(booking.endTime)}
        </span>
      </div>

      {#if booking.providerName}
        <div class="flex justify-between">
          <span class="text-surface-600-400">Provider</span>
          <span class="font-medium text-surface-900-100">{booking.providerName}</span>
        </div>
      {/if}

      <hr class="border-surface-200-800" />

      <div class="flex justify-between">
        <span class="text-surface-600-400">Total</span>
        <span class="font-bold text-lg text-surface-900-100">
          {formatPrice(booking.price, booking.currency)}
        </span>
      </div>

      {#if payment}
        <div class="flex justify-between text-sm">
          <span class="text-surface-600-400">Payment</span>
          <span class="text-success-600-400">
            Paid via {payment.processor}
          </span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Location -->
  <div class="location text-left bg-surface-50-950 rounded-container p-6 mb-6">
    <h3 class="font-semibold text-lg mb-2 text-surface-900-100">Location</h3>
    <p class="text-surface-600-400">
      {businessAddress}
    </p>
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block mt-3 text-primary-600-400 hover:text-primary-700-300"
    >
      Get Directions →
    </a>
  </div>

  <!-- Add to Calendar -->
  <div class="calendar-actions flex flex-col sm:flex-row gap-3 mb-6">
    <a
      href={getGoogleCalendarLink()}
      target="_blank"
      rel="noopener noreferrer"
      class="btn preset-tonal flex-1"
    >
      📅 Add to Google Calendar
    </a>
    <button
      type="button"
      class="btn preset-tonal flex-1"
      onclick={downloadIcs}
    >
      📥 Download .ics
    </button>
  </div>

  <!-- Actions -->
  <div class="actions space-y-3">
    {#if onNewBooking}
      <button
        type="button"
        class="btn w-full preset-filled-primary-500"
        onclick={onNewBooking}
      >
        Book Another Appointment
      </button>
    {/if}

    {#if onClose}
      <button
        type="button"
        class="btn w-full preset-tonal"
        onclick={onClose}
      >
        Close
      </button>
    {/if}
  </div>
</div>

<style>
  .booking-confirmation {
    width: 100%;
    max-width: 32rem;
    margin: 0 auto;
  }

  .success-icon {
    animation: scaleIn 0.3s ease-out;
  }

  @keyframes scaleIn {
    from {
      transform: scale(0);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
</style>
