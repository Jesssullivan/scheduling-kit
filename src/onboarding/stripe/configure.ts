/**
 * Stripe key validation.
 */

import type { StripeKeyValidation } from '../types.js';

/** Validate Stripe API keys by calling GET /v1/account. */
export const validateStripeKeys = async (
	secretKey: string,
	publishableKey: string,
): Promise<StripeKeyValidation> => {
	if (!secretKey.startsWith('sk_'))
		return { valid: false, mode: 'test', error: 'Secret key must start with sk_live_ or sk_test_' };
	if (!publishableKey.startsWith('pk_'))
		return { valid: false, mode: 'test', error: 'Publishable key must start with pk_live_ or pk_test_' };

	try {
		const res = await fetch('https://api.stripe.com/v1/account', {
			headers: { 'Authorization': `Bearer ${secretKey}` },
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return {
				valid: false,
				mode: secretKey.startsWith('sk_live_') ? 'live' : 'test',
				error: (err as Record<string, any>).error?.message ?? `HTTP ${res.status}`,
			};
		}
		return { valid: true, mode: secretKey.startsWith('sk_live_') ? 'live' : 'test' };
	} catch {
		return { valid: false, mode: 'test', error: 'Could not connect to Stripe' };
	}
};
