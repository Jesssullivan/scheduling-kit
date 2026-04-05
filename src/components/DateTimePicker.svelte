<script lang="ts">
  /**
   * DateTimePicker Component
   * Calendar view with date selection and time slot grid
   */
  import type { AvailableDate, TimeSlot } from '../core/types.js';

  // Props
  let {
    availableDates = [],
    availableSlots = [],
    selectedDate = $bindable<string | undefined>(undefined),
    selectedTime = $bindable<string | undefined>(undefined),
    loading = false,
    loadingSlots = false,
    timezone = 'America/New_York',
    onDateSelect,
    onTimeSelect,
    onMonthChange,
  }: {
    availableDates: AvailableDate[];
    availableSlots: TimeSlot[];
    selectedDate?: string;
    selectedTime?: string;
    loading?: boolean;
    loadingSlots?: boolean;
    timezone?: string;
    onDateSelect?: (date: string) => void;
    onTimeSelect?: (datetime: string) => void;
    onMonthChange?: (startDate: string, endDate: string) => void;
  } = $props();

  // Calendar state
  let currentMonth = $state(new Date());

  // Available dates as Set for quick lookup
  const availableDateSet = $derived(new Set(availableDates.map(d => d.date)));

  // Calendar grid computation
  const calendarDays = $derived.by(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days: (Date | null)[] = [];

    // Add empty slots for days before first of month
    const startPadding = firstDay.getDay();
    for (let i = 0; i < startPadding; i++) {
      days.push(null);
    }

    // Add all days of the month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }

    return days;
  });

  // Format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Format time for display
  const formatTime = (datetime: string): string => {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  };

  // Check if date is available
  const isDateAvailable = (date: Date): boolean => {
    return availableDateSet.has(formatDate(date));
  };

  // Check if date is in the past
  const isDatePast = (date: Date): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Emit month range when month changes
  const emitMonthRange = (month: Date) => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    onMonthChange?.(formatDate(start), formatDate(end));
  };

  // Navigate months
  const prevMonth = () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    emitMonthRange(currentMonth);
  };

  const nextMonth = () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    emitMonthRange(currentMonth);
  };

  // Handle date selection
  const handleDateSelect = (date: Date) => {
    if (isDateAvailable(date) && !isDatePast(date)) {
      selectedDate = formatDate(date);
      selectedTime = undefined;
      onDateSelect?.(selectedDate);
    }
  };

  // Handle time selection
  const handleTimeSelect = (slot: TimeSlot) => {
    if (slot.available) {
      selectedTime = slot.datetime;
      onTimeSelect?.(slot.datetime);
    }
  };

  // Weekday headers
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>

<div class="datetime-picker">
  <!-- Calendar Section -->
  <div class="calendar-section mb-6">
    <div class="calendar-header flex items-center justify-between mb-4">
      <button
        type="button"
        class="btn btn-sm preset-tonal"
        onclick={prevMonth}
        aria-label="Previous month"
      >
        ←
      </button>

      <h3 class="text-lg font-semibold">
        {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </h3>

      <button
        type="button"
        class="btn btn-sm preset-tonal"
        onclick={nextMonth}
        aria-label="Next month"
      >
        →
      </button>
    </div>

    {#if loading}
      <div class="calendar-loading h-64 flex items-center justify-center">
        <div class="spinner"></div>
      </div>
    {:else}
      <div class="calendar-grid">
        <!-- Weekday headers -->
        <div class="weekday-headers grid grid-cols-7 gap-1 mb-2">
          {#each weekdays as day}
            <div class="text-center text-sm font-medium text-surface-600-400">{day}</div>
          {/each}
        </div>

        <!-- Calendar days -->
        <div class="days grid grid-cols-7 gap-1">
          {#each calendarDays as day}
            {#if day === null}
              <div class="day-cell"></div>
            {:else}
              {@const dateStr = formatDate(day)}
              {@const available = isDateAvailable(day)}
              {@const past = isDatePast(day)}
              {@const selected = selectedDate === dateStr}

              <button
                type="button"
                class="day-cell aspect-square flex items-center justify-center rounded-full text-sm transition-all
                       {selected ? 'bg-primary-500 text-white' : ''}
                       {available && !past && !selected ? 'bg-primary-100-900 text-primary-700-300 hover:bg-primary-200-800' : ''}
                       {!available || past ? 'text-surface-400-600 cursor-not-allowed' : ''}"
                disabled={!available || past}
                onclick={() => handleDateSelect(day)}
                aria-pressed={selected}
                aria-label="{day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}{available ? ', available' : ', unavailable'}"
              >
                {day.getDate()}
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Time Slots Section -->
  {#if selectedDate}
    <div class="slots-section">
      <h4 class="text-md font-medium mb-3">
        Available times for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </h4>

      {#if loadingSlots}
        <div class="slots-loading flex gap-2 flex-wrap">
          {#each Array(6) as _}
            <div class="skeleton-slot w-24 h-10 rounded"></div>
          {/each}
        </div>
      {:else if availableSlots.length === 0}
        <p class="text-surface-600-400">No available times for this date.</p>
      {:else}
        <div class="slots-grid flex flex-wrap gap-2">
          {#each availableSlots as slot (slot.datetime)}
            <button
              type="button"
              class="slot-button px-4 py-2 rounded-container text-sm font-medium transition-all
                     {selectedTime === slot.datetime
                       ? 'bg-primary-500 text-white'
                       : slot.available
                         ? 'bg-surface-200-800 hover:bg-surface-300-700'
                         : 'bg-surface-100-900 text-surface-400-600 cursor-not-allowed'}"
              disabled={!slot.available}
              onclick={() => handleTimeSelect(slot)}
              aria-pressed={selectedTime === slot.datetime}
            >
              {formatTime(slot.datetime)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .datetime-picker {
    width: 100%;
  }

  .day-cell {
    min-width: 2.5rem;
    min-height: 2.5rem;
  }

  .skeleton-slot {
    background: linear-gradient(90deg, var(--color-surface-200) 25%, var(--color-surface-300) 50%, var(--color-surface-200) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--color-surface-300);
    border-top-color: var(--color-primary-500);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
