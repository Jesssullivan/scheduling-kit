/**
 * Tests for BrowserService Layer
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
	BrowserService,
	BrowserServiceTest,
	defaultBrowserConfig,
} from '../browser-service.js';

describe('BrowserService', () => {
	describe('defaultBrowserConfig', () => {
		it('has sensible defaults', () => {
			expect(defaultBrowserConfig.baseUrl).toBe('https://MassageIthaca.as.me');
			expect(defaultBrowserConfig.headless).toBe(true);
			expect(defaultBrowserConfig.timeout).toBe(30000);
			expect(defaultBrowserConfig.screenshotOnFailure).toBe(true);
			expect(defaultBrowserConfig.userAgent).toContain('Chrome');
		});
	});

	describe('BrowserServiceTest', () => {
		it('provides a mock service', async () => {
			const program = Effect.gen(function* () {
				const svc = yield* BrowserService;
				return svc.config;
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceTest())),
			);

			expect(result.baseUrl).toBe('https://MassageIthaca.as.me');
			expect(result.headless).toBe(true);
		});

		it('allows custom config in test layer', async () => {
			const program = Effect.gen(function* () {
				const svc = yield* BrowserService;
				return svc.config;
			});

			const result = await Effect.runPromise(
				program.pipe(
					Effect.provide(
						BrowserServiceTest({
							baseUrl: 'https://test.example.com',
							timeout: 5000,
						}),
					),
				),
			);

			expect(result.baseUrl).toBe('https://test.example.com');
			expect(result.timeout).toBe(5000);
		});

		it('mock screenshot returns buffer', async () => {
			const program = Effect.gen(function* () {
				const svc = yield* BrowserService;
				return yield* svc.screenshot('test');
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceTest())),
			);

			expect(Buffer.isBuffer(result)).toBe(true);
		});
	});
});
