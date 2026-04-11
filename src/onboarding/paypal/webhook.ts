/**
 * PayPal webhook management.
 */

const DEFAULT_EVENTS = [
	'PAYMENT.CAPTURE.COMPLETED',
	'PAYMENT.CAPTURE.DENIED',
	'PAYMENT.CAPTURE.REFUNDED',
	'CHECKOUT.ORDER.APPROVED',
];

/** Create a PayPal webhook. Returns webhook ID or null if creation fails (sandbox may not support HTTPS). */
export const createPayPalWebhook = async (
	clientId: string,
	clientSecret: string,
	environment: 'sandbox' | 'production',
	webhookUrl: string,
	events: string[] = DEFAULT_EVENTS,
): Promise<string | null> => {
	const baseUrl = environment === 'production'
		? 'https://api-m.paypal.com'
		: 'https://api-m.sandbox.paypal.com';

	// Get OAuth token
	const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});

	if (!tokenRes.ok) return null;
	const { access_token } = await tokenRes.json();

	// Create webhook
	const createRes = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			url: webhookUrl,
			event_types: events.map((name) => ({ name })),
		}),
	});

	if (!createRes.ok) return null;
	const webhook = await createRes.json();
	return webhook.id;
};
