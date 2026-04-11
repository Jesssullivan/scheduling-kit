/**
 * Settings-driven adapter factory pattern.
 *
 * Creates a singleton adapter that reads configuration from a
 * CredentialStore. Handles lazy init, promise dedup, reset, and disable.
 *
 * @example
 * ```typescript
 * const getStripeAdapter = createAdapterFactory(
 *   async (store) => {
 *     const settings = await store.getMultiple(['stripe_secret_key', 'stripe_publishable_key']);
 *     if (!settings.stripe_secret_key) return null;
 *     return createStripeAdapter({ type: 'stripe', secretKey: settings.stripe_secret_key, ... });
 *   }
 * );
 *
 * const adapter = await getStripeAdapter.get(myCredentialStore);
 * getStripeAdapter.reset(); // re-read from store on next call
 * getStripeAdapter.disable(); // return null until reset
 * ```
 */

import type { CredentialStore } from './types.js';

export interface AdapterFactory<T> {
	get(store: CredentialStore): Promise<T | null>;
	reset(): void;
	disable(): void;
}

/**
 * Create a settings-driven adapter factory with singleton caching.
 *
 * @param init — async function that reads from store and returns an adapter (or null)
 */
export const createAdapterFactory = <T>(
	init: (store: CredentialStore) => Promise<T | null>,
): AdapterFactory<T> => {
	let adapter: T | null = null;
	let initPromise: Promise<T | null> | null = null;
	let disabled = false;

	return {
		get: async (store) => {
			if (disabled) return null;
			if (adapter) return adapter;
			if (initPromise) return initPromise;

			initPromise = (async () => {
				adapter = await init(store);
				initPromise = null;
				return adapter;
			})();

			return initPromise;
		},
		reset: () => { adapter = null; initPromise = null; disabled = false; },
		disable: () => { adapter = null; initPromise = null; disabled = true; },
	};
};
