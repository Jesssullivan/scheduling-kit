/**
 * Tests for middleware error types and SchedulingError bridge
 */

import { describe, it, expect } from 'vitest';
import {
	BrowserError,
	SelectorError,
	WizardStepError,
	CouponError,
	toSchedulingError,
} from '../errors.js';

describe('Middleware Errors', () => {
	describe('BrowserError', () => {
		it('creates with PLAYWRIGHT_MISSING reason', () => {
			const err = new BrowserError({ reason: 'PLAYWRIGHT_MISSING' });
			expect(err._tag).toBe('BrowserError');
			expect(err.reason).toBe('PLAYWRIGHT_MISSING');
			expect(err.cause).toBeUndefined();
		});

		it('creates with cause', () => {
			const cause = new Error('chromium not found');
			const err = new BrowserError({ reason: 'LAUNCH_FAILED', cause });
			expect(err.reason).toBe('LAUNCH_FAILED');
			expect(err.cause).toBe(cause);
		});
	});

	describe('SelectorError', () => {
		it('creates with candidates list', () => {
			const err = new SelectorError({
				candidates: ['.foo', '.bar'],
				message: 'None found',
			});
			expect(err._tag).toBe('SelectorError');
			expect(err.candidates).toEqual(['.foo', '.bar']);
			expect(err.message).toBe('None found');
		});
	});

	describe('WizardStepError', () => {
		it('creates with step and message', () => {
			const err = new WizardStepError({
				step: 'navigate',
				message: 'Page timeout',
			});
			expect(err._tag).toBe('WizardStepError');
			expect(err.step).toBe('navigate');
			expect(err.message).toBe('Page timeout');
		});

		it('includes screenshot buffer', () => {
			const screenshot = Buffer.from('PNG data');
			const err = new WizardStepError({
				step: 'submit',
				message: 'Failed',
				screenshot,
			});
			expect(err.screenshot).toEqual(screenshot);
		});
	});

	describe('CouponError', () => {
		it('creates with code and message', () => {
			const err = new CouponError({
				code: 'VENMO-100',
				message: 'Coupon expired',
			});
			expect(err._tag).toBe('CouponError');
			expect(err.code).toBe('VENMO-100');
			expect(err.message).toBe('Coupon expired');
		});
	});

	describe('toSchedulingError bridge', () => {
		it('maps BrowserError PLAYWRIGHT_MISSING to InfrastructureError UNKNOWN', () => {
			const err = new BrowserError({ reason: 'PLAYWRIGHT_MISSING' });
			const mapped = toSchedulingError(err);
			expect(mapped._tag).toBe('InfrastructureError');
			expect(mapped).toMatchObject({
				_tag: 'InfrastructureError',
				code: 'UNKNOWN',
			});
		});

		it('maps BrowserError LAUNCH_FAILED to InfrastructureError NETWORK', () => {
			const cause = new Error('no display');
			const err = new BrowserError({ reason: 'LAUNCH_FAILED', cause });
			const mapped = toSchedulingError(err);
			expect(mapped).toMatchObject({
				_tag: 'InfrastructureError',
				code: 'NETWORK',
				cause,
			});
		});

		it('maps BrowserError NAVIGATION_FAILED to InfrastructureError NETWORK', () => {
			const err = new BrowserError({ reason: 'NAVIGATION_FAILED' });
			const mapped = toSchedulingError(err);
			expect(mapped).toMatchObject({
				_tag: 'InfrastructureError',
				code: 'NETWORK',
			});
		});

		it('maps SelectorError to AcuityError SCRAPE_FAILED', () => {
			const err = new SelectorError({ candidates: ['.x'], message: 'not found' });
			const mapped = toSchedulingError(err);
			expect(mapped).toMatchObject({
				_tag: 'AcuityError',
				code: 'SCRAPE_FAILED',
				message: 'not found',
			});
		});

		it('maps WizardStepError to AcuityError SCRAPE_FAILED with step info', () => {
			const err = new WizardStepError({ step: 'fill-form', message: 'field missing' });
			const mapped = toSchedulingError(err);
			expect(mapped).toMatchObject({
				_tag: 'AcuityError',
				code: 'SCRAPE_FAILED',
				message: "Wizard step 'fill-form' failed: field missing",
			});
		});

		it('maps CouponError to AcuityError BOOKING_FAILED', () => {
			const err = new CouponError({ code: 'ALT-VENMO-123', message: 'invalid' });
			const mapped = toSchedulingError(err);
			expect(mapped).toMatchObject({
				_tag: 'AcuityError',
				code: 'BOOKING_FAILED',
				message: 'Coupon error: invalid',
			});
		});
	});
});
