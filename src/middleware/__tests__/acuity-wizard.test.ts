/**
 * Tests for the WizardAdapter factory
 */

import { describe, it, expect } from 'vitest';
import { Effect, Exit, Cause } from 'effect';
import { createWizardAdapter } from '../acuity-wizard.js';

describe('WizardAdapter', () => {
	const adapter = createWizardAdapter({
		baseUrl: 'https://MassageIthaca.as.me',
		couponCode: 'TEST-COUPON',
	});

	describe('factory', () => {
		it('creates adapter with correct name', () => {
			expect(adapter.name).toBe('acuity-wizard');
		});

		it('has all SchedulingAdapter methods', () => {
			// Read methods
			expect(typeof adapter.getServices).toBe('function');
			expect(typeof adapter.getService).toBe('function');
			expect(typeof adapter.getProviders).toBe('function');
			expect(typeof adapter.getProvider).toBe('function');
			expect(typeof adapter.getProvidersForService).toBe('function');
			expect(typeof adapter.getAvailableDates).toBe('function');
			expect(typeof adapter.getAvailableSlots).toBe('function');
			expect(typeof adapter.checkSlotAvailability).toBe('function');

			// Write methods
			expect(typeof adapter.createBooking).toBe('function');
			expect(typeof adapter.createBookingWithPaymentRef).toBe('function');
			expect(typeof adapter.cancelBooking).toBe('function');
			expect(typeof adapter.rescheduleBooking).toBe('function');
			expect(typeof adapter.getBooking).toBe('function');

			// Reservation
			expect(typeof adapter.createReservation).toBe('function');
			expect(typeof adapter.releaseReservation).toBe('function');

			// Client
			expect(typeof adapter.findOrCreateClient).toBe('function');
			expect(typeof adapter.getClientByEmail).toBe('function');
		});
	});

	describe('single-provider operations', () => {
		it('getProviders returns Jennifer Whitaker', async () => {
			const providers = await Effect.runPromise(adapter.getProviders());
			expect(providers).toHaveLength(1);
			expect(providers[0].name).toBe('Default Provider');
			expect(providers[0].timezone).toBe('America/New_York');
		});

		it('getProvider returns default provider stub', async () => {
			const provider = await Effect.runPromise(adapter.getProvider('1'));
			expect(provider.name).toBe('Default Provider');
		});

		it('getProvidersForService returns default provider stub', async () => {
			const providers = await Effect.runPromise(adapter.getProvidersForService('any-service'));
			expect(providers).toHaveLength(1);
		});
	});

	describe('not-implemented operations', () => {
		it('cancelBooking returns NOT_IMPLEMENTED error', async () => {
			const exit = await Effect.runPromiseExit(adapter.cancelBooking('booking-123'));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('AcuityError');
					expect(error.value).toMatchObject({ code: 'NOT_IMPLEMENTED' });
				}
			}
		});

		it('rescheduleBooking returns NOT_IMPLEMENTED error', async () => {
			const exit = await Effect.runPromiseExit(adapter.rescheduleBooking('booking-123', '2026-03-01T10:00:00'));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('AcuityError');
				}
			}
		});

		it('getBooking returns NOT_IMPLEMENTED error', async () => {
			const exit = await Effect.runPromiseExit(adapter.getBooking('booking-123'));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe('reservation (graceful degradation)', () => {
		it('createReservation returns BLOCK_FAILED (pipeline will skip)', async () => {
			const exit = await Effect.runPromiseExit(adapter.createReservation({
				serviceId: 'svc-1',
				datetime: '2026-03-01T10:00:00',
				duration: 60,
			}));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('ReservationError');
				}
			}
		});

		it('releaseReservation succeeds (no-op)', async () => {
			await Effect.runPromise(adapter.releaseReservation('res-123'));
		});
	});

	describe('client operations', () => {
		it('findOrCreateClient returns local ID', async () => {
			const result = await Effect.runPromise(adapter.findOrCreateClient({
				firstName: 'Jane',
				lastName: 'Doe',
				email: 'jane@example.com',
			}));
			expect(result.id).toBe('local-jane@example.com');
			expect(result.isNew).toBe(true);
		});

		it('getClientByEmail returns null', async () => {
			const result = await Effect.runPromise(adapter.getClientByEmail('jane@example.com'));
			expect(result).toBeNull();
		});
	});
});
