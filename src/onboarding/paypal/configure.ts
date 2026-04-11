/**
 * PayPal credential validation.
 */

/** Validate PayPal credentials by fetching an OAuth token. */
export const validatePayPalCredentials = async (
	clientId: string,
	clientSecret: string,
	environment: 'sandbox' | 'production' = 'sandbox',
): Promise<boolean> => {
	const baseUrl = environment === 'production'
		? 'https://api-m.paypal.com'
		: 'https://api-m.sandbox.paypal.com';

	const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});

	return res.ok;
};
