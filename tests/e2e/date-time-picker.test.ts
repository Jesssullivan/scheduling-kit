import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DateTimePicker from '../../src/components/DateTimePicker.svelte';

describe('DateTimePicker component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears stale selected date and slot UI when the user advances months', async () => {
    const onMonthChange = vi.fn();

    render(DateTimePicker, {
      props: {
        availableDates: [{ date: '2026-05-30', slots: 1 }],
        availableSlots: [
          {
            datetime: '2026-05-30T18:00:00.000Z',
            available: true,
          },
        ],
        selectedDate: '2026-05-30',
        selectedTime: '2026-05-30T18:00:00.000Z',
        timezone: 'America/New_York',
        onMonthChange,
      },
    });

    expect(screen.getByText('May 2026')).toBeInTheDocument();
    expect(
      screen.getByText('Available times for Saturday, May 30'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2:00 PM' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    await waitFor(() => {
      expect(screen.getByText('June 2026')).toBeInTheDocument();
      expect(
        screen.queryByText('Available times for Saturday, May 30'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '2:00 PM' }),
      ).not.toBeInTheDocument();
    });

    expect(onMonthChange).toHaveBeenCalledWith('2026-06-01', '2026-06-30');
  });
});
