/**
 * Tests for CSS selector registry
 */

import { describe, it, expect } from 'vitest';
import { Selectors } from '../selectors.js';

describe('Selector Registry', () => {
	describe('Selectors object', () => {
		it('has all required selector groups', () => {
			const requiredKeys = [
				'serviceList',
				'serviceName',
				'serviceLink',
				'servicePrice',
				'serviceDuration',
				'serviceDescription',
				'serviceBookButton',
				'serviceCategory',
				'calendar',
				'calendarMonth',
				'calendarPrev',
				'calendarNext',
				'calendarDay',
				'activeDay',
				'timeSlotContainer',
				'timeSlot',
				'timeSlotSelected',
				'selectAndContinue',
				'firstNameInput',
				'lastNameInput',
				'emailInput',
				'phoneInput',
				'continueToPayment',
				'checkCodeBalance',
				'termsCheckbox',
				'radioNoLabel',
				'radioYesLabel',
				'howDidYouHearCheckbox',
				'medicationField',
				'couponField',
				'couponTabByCode',
				'couponConfirmButton',
				'couponCloseButton',
				'couponError',
				'couponSuccess',
				'paymentCouponToggle',
				'paymentCouponInput',
				'paymentCouponApply',
				'paymentTotal',
				'paymentSubtotal',
				'payAndConfirm',
				'submitButton',
				'confirmationPage',
				'confirmationId',
				'confirmationService',
				'confirmationDatetime',
			];

			for (const key of requiredKeys) {
				expect(Selectors).toHaveProperty(key);
				expect(Array.isArray(Selectors[key as keyof typeof Selectors])).toBe(true);
			}
		});

		it('every selector group has at least one candidate', () => {
			for (const [key, candidates] of Object.entries(Selectors)) {
				expect(candidates.length, `${key} should have at least 1 selector`).toBeGreaterThan(0);
			}
		});

		it('every selector group has at least two candidates for resilience', () => {
			const criticalSelectors = [
				'serviceList',
				'calendarDay',
				'activeDay',
				'timeSlot',
				'selectAndContinue',
				'firstNameInput',
				'continueToPayment',
				'submitButton',
				'confirmationPage',
				'serviceBookButton',
			];

			for (const key of criticalSelectors) {
				const candidates = Selectors[key as keyof typeof Selectors];
				expect(
					candidates.length,
					`${key} should have at least 2 fallback selectors`,
				).toBeGreaterThanOrEqual(2);
			}
		});

		it('no duplicate selectors within a group', () => {
			for (const [key, candidates] of Object.entries(Selectors)) {
				const unique = new Set(candidates);
				expect(
					unique.size,
					`${key} has duplicate selectors`,
				).toBe(candidates.length);
			}
		});
	});

	describe('Selector format', () => {
		it('all selectors are non-empty strings', () => {
			for (const [key, candidates] of Object.entries(Selectors)) {
				for (const selector of candidates) {
					expect(typeof selector).toBe('string');
					expect(selector.trim().length, `Empty selector in ${key}`).toBeGreaterThan(0);
				}
			}
		});

		it('input selectors target input-like elements', () => {
			const inputKeys = ['firstNameInput', 'lastNameInput', 'emailInput', 'phoneInput', 'couponField'];
			for (const key of inputKeys) {
				const candidates = Selectors[key as keyof typeof Selectors];
				const hasInputSelector = candidates.some(
					(s) => s.includes('input') || s.includes('#') || s.includes('[data-field'),
				);
				expect(hasInputSelector, `${key} should have at least one input-targeting selector`).toBe(
					true,
				);
			}
		});

		it('button selectors target clickable elements', () => {
			const buttonKeys = ['continueToPayment', 'couponConfirmButton', 'submitButton'];
			for (const key of buttonKeys) {
				const candidates = Selectors[key as keyof typeof Selectors];
				const hasButtonSelector = candidates.some(
					(s) =>
						s.includes('button') ||
						s.includes('btn') ||
						s.includes('[data-action') ||
						s.includes(':has-text'),
				);
				expect(hasButtonSelector, `${key} should have at least one button-targeting selector`).toBe(
					true,
				);
			}
		});
	});
});
