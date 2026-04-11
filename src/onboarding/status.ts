/**
 * Provider status helpers for UI consumption.
 *
 * Pure functions that compute setup step completion from state.
 * Framework-agnostic — apps use these to drive their own UI.
 */

export type ProviderStatus = 'connected' | 'incomplete' | 'not_configured';

export interface SetupStep {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly complete: boolean;
	readonly current: boolean;
}

export interface StripeState {
	readonly platformConfigured: boolean;
	readonly accountId: string | null;
	readonly chargesEnabled: boolean;
	readonly payoutsEnabled: boolean;
	readonly detailsSubmitted: boolean;
	readonly webhookConfigured: boolean;
}

export interface PayPalState {
	readonly platformConfigured: boolean;
	readonly payeeEmail: string | null;
}

export const getStripeStatus = (state: StripeState): ProviderStatus => {
	if (state.chargesEnabled && state.payoutsEnabled) return 'connected';
	if (state.platformConfigured || state.accountId) return 'incomplete';
	return 'not_configured';
};

export const getPayPalStatus = (state: PayPalState): ProviderStatus => {
	if (state.platformConfigured && state.payeeEmail) return 'connected';
	if (state.platformConfigured) return 'incomplete';
	return 'not_configured';
};

export const getStripeSetupSteps = (state: StripeState): SetupStep[] => {
	const platformDone = state.platformConfigured;
	const accountDone = !!(state.accountId && state.detailsSubmitted);
	const webhookDone = state.webhookConfigured;

	return [
		{
			id: 'platform',
			label: 'Platform Keys',
			description: 'Enter your Stripe API keys to enable payment processing.',
			complete: platformDone,
			current: !platformDone,
		},
		{
			id: 'connect',
			label: 'Link Your Account',
			description: 'Connect your Stripe account to receive payments directly.',
			complete: accountDone,
			current: platformDone && !accountDone,
		},
		{
			id: 'webhook',
			label: 'Payment Notifications',
			description: 'Set up automatic payment status updates.',
			complete: webhookDone,
			current: platformDone && accountDone && !webhookDone,
		},
	];
};

export const getPayPalSetupSteps = (state: PayPalState): SetupStep[] => {
	const platformDone = state.platformConfigured;
	const emailDone = !!state.payeeEmail;

	return [
		{
			id: 'platform',
			label: 'Platform Credentials',
			description: 'Enter your PayPal API credentials to enable Venmo payments.',
			complete: platformDone,
			current: !platformDone,
		},
		{
			id: 'email',
			label: 'Your PayPal Email',
			description: 'Payments from clients will be routed to this account.',
			complete: emailDone,
			current: platformDone && !emailDone,
		},
	];
};

/** Count completed steps across all providers. */
export const getOverallProgress = (stripe: StripeState, paypal: PayPalState): { complete: number; total: number } => {
	const stripeSteps = getStripeSetupSteps(stripe);
	const paypalSteps = getPayPalSetupSteps(paypal);
	const all = [...stripeSteps, ...paypalSteps];
	return {
		complete: all.filter((s) => s.complete).length,
		total: all.length,
	};
};
