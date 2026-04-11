/**
 * Onboarding interfaces — app-provided abstractions for credential
 * storage, encryption, and payment provider management.
 *
 * scheduling-kit defines the contracts. Applications implement them
 * with their chosen infrastructure (PG, Redis, Vault, etc.).
 */

// ---------------------------------------------------------------------------
// Credential Storage
// ---------------------------------------------------------------------------

/**
 * App-provided key-value store for payment credentials.
 * scheduling-kit reads/writes through this interface — it doesn't
 * know about Postgres, Redis, or any specific database.
 */
export interface CredentialStore {
	get(key: string): Promise<string | null>;
	getMultiple(keys: string[]): Promise<Record<string, string | null>>;
	set(key: string, value: string, userId?: string): Promise<void>;
	delete(key: string): Promise<void>;
	deleteMultiple(keys: string[]): Promise<number>;
}

/**
 * App-provided encryption for sensitive credentials.
 * Values are encrypted before storage and decrypted on retrieval.
 */
export interface EncryptionProvider {
	encrypt(plaintext: string): string;
	decrypt(stored: string): string;
	shouldEncrypt(key: string): boolean;
}

// ---------------------------------------------------------------------------
// Stripe Connect
// ---------------------------------------------------------------------------

export interface StripeConnectConfig {
	readonly clientId: string;
	readonly platformKey: string;
	readonly redirectUri: string;
}

export interface StripeAccountStatus {
	readonly accountId: string | null;
	readonly chargesEnabled: boolean;
	readonly payoutsEnabled: boolean;
	readonly detailsSubmitted: boolean;
}

export interface StripeKeyValidation {
	readonly valid: boolean;
	readonly mode: 'live' | 'test';
	readonly error?: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookSetupResult {
	readonly webhookId: string;
	readonly secret: string;
	readonly url: string;
}

// ---------------------------------------------------------------------------
// Adapter Factory
// ---------------------------------------------------------------------------

/**
 * Configuration for settings-driven adapter factories.
 * The store provides credentials, the factory creates the adapter.
 */
export interface AdapterFactoryConfig {
	readonly store: CredentialStore;
	readonly encryption?: EncryptionProvider;
}
