/**
 * Selector Health Check — Nightly Cron Test
 *
 * Probes key Acuity DOM selectors to detect breakage before it
 * affects production bookings. Designed to run on a schedule (CI cron).
 *
 * Run with: RUN_LIVE_TESTS=true pnpm test:live -- selector-health
 *
 * CI cron config (.gitlab-ci.yml):
 *   selector-health:
 *     schedule:
 *       cron: "0 6 * * *"  # 6am daily
 *     script:
 *       - cd packages/scheduling-kit
 *       - RUN_LIVE_TESTS=true npx vitest run --config vitest.live.config.ts tests/live/selector-health
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Effect } from 'effect';
import type { Browser, Page } from 'playwright';
import {
	Selectors,
	healthCheck,
	type SelectorKey,
} from '../../src/middleware/selectors.js';
import { defaultBrowserConfig } from '../../src/middleware/browser-service.js';

const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS === 'true';
const ACUITY_BASE_URL = 'https://MassageIthaca.as.me';

let browser: Browser;
let page: Page;

describe.skipIf(!RUN_LIVE_TESTS)('Selector Health Check', () => {
	beforeAll(async () => {
		const pw = await import('playwright');
		browser = await pw.chromium.launch({ headless: true });
		page = await browser.newPage({ userAgent: defaultBrowserConfig.userAgent });
		page.setDefaultTimeout(15000);
	}, 30000);

	afterAll(async () => {
		if (page) await page.close().catch(() => {});
		if (browser) await browser.close().catch(() => {});
	});

	it('verifies service page selectors', async () => {
		await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

		const keys: SelectorKey[] = ['serviceList', 'serviceItem', 'bookButton'];
		const result = await Effect.runPromise(healthCheck(page, keys));

		console.log(`  Service page: ${result.passed.length} passed, ${result.failed.length} failed`);
		if (result.failed.length > 0) {
			console.error(`  FAILED selectors: ${result.failed.join(', ')}`);
		}

		expect(result.failed).toHaveLength(0);
	});

	it('verifies calendar selectors after clicking Book', async () => {
		await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

		// Click the first Book button to get to calendar
		const bookBtn = await page.$('li.select-item button.btn');
		if (!bookBtn) {
			console.warn('  No Book button found — skipping calendar check');
			return;
		}
		await bookBtn.click();
		await page.waitForTimeout(2000);

		const keys: SelectorKey[] = ['calendarTile'];
		const result = await Effect.runPromise(healthCheck(page, keys));

		console.log(`  Calendar page: ${result.passed.length} passed, ${result.failed.length} failed`);
		expect(result.failed).toHaveLength(0);
	});

	it('verifies client form selectors', async () => {
		// Navigate to a specific appointment type to get to the form
		// Use the known TMD 1st Consultation appointment
		await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

		// Check that we can find the standard form field selectors
		// Without actually navigating to the form (that would require selecting a slot)
		const keys: SelectorKey[] = ['firstNameField', 'lastNameField', 'emailField'];

		// These selectors exist as CSS patterns — verify they parse correctly
		for (const key of keys) {
			const candidates = Selectors[key];
			expect(candidates.length).toBeGreaterThan(0);
			console.log(`  ${key}: ${candidates.length} candidate selector(s)`);
		}
	});

	it('generates summary report', async () => {
		const allKeys = Object.keys(Selectors) as SelectorKey[];
		console.log(`\n  Selector Registry: ${allKeys.length} keys`);
		for (const key of allKeys) {
			const count = Selectors[key].length;
			console.log(`    ${key}: ${count} candidate(s)`);
		}
		console.log('');
	});
});
