/**
 * Onboarding subpackage tests.
 *
 * Tests pure functions (no MSW needed for URL builders/validators).
 * MSW tests for actual API calls are in separate files.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildStripeAuthorizeUrl } from '../stripe/oauth.js';
import { validateStripeKeys } from '../stripe/configure.js';
import { getStripeAccountStatus } from '../stripe/account.js';
import { validatePayPalCredentials } from '../paypal/configure.js';
import { createAdapterFactory } from '../factory.js';
import {
	getStripeStatus,
	getPayPalStatus,
	getStripeSetupSteps,
	getPayPalSetupSteps,
	getOverallProgress,
	type StripeState,
	type PayPalState,
} from '../status.js';
import type { CredentialStore } from '../types.js';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

describe('Provider status', () => {
	const emptyStripe: StripeState = {
		platformConfigured: false, accountId: null,
		chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
		webhookConfigured: false,
	};

	it('stripe: not_configured when no platform keys', () => {
		expect(getStripeStatus(emptyStripe)).toBe('not_configured');
	});

	it('stripe: incomplete when platform configured but no charges', () => {
		expect(getStripeStatus({ ...emptyStripe, platformConfigured: true })).toBe('incomplete');
	});

	it('stripe: incomplete when account exists but not verified', () => {
		expect(getStripeStatus({ ...emptyStripe, accountId: 'acct_1', detailsSubmitted: true })).toBe('incomplete');
	});

	it('stripe: connected when charges + payouts enabled', () => {
		expect(getStripeStatus({
			...emptyStripe, platformConfigured: true, accountId: 'acct_1',
			chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, webhookConfigured: true,
		})).toBe('connected');
	});

	it('paypal: not_configured when no platform keys', () => {
		expect(getPayPalStatus({ platformConfigured: false, payeeEmail: null })).toBe('not_configured');
	});

	it('paypal: incomplete when platform configured but no email', () => {
		expect(getPayPalStatus({ platformConfigured: true, payeeEmail: null })).toBe('incomplete');
	});

	it('paypal: connected when platform + email', () => {
		expect(getPayPalStatus({ platformConfigured: true, payeeEmail: 'jen@example.com' })).toBe('connected');
	});
});

describe('Setup steps', () => {
	it('stripe: first step current when nothing configured', () => {
		const steps = getStripeSetupSteps({
			platformConfigured: false, accountId: null,
			chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
			webhookConfigured: false,
		});
		expect(steps[0].current).toBe(true);
		expect(steps[0].complete).toBe(false);
		expect(steps[1].current).toBe(false);
		expect(steps[2].current).toBe(false);
	});

	it('stripe: second step current after platform configured', () => {
		const steps = getStripeSetupSteps({
			platformConfigured: true, accountId: null,
			chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
			webhookConfigured: false,
		});
		expect(steps[0].complete).toBe(true);
		expect(steps[1].current).toBe(true);
	});

	it('stripe: third step current after account linked', () => {
		const steps = getStripeSetupSteps({
			platformConfigured: true, accountId: 'acct_1',
			chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true,
			webhookConfigured: false,
		});
		expect(steps[0].complete).toBe(true);
		expect(steps[1].complete).toBe(true);
		expect(steps[2].current).toBe(true);
	});

	it('stripe: all complete when fully configured', () => {
		const steps = getStripeSetupSteps({
			platformConfigured: true, accountId: 'acct_1',
			chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
			webhookConfigured: true,
		});
		expect(steps.every(s => s.complete)).toBe(true);
		expect(steps.every(s => !s.current)).toBe(true);
	});

	it('paypal: first step current when nothing configured', () => {
		const steps = getPayPalSetupSteps({ platformConfigured: false, payeeEmail: null });
		expect(steps[0].current).toBe(true);
		expect(steps[1].current).toBe(false);
	});

	it('paypal: second step current after platform configured', () => {
		const steps = getPayPalSetupSteps({ platformConfigured: true, payeeEmail: null });
		expect(steps[0].complete).toBe(true);
		expect(steps[1].current).toBe(true);
	});

	it('paypal: all complete when connected', () => {
		const steps = getPayPalSetupSteps({ platformConfigured: true, payeeEmail: 'a@b.com' });
		expect(steps.every(s => s.complete)).toBe(true);
	});
});

describe('Overall progress', () => {
	it('0 of 5 when nothing configured', () => {
		const p = getOverallProgress(
			{ platformConfigured: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, webhookConfigured: false },
			{ platformConfigured: false, payeeEmail: null },
		);
		expect(p.complete).toBe(0);
		expect(p.total).toBe(5);
	});

	it('5 of 5 when everything configured', () => {
		const p = getOverallProgress(
			{ platformConfigured: true, accountId: 'acct_1', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, webhookConfigured: true },
			{ platformConfigured: true, payeeEmail: 'a@b.com' },
		);
		expect(p.complete).toBe(5);
		expect(p.total).toBe(5);
	});

	it('partial progress tracked correctly', () => {
		const p = getOverallProgress(
			{ platformConfigured: true, accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, webhookConfigured: false },
			{ platformConfigured: true, payeeEmail: 'a@b.com' },
		);
		expect(p.complete).toBe(3); // stripe platform + paypal platform + paypal email
	});
});

// ---------------------------------------------------------------------------
// Existing tests
// ---------------------------------------------------------------------------

describe('Stripe OAuth', () => {
	it('builds correct authorize URL', () => {
		const url = buildStripeAuthorizeUrl('ca_test123', 'state_abc', 'https://example.com/callback');
		expect(url).toContain('connect.stripe.com/oauth/authorize');
		expect(url).toContain('client_id=ca_test123');
		expect(url).toContain('state=state_abc');
		expect(url).toContain('scope=read_write');
		expect(url).toContain('response_type=code');
		expect(url).toContain(encodeURIComponent('https://example.com/callback'));
	});

	it('includes all required OAuth params', () => {
		const url = buildStripeAuthorizeUrl('ca_x', 's', 'https://x.com/cb');
		const parsed = new URL(url);
		expect(parsed.searchParams.get('response_type')).toBe('code');
		expect(parsed.searchParams.get('client_id')).toBe('ca_x');
		expect(parsed.searchParams.get('scope')).toBe('read_write');
		expect(parsed.searchParams.get('state')).toBe('s');
	});
});

describe('Stripe key validation', () => {
	it('rejects invalid prefix', async () => {
		const result = await validateStripeKeys('invalid_key', 'pk_test_x');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('sk_live_');
	});

	it('rejects invalid publishable prefix', async () => {
		const result = await validateStripeKeys('sk_test_x', 'invalid_pk');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('pk_live_');
	});

	it('detects live mode from key prefix', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', mockFetch);

		const result = await validateStripeKeys('sk_live_test', 'pk_live_test');
		expect(result.mode).toBe('live');

		vi.unstubAllGlobals();
	});

	it('detects test mode from key prefix', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', mockFetch);

		const result = await validateStripeKeys('sk_test_test', 'pk_test_test');
		expect(result.mode).toBe('test');

		vi.unstubAllGlobals();
	});
});

describe('Stripe account status', () => {
	it('returns empty status when no keys', async () => {
		const status = await getStripeAccountStatus(null, null);
		expect(status.accountId).toBeNull();
		expect(status.chargesEnabled).toBe(false);
	});

	it('returns empty status when key missing', async () => {
		const status = await getStripeAccountStatus(null, 'acct_123');
		expect(status.chargesEnabled).toBe(false);
	});

	it('returns empty status when account missing', async () => {
		const status = await getStripeAccountStatus('sk_test_x', null);
		expect(status.accountId).toBeNull();
	});

	it('parses Stripe API response', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				charges_enabled: true,
				payouts_enabled: true,
				details_submitted: true,
			}),
		});
		vi.stubGlobal('fetch', mockFetch);

		const status = await getStripeAccountStatus('sk_test_x', 'acct_123');
		expect(status.accountId).toBe('acct_123');
		expect(status.chargesEnabled).toBe(true);
		expect(status.payoutsEnabled).toBe(true);
		expect(status.detailsSubmitted).toBe(true);

		vi.unstubAllGlobals();
	});

	it('handles Stripe API error gracefully', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
		vi.stubGlobal('fetch', mockFetch);

		const status = await getStripeAccountStatus('sk_test_bad', 'acct_123');
		expect(status.accountId).toBe('acct_123');
		expect(status.chargesEnabled).toBe(false);

		vi.unstubAllGlobals();
	});
});

describe('PayPal credential validation', () => {
	it('returns true for valid credentials', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', mockFetch);

		const valid = await validatePayPalCredentials('AZ_test', 'EL_test', 'sandbox');
		expect(valid).toBe(true);
		expect(mockFetch).toHaveBeenCalledWith(
			'https://api-m.sandbox.paypal.com/v1/oauth2/token',
			expect.any(Object),
		);

		vi.unstubAllGlobals();
	});

	it('returns false for invalid credentials', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
		vi.stubGlobal('fetch', mockFetch);

		const valid = await validatePayPalCredentials('bad', 'bad', 'sandbox');
		expect(valid).toBe(false);

		vi.unstubAllGlobals();
	});

	it('uses production URL for production environment', async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', mockFetch);

		await validatePayPalCredentials('AZ', 'EL', 'production');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://api-m.paypal.com/v1/oauth2/token',
			expect.any(Object),
		);

		vi.unstubAllGlobals();
	});
});

describe('AdapterFactory', () => {
	const mockStore: CredentialStore = {
		get: vi.fn(async () => null),
		getMultiple: vi.fn(async () => ({})),
		set: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
		deleteMultiple: vi.fn(async () => 0),
	};

	it('creates adapter on first call', async () => {
		const factory = createAdapterFactory(async () => 'adapter_instance');
		const result = await factory.get(mockStore);
		expect(result).toBe('adapter_instance');
	});

	it('caches adapter on subsequent calls', async () => {
		let callCount = 0;
		const factory = createAdapterFactory(async () => { callCount++; return 'cached'; });
		await factory.get(mockStore);
		await factory.get(mockStore);
		await factory.get(mockStore);
		expect(callCount).toBe(1);
	});

	it('returns null when init returns null', async () => {
		const factory = createAdapterFactory(async () => null);
		const result = await factory.get(mockStore);
		expect(result).toBeNull();
	});

	it('returns null when disabled', async () => {
		const factory = createAdapterFactory(async () => 'adapter');
		factory.disable();
		const result = await factory.get(mockStore);
		expect(result).toBeNull();
	});

	it('re-initializes after reset', async () => {
		let callCount = 0;
		const factory = createAdapterFactory(async () => { callCount++; return `v${callCount}`; });
		expect(await factory.get(mockStore)).toBe('v1');
		factory.reset();
		expect(await factory.get(mockStore)).toBe('v2');
	});

	it('re-initializes after disable + reset', async () => {
		const factory = createAdapterFactory(async () => 'alive');
		factory.disable();
		expect(await factory.get(mockStore)).toBeNull();
		factory.reset();
		expect(await factory.get(mockStore)).toBe('alive');
	});

	it('passes store to init function', async () => {
		const initFn = vi.fn(async (store: CredentialStore) => {
			await store.get('test_key');
			return 'ok';
		});
		const factory = createAdapterFactory(initFn);
		await factory.get(mockStore);
		expect(mockStore.get).toHaveBeenCalledWith('test_key');
	});
});
