/**
 * BookingConfirmation Component Tests
 *
 * Focus: the component ships with NO branded business defaults — business
 * identity blocks render only when the consumer passes the corresponding
 * props (TIN-1995 de-branding).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BookingConfirmation from '../../src/components/BookingConfirmation.svelte';
import type { Booking } from '../../src/core/types.js';

const createBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'booking-1',
  serviceId: 'service-1',
  serviceName: 'TMD 60 min',
  providerId: 'provider-1',
  providerName: 'Alex Rivera',
  datetime: '2026-04-20T14:00:00.000Z',
  endTime: '2026-04-20T15:00:00.000Z',
  duration: 60,
  price: 20000,
  currency: 'USD',
  client: {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
  },
  status: 'confirmed',
  confirmationCode: 'BK-X7K2P9',
  paymentStatus: 'pending',
  createdAt: '2026-04-18T10:00:00.000Z',
  ...overrides,
});

const getGoogleCalendarHref = (): string => {
  const link = screen.getByText('📅 Add to Google Calendar').closest('a');
  return link?.getAttribute('href') ?? '';
};

describe('BookingConfirmation Component', () => {
  it('renders the confirmation code and appointment details', () => {
    render(BookingConfirmation, { props: { booking: createBooking() } });

    expect(screen.getByText('Booking Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('#BK-X7K2P9')).toBeInTheDocument();
    expect(screen.getByText('TMD 60 min')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
  });

  describe('de-branding (no business defaults)', () => {
    it('does not render any branded business identity when props are omitted', () => {
      const { container } = render(BookingConfirmation, {
        props: { booking: createBooking() },
      });

      expect(container.innerHTML).not.toContain('Massage Ithaca');
      expect(container.innerHTML).not.toContain('massageithaca');
      expect(container.innerHTML).not.toContain('Danby');
      expect(container.innerHTML).not.toContain('Ithaca');
    });

    it('hides the Location block when no businessAddress or mapsUrl is provided', () => {
      render(BookingConfirmation, { props: { booking: createBooking() } });

      expect(screen.queryByText('Location')).not.toBeInTheDocument();
      expect(screen.queryByText('Get Directions →')).not.toBeInTheDocument();
    });

    it('omits the location param from the Google Calendar link when no short address is provided', () => {
      render(BookingConfirmation, { props: { booking: createBooking() } });

      const href = getGoogleCalendarHref();
      expect(href).toContain('calendar.google.com');
      expect(href).not.toContain('location=');
    });

    it('uses a neutral appointment description when businessName is absent', () => {
      render(BookingConfirmation, { props: { booking: createBooking() } });

      const href = getGoogleCalendarHref();
      const details = new URL(href).searchParams.get('details') ?? '';
      expect(details).toContain('Appointment');
      expect(details).not.toContain(' at ');
    });
  });

  describe('consumer-provided business identity', () => {
    it('renders the Location block when businessAddress is provided', () => {
      render(BookingConfirmation, {
        props: {
          booking: createBooking(),
          businessAddress: '123 Main St, Springfield, ST 00000',
        },
      });

      expect(screen.getByText('Location')).toBeInTheDocument();
      expect(
        screen.getByText('123 Main St, Springfield, ST 00000'),
      ).toBeInTheDocument();
    });

    it('renders the directions link only when mapsUrl is provided', () => {
      render(BookingConfirmation, {
        props: {
          booking: createBooking(),
          mapsUrl: 'https://maps.example.com/directions',
        },
      });

      const directions = screen.getByText('Get Directions →');
      expect(directions.closest('a')).toHaveAttribute(
        'href',
        'https://maps.example.com/directions',
      );
    });

    it('threads businessName and businessShortAddress into the Google Calendar link', () => {
      render(BookingConfirmation, {
        props: {
          booking: createBooking(),
          businessName: 'Acme Wellness',
          businessShortAddress: '123 Main St, Springfield',
        },
      });

      const href = getGoogleCalendarHref();
      const params = new URL(href).searchParams;
      expect(params.get('details')).toContain('Appointment at Acme Wellness');
      expect(params.get('location')).toBe('123 Main St, Springfield');
    });
  });
});
