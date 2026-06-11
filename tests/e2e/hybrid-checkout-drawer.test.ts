/**
 * HybridCheckoutDrawer Component Tests
 *
 * Render-level coverage of the real handlePaymentSelect routing (no
 * simulation): unavailable card/venmo selections and unknown method ids
 * must land on the error step and never fabricate a local booking via
 * manual completion; only explicit manual ids may complete in-app.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import HybridCheckoutDrawer from '../../src/components/HybridCheckoutDrawer.svelte';
import { getDefaultCapabilities } from '../../src/payments/types.js';
import type { PaymentCapabilities, PaymentMethodOption } from '../../src/payments/types.js';
import type { Service } from '../../src/core/types.js';

const service: Service = {
  id: 'svc-1',
  name: 'Consultation',
  duration: 60,
  price: 15000,
  currency: 'USD',
  active: true,
};

const AVAILABLE_DATE = '2026-06-30';
// 2:00 PM America/New_York (drawer default timezone)
const SLOT_DATETIME = '2026-06-30T18:00:00.000Z';

const buildCapabilities = (methods: PaymentMethodOption[]): PaymentCapabilities => ({
  ...getDefaultCapabilities(),
  methods,
});

const renderDrawer = (capabilities: PaymentCapabilities) => {
  const onBookingComplete = vi.fn();
  const onCreateStripeIntent = vi.fn();

  render(HybridCheckoutDrawer, {
    props: {
      open: true,
      services: [service],
      skipProvider: true,
      capabilities,
      onLoadDates: vi.fn(async () => [AVAILABLE_DATE]),
      onLoadSlots: vi.fn(async () => [{ datetime: SLOT_DATETIME, available: true }]),
      onCreateStripeIntent,
      onBookingComplete,
    },
  });

  return { onBookingComplete, onCreateStripeIntent };
};

/** Walk the real drawer from service selection to the payment step. */
const advanceToPaymentStep = async () => {
  // Service step
  const serviceCard = (await screen.findByText('Consultation')).closest('button');
  await fireEvent.click(serviceCard!);

  // Datetime step (skipProvider: true jumps straight here)
  const dayButton = await screen.findByRole('button', { name: /June 30, available/ });
  await fireEvent.click(dayButton);
  const slotButton = await screen.findByRole('button', { name: '2:00 PM' });
  await fireEvent.click(slotButton);

  // Details step (showIntakeFields is hardcoded true in the drawer)
  await screen.findByLabelText(/first name/i);
  await fireEvent.input(screen.getByLabelText(/first name/i), { target: { value: 'Pat' } });
  await fireEvent.input(screen.getByLabelText(/last name/i), { target: { value: 'Tester' } });
  await fireEvent.input(screen.getByLabelText(/email/i), { target: { value: 'pat@example.com' } });

  for (const radio of Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="no"]')
  )) {
    await fireEvent.click(radio);
  }
  const checkboxes = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  );
  // First "how did you hear" option + the terms acknowledgement (last checkbox)
  await fireEvent.click(checkboxes[0]);
  await fireEvent.click(checkboxes[checkboxes.length - 1]);
  await fireEvent.input(screen.getByLabelText(/current medications/i), {
    target: { value: 'None' },
  });

  await fireEvent.submit(document.querySelector('form.client-form, form')!);

  // Payment step
  await screen.findByText('Select Payment Method');
};

const selectPaymentOption = async (displayName: string) => {
  const optionButton = screen.getByText(displayName).closest('button');
  await fireEvent.click(optionButton!);
};

describe('HybridCheckoutDrawer payment routing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('errors card selections when Stripe is unavailable and never completes a booking', async () => {
    const { onBookingComplete, onCreateStripeIntent } = renderDrawer(
      buildCapabilities([
        { id: 'card', name: 'card', displayName: 'Credit/Debit Card', available: true },
      ])
    );

    await advanceToPaymentStep();
    await selectPaymentOption('Credit/Debit Card');

    expect(
      await screen.findByText('Card payments are not available right now.')
    ).toBeInTheDocument();
    // Step title + error heading both show the error step
    expect(screen.getAllByText('Something Went Wrong').length).toBeGreaterThan(0);
    expect(onCreateStripeIntent).not.toHaveBeenCalled();
    expect(onBookingComplete).not.toHaveBeenCalled();
  });

  it('errors venmo selections when Venmo is unavailable instead of manual completion', async () => {
    const { onBookingComplete } = renderDrawer(
      buildCapabilities([{ id: 'venmo', name: 'venmo', displayName: 'Venmo', available: true }])
    );

    await advanceToPaymentStep();
    await selectPaymentOption('Venmo');

    expect(
      await screen.findByText('Venmo payments are not available right now.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('Something Went Wrong').length).toBeGreaterThan(0);
    expect(onBookingComplete).not.toHaveBeenCalled();
  });

  it('errors unknown method ids instead of manual completion', async () => {
    const { onBookingComplete } = renderDrawer(
      buildCapabilities([
        { id: 'bitcoin', name: 'bitcoin', displayName: 'Bitcoin', available: true },
      ])
    );

    await advanceToPaymentStep();
    await selectPaymentOption('Bitcoin');

    expect(
      await screen.findByText(
        'This payment method is not supported in the current checkout flow.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText('Something Went Wrong').length).toBeGreaterThan(0);
    expect(onBookingComplete).not.toHaveBeenCalled();
  });

  it('completes explicit manual selections (cash) in-app', async () => {
    const { onBookingComplete } = renderDrawer(
      buildCapabilities([{ id: 'cash', name: 'cash', displayName: 'Cash', available: true }])
    );

    await advanceToPaymentStep();
    await selectPaymentOption('Cash');

    expect(await screen.findByText('Booking Confirmed!')).toBeInTheDocument();
    expect(onBookingComplete).toHaveBeenCalledTimes(1);
    expect(onBookingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'svc-1', paymentStatus: 'paid' })
    );
  });
});
