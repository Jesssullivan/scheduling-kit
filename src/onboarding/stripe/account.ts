/**
 * Stripe Connect account status checker.
 */

import type { StripeAccountStatus } from '../types.js';

const EMPTY_STATUS: StripeAccountStatus = {
	accountId: null,
	chargesEnabled: false,
	payoutsEnabled: false,
	detailsSubmitted: false,
};

/** Check a Stripe Connect account's onboarding status. */
export const getStripeAccountStatus = async (
	secretKey: string | null,
	accountId: string | null,
): Promise<StripeAccountStatus> => {
	if (!secretKey || !accountId) return EMPTY_STATUS;

	try {
		const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
			headers: { 'Authorization': `Bearer ${secretKey}` },
		});
		if (!res.ok) return { ...EMPTY_STATUS, accountId };

		const account = await res.json();
		return {
			accountId,
			chargesEnabled: account.charges_enabled ?? false,
			payoutsEnabled: account.payouts_enabled ?? false,
			detailsSubmitted: account.details_submitted ?? false,
		};
	} catch {
		return { ...EMPTY_STATUS, accountId };
	}
};
