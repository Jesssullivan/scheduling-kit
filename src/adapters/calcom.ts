/**
 * Cal.com Scheduling Adapter
 * Stub implementation for future migration from Acuity
 *
 * Cal.com API: https://cal.com/docs/api-reference
 * Self-hosted option available for full control
 */
import * as TE from 'fp-ts/TaskEither';
import type { SchedulingAdapter } from './types.js';
import type {
	Service,
	Provider,
	AvailableDate,
	TimeSlot,
	Booking,
	BookingRequest,
	SlotReservation,
	ClientInfo,
	SchedulingError,
} from '../core/types.js';
import { Errors } from '../core/types.js';

export interface CalComConfig {
	apiKey: string;
	baseUrl?: string; // Default: https://api.cal.com/v1 or self-hosted URL
	teamId?: string;
}

/**
 * Create a Cal.com scheduling adapter
 *
 * Cal.com equivalents:
 * - Service = Event Type
 * - Provider = Team Member / User
 * - Available Dates = Availability slots
 * - Booking = Booking
 *
 * Key differences from Acuity:
 * - More flexible availability rules
 * - Better team/organization support
 * - Native webhooks
 * - Open source / self-hostable
 */
export const createCalComAdapter = (_config: CalComConfig): SchedulingAdapter => {
	const notImplemented = <T>(): TE.TaskEither<SchedulingError, T> =>
		TE.left(
			Errors.infrastructure(
				'UNKNOWN',
				'Cal.com adapter not yet implemented. Currently using Acuity.',
			),
		);

	return {
		name: 'calcom',

		getServices: () => notImplemented<Service[]>(),

		getService: (_id: string) => notImplemented<Service>(),

		getProviders: () => notImplemented<Provider[]>(),

		getProvider: (_id: string) => notImplemented<Provider>(),

		getProvidersForService: (_serviceId: string) => notImplemented<Provider[]>(),

		getAvailableDates: (_params: {
			serviceId: string;
			providerId?: string;
			startDate: string;
			endDate: string;
		}) => notImplemented<AvailableDate[]>(),

		getAvailableSlots: (_params: {
			serviceId: string;
			providerId?: string;
			date: string;
		}) => notImplemented<TimeSlot[]>(),

		checkSlotAvailability: (_params: {
			serviceId: string;
			providerId?: string;
			datetime: string;
		}) => notImplemented<boolean>(),

		createReservation: (_params: {
			serviceId: string;
			providerId?: string;
			datetime: string;
			duration: number;
			expirationMinutes?: number;
			notes?: string;
		}) => notImplemented<SlotReservation>(),

		releaseReservation: (_reservationId: string) => notImplemented<void>(),

		createBooking: (_request: BookingRequest) => notImplemented<Booking>(),

		createBookingWithPaymentRef: (
			_request: BookingRequest,
			_paymentRef: string,
			_paymentProcessor: string,
		) => notImplemented<Booking>(),

		getBooking: (_id: string) => notImplemented<Booking>(),

		cancelBooking: (_id: string, _reason?: string) => notImplemented<void>(),

		rescheduleBooking: (_id: string, _newDatetime: string) => notImplemented<Booking>(),

		findOrCreateClient: (_client: ClientInfo) =>
			notImplemented<{ id: string; isNew: boolean }>(),

		getClientByEmail: (_email: string) => notImplemented<ClientInfo | null>(),
	};
};

/**
 * Migration guide: Acuity → Cal.com
 *
 * 1. Data Migration:
 *    - Export Acuity appointment types → Create Cal.com event types
 *    - Export Acuity calendars → Create Cal.com team members
 *    - Historical bookings can be imported via CSV
 *
 * 2. Configuration Mapping:
 *    Acuity                    Cal.com
 *    -------                   -------
 *    Appointment Type      →   Event Type
 *    Calendar              →   Team Member
 *    Availability          →   Availability Schedules
 *    Forms                 →   Booking Questions
 *    Packages              →   Recurring Events
 *
 * 3. Payment Integration:
 *    Cal.com has native Stripe support, but our PaymentAdapter
 *    pattern allows keeping Venmo/manual payments
 *
 * 4. Webhook Differences:
 *    Cal.com webhooks are more flexible:
 *    - BOOKING_CREATED, BOOKING_CANCELLED, etc.
 *    - Custom payloads
 *    - Retry configuration
 *
 * 5. Self-Hosting Benefits:
 *    - Full data control
 *    - Custom branding
 *    - No per-booking fees
 *    - Direct database access for reporting
 */
