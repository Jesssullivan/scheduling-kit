/**
 * E2E Smoke Test: Full Booking Flow
 *
 * Tests the complete wizard pipeline against live Acuity:
 *   navigate → fill form → apply coupon → submit → extract confirmation
 *
 * WARNING: This test CREATES A REAL BOOKING on the live Acuity calendar.
 * Use only with a test coupon that fully discounts the appointment.
 * The booking can be cancelled manually in Acuity admin afterward.
 *
 * Run with: RUN_SMOKE_TEST=true pnpm test:live
 *
 * Requirements:
 *   - Playwright installed: npx playwright install chromium
 *   - ACUITY_BYPASS_COUPON set (e.g., D14467A1)
 *   - Network access to https://MassageIthaca.as.me
 *   - An available time slot (test auto-discovers the next available)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Effect } from 'effect';
import type { Browser, Page } from 'playwright';
import {
	BrowserService,
	BrowserServiceLive,
	defaultBrowserConfig,
	type BrowserConfig,
} from '../../src/middleware/browser-service.js';
import {
	navigateToBooking,
	fillFormFields,
	bypassPayment,
	submitBooking as submitWizard,
	extractConfirmation,
	toBooking,
} from '../../src/middleware/steps/index.js';
import { createScraperAdapter } from '../../src/adapters/acuity-scraper.js';
import * as E from 'fp-ts/Either';

const RUN_SMOKE = process.env.RUN_SMOKE_TEST === 'true';
const ACUITY_BASE_URL = 'https://MassageIthaca.as.me';
const COUPON_CODE = process.env.ACUITY_BYPASS_COUPON ?? 'D14467A1';

// Test client info (use a recognizable name so test bookings are easy to spot)
const TEST_CLIENT = {
	firstName: 'Smoke',
	lastName: 'TestBooking',
	email: 'smoketest@massageithaca.com',
	phone: '6075551234',
};

describe.skipIf(!RUN_SMOKE)('Smoke Test: Full Booking Flow', () => {
	let targetServiceName: string;
	let targetServiceId: string;
	let targetDatetime: string;

	// =========================================================================
	// Step 0: Discover next available slot via scraper
	// =========================================================================

	describe('0. Discover available slot', () => {
		it('finds the next available time slot', async () => {
			const scraper = createScraperAdapter({
				baseUrl: ACUITY_BASE_URL,
				headless: true,
				timeout: 30000,
				userAgent: defaultBrowserConfig.userAgent,
			});

			// Get services
			const servicesResult = await scraper.getServices()();
			expect(E.isRight(servicesResult)).toBe(true);
			if (!E.isRight(servicesResult)) return;

			const services = servicesResult.right;
			console.log(`  Found ${services.length} services`);

			// Pick the first service with available slots
			for (const service of services) {
				// Try current month and next month
				const now = new Date();
				const months = [
					now.toISOString().slice(0, 7),
					new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 7),
				];

				for (const month of months) {
					const datesResult = await scraper.getAvailableDates(service.id, month)();
					if (!E.isRight(datesResult) || datesResult.right.length === 0) continue;

					const date = datesResult.right[0];
					const slotsResult = await scraper.getTimeSlots(service.id, date)();
					if (!E.isRight(slotsResult) || slotsResult.right.length === 0) continue;

					const slot = slotsResult.right.find((s) => s.available);
					if (!slot) continue;

					targetServiceName = service.name;
					targetServiceId = service.id;
					targetDatetime = slot.datetime;

					console.log(`  Target service: ${service.name} (${service.id})`);
					console.log(`  Target datetime: ${targetDatetime}`);
					return;
				}
			}

			throw new Error('No available time slots found in the next 2 months');
		}, 120000); // 2 min timeout for scraper
	});

	// =========================================================================
	// Step 1-5: Full wizard flow via Effect pipeline
	// =========================================================================

	describe('1-5. Full wizard pipeline', () => {
		it('completes a booking with coupon bypass', async () => {
			expect(targetDatetime).toBeTruthy();
			expect(targetServiceName).toBeTruthy();

			const browserConfig: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				headless: true,
				timeout: 30000,
			};

			const layer = BrowserServiceLive(browserConfig);

			const program = Effect.gen(function* () {
				// Step 1: Navigate through wizard
				console.log('  [1/5] Navigating to booking...');
				const nav = yield* navigateToBooking({
					serviceName: targetServiceName,
					datetime: targetDatetime,
					client: TEST_CLIENT,
					appointmentTypeId: targetServiceId,
				});
				console.log(`  [1/5] Landed on: ${nav.landingStep} (${nav.url})`);
				expect(nav.landingStep).toBe('client-form');

				// Step 2: Fill client form + intake fields
				console.log('  [2/5] Filling form fields...');
				const formResult = yield* fillFormFields({
					client: TEST_CLIENT,
					customFields: {
						howDidYouHear: ['Internet search'],
						medication: 'None - smoke test booking',
						termsAccepted: true,
					},
				});
				console.log(`  [2/5] Form filled: ${formResult.fieldsSet} fields, advanced=${formResult.advanced}`);

				// Step 3: Apply coupon on payment page
				console.log(`  [3/5] Applying coupon ${COUPON_CODE}...`);
				const bypass = yield* bypassPayment(COUPON_CODE);
				console.log(`  [3/5] Coupon applied: original=$${bypass.originalTotal / 100}, final=$${bypass.finalTotal / 100}`);
				expect(bypass.finalTotal).toBe(0);

				// Step 4: Submit booking
				console.log('  [4/5] Submitting booking...');
				yield* submitWizard();
				console.log('  [4/5] Submitted');

				// Step 5: Extract confirmation
				console.log('  [5/5] Extracting confirmation...');
				const confirmation = yield* extractConfirmation();
				console.log(`  [5/5] Confirmed: ${JSON.stringify(confirmation)}`);

				const booking = toBooking(
					confirmation,
					{
						serviceId: targetServiceId,
						datetime: targetDatetime,
						client: TEST_CLIENT,
						paymentMethod: 'cash',
						idempotencyKey: `smoke-test-${Date.now()}`,
					},
					'SMOKE-TEST',
					'test',
				);

				return booking;
			});

			const result = await Effect.runPromise(
				Effect.scoped(program.pipe(Effect.provide(layer))),
			);

			console.log(`  Booking ID: ${result.id}`);
			console.log(`  Confirmation: ${result.confirmationCode}`);
			console.log(`  Status: ${result.status}`);

			expect(result.id).toBeTruthy();
			expect(result.status).toBe('confirmed');

			// Log for manual cleanup
			console.log('\n  *** IMPORTANT: Cancel this test booking in Acuity admin ***');
			console.log(`  *** Booking ID: ${result.id} ***`);
			console.log(`  *** Client: ${TEST_CLIENT.firstName} ${TEST_CLIENT.lastName} (${TEST_CLIENT.email}) ***\n`);
		}, 180000); // 3 min timeout for full wizard flow
	});
});
