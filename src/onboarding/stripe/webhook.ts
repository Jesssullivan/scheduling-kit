/**
 * Stripe webhook management.
 */

import type { WebhookSetupResult } from '../types.js';

const DEFAULT_EVENTS = [
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'payment_intent.canceled',
	'charge.refunded',
	'charge.refund.updated',
];

/** Delete existing webhooks matching a URL pattern. Returns count deleted. */
export const deleteStripeWebhooks = async (
	secretKey: string,
	urlPattern: string,
): Promise<number> => {
	const headers = { Authorization: `Bearer ${secretKey}` };
	const listRes = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', { headers });
	if (!listRes.ok) return 0;

	const { data } = await listRes.json();
	let deleted = 0;
	for (const wh of data ?? []) {
		if (wh.url?.includes(urlPattern)) {
			const delRes = await fetch(`https://api.stripe.com/v1/webhook_endpoints/${wh.id}`, {
				method: 'DELETE',
				headers,
			});
			if (delRes.ok) deleted++;
		}
	}
	return deleted;
};

/** Create a Stripe webhook endpoint. Returns the signing secret (only available at creation). */
export const createStripeWebhook = async (
	secretKey: string,
	webhookUrl: string,
	events: string[] = DEFAULT_EVENTS,
): Promise<WebhookSetupResult> => {
	const headers = {
		Authorization: `Bearer ${secretKey}`,
		'Content-Type': 'application/x-www-form-urlencoded',
	};

	const params = new URLSearchParams();
	params.append('url', webhookUrl);
	for (const evt of events) params.append('enabled_events[]', evt);
	params.append('description', 'scheduling-kit auto-setup');

	const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
		method: 'POST',
		headers,
		body: params.toString(),
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(`Stripe webhook creation failed: ${(err as any).error?.message ?? res.status}`);
	}

	const webhook = await res.json();
	return {
		webhookId: webhook.id,
		secret: webhook.secret,
		url: webhookUrl,
	};
};
