/**
 * Stripe Connect OAuth helpers.
 *
 * Pure functions for building authorize URLs and exchanging
 * authorization codes. No framework dependency.
 */

import type { StripeConnectConfig } from '../types.js';

/** Build the Stripe Connect OAuth authorize URL. */
export const buildStripeAuthorizeUrl = (
	clientId: string,
	state: string,
	redirectUri: string,
): string => {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		scope: 'read_write',
		redirect_uri: redirectUri,
		state,
	});
	return `https://connect.stripe.com/oauth/authorize?${params}`;
};

/**
 * Exchange an authorization code for a stripe_user_id.
 * Uses the platform's secret key as client_secret.
 * Returns the connected account ID (acct_...).
 */
export const exchangeStripeCode = async (
	code: string,
	platformKey: string,
): Promise<string> => {
	const res = await fetch('https://connect.stripe.com/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_secret: platformKey,
		}),
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(
			`Stripe OAuth exchange failed: ${(err as Record<string, string>).error_description || res.status}`,
		);
	}

	const data = await res.json();
	return data.stripe_user_id;
};
