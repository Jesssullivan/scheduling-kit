/**
 * @tummycrypt/scheduling-kit/onboarding
 *
 * Payment provider onboarding — credential validation, OAuth flows,
 * webhook management, and settings-driven adapter factories.
 *
 * Applications implement CredentialStore and EncryptionProvider
 * to provide their own storage backend (PG, Redis, etc.).
 *
 * @example
 * ```typescript
 * import {
 *   buildStripeAuthorizeUrl,
 *   exchangeStripeCode,
 *   validateStripeKeys,
 *   createStripeWebhook,
 *   getStripeAccountStatus,
 *   validatePayPalCredentials,
 *   createPayPalWebhook,
 * } from '@tummycrypt/scheduling-kit/onboarding';
 *
 * // Stripe Connect OAuth
 * const url = buildStripeAuthorizeUrl(clientId, state, redirectUri);
 * const stripeUserId = await exchangeStripeCode(code, platformKey);
 *
 * // Validate keys
 * const { valid, mode } = await validateStripeKeys(sk, pk);
 *
 * // Webhook setup
 * const { webhookId, secret } = await createStripeWebhook(sk, webhookUrl);
 * ```
 */

// Types
export type {
	CredentialStore,
	EncryptionProvider,
	StripeConnectConfig,
	StripeAccountStatus,
	StripeKeyValidation,
	WebhookSetupResult,
	AdapterFactoryConfig,
} from './types.js';

// Stripe
export { buildStripeAuthorizeUrl, exchangeStripeCode } from './stripe/oauth.js';
export { getStripeAccountStatus } from './stripe/account.js';
export { validateStripeKeys } from './stripe/configure.js';
export { createStripeWebhook, deleteStripeWebhooks } from './stripe/webhook.js';

// PayPal
export { validatePayPalCredentials } from './paypal/configure.js';
export { createPayPalWebhook } from './paypal/webhook.js';
