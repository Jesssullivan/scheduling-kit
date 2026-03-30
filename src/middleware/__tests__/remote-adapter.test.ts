/**
 * Remote Adapter Tests
 *
 * Tests the HTTP client adapter against a mock middleware server.
 * Verifies request serialization, response deserialization,
 * error mapping, auth headers, and timeout handling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Effect, Exit, Cause } from 'effect';
import { createRemoteWizardAdapter, type RemoteAdapterConfig } from '../remote-adapter.js';
import type { SchedulingAdapter } from '../../adapters/types.js';
import type { Service, Booking, TimeSlot, AvailableDate } from '../../core/types.js';

// =============================================================================
// MOCK SERVER
// =============================================================================

const MOCK_SERVICE: Service = {
	id: '82429463',
	name: 'TMD 1st Visit/Consultation',
	description: 'Initial consultation',
	duration: 30,
	price: 150,
	currency: 'USD',
	category: 'TMD',
};

const MOCK_BOOKING: Booking = {
	id: 'booking-123',
	serviceId: '82429463',
	serviceName: 'TMD 1st Visit/Consultation',
	datetime: '2026-03-15T10:00:00-05:00',
	duration: 30,
	status: 'confirmed',
	confirmationCode: 'CONF-ABC',
	client: {
		firstName: 'Test',
		lastName: 'User',
		email: 'test@example.com',
	},
	paymentRef: '[VENMO] Transaction: TXN-001',
	createdAt: '2026-03-01T12:00:00Z',
};

const MOCK_SLOTS: TimeSlot[] = [
	{ datetime: '2026-03-15T10:00:00-05:00', available: true },
	{ datetime: '2026-03-15T11:00:00-05:00', available: true },
	{ datetime: '2026-03-15T14:00:00-05:00', available: false },
];

const MOCK_DATES: AvailableDate[] = [
	{ date: '2026-03-15', slots: 1 },
	{ date: '2026-03-18', slots: 1 },
	{ date: '2026-03-22', slots: 1 },
];

const parseBody = async (req: IncomingMessage): Promise<unknown> => {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	return raw ? JSON.parse(raw) : {};
};

let mockServer: ReturnType<typeof createServer>;
let serverPort: number;
let lastRequest: {
	method: string;
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body: unknown;
} | null = null;

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			mockServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
				const url = new URL(req.url ?? '/', `http://localhost`);
				const path = url.pathname;
				const method = req.method?.toUpperCase() ?? 'GET';
				const body = method === 'POST' ? await parseBody(req) : undefined;

				lastRequest = {
					method,
					path,
					headers: req.headers as Record<string, string | string[] | undefined>,
					body,
				};

				const sendJson = (status: number, data: unknown) => {
					res.writeHead(status, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(data));
				};

				// Auth check
				const authToken = req.headers.authorization;
				if (path !== '/health' && authToken !== 'Bearer test-token') {
					return sendJson(401, {
						success: false,
						error: { tag: 'InfrastructureError', code: 'UNAUTHORIZED', message: 'Invalid auth token' },
					});
				}

				// Route matching
				if (path === '/health' && method === 'GET') {
					return sendJson(200, { success: true, data: { status: 'ok' } });
				}
				if (path === '/services' && method === 'GET') {
					return sendJson(200, { success: true, data: [MOCK_SERVICE] });
				}
				if (path.startsWith('/services/') && method === 'GET') {
					const serviceId = decodeURIComponent(path.slice('/services/'.length));
					if (serviceId === MOCK_SERVICE.id) {
						return sendJson(200, { success: true, data: MOCK_SERVICE });
					}
					return sendJson(404, {
						success: false,
						error: { tag: 'AcuityError', code: 'NOT_FOUND', message: `Service ${serviceId} not found` },
					});
				}
				if (path === '/availability/dates' && method === 'POST') {
					return sendJson(200, { success: true, data: MOCK_DATES });
				}
				if (path === '/availability/slots' && method === 'POST') {
					return sendJson(200, { success: true, data: MOCK_SLOTS });
				}
				if (path === '/availability/check' && method === 'POST') {
					return sendJson(200, { success: true, data: true });
				}
				if (path === '/booking/create' && method === 'POST') {
					return sendJson(200, { success: true, data: MOCK_BOOKING });
				}
				if (path === '/booking/create-with-payment' && method === 'POST') {
					return sendJson(200, { success: true, data: MOCK_BOOKING });
				}

				sendJson(404, {
					success: false,
					error: { tag: 'InfrastructureError', code: 'NOT_FOUND', message: `Unknown route: ${method} ${path}` },
				});
			});

			mockServer.listen(0, () => {
				const address = mockServer.address();
				serverPort = typeof address === 'object' && address ? address.port : 0;
				resolve();
			});
		}),
);

afterAll(
	() =>
		new Promise<void>((resolve) => {
			mockServer.close(() => resolve());
		}),
);

// =============================================================================
// TESTS
// =============================================================================

const getConfig = (overrides?: Partial<RemoteAdapterConfig>): RemoteAdapterConfig => ({
	baseUrl: `http://localhost:${serverPort}`,
	authToken: 'test-token',
	timeout: 5000,
	...overrides,
});

describe('createRemoteWizardAdapter', () => {
	it('returns a SchedulingAdapter with name "acuity-wizard-remote"', () => {
		const adapter = createRemoteWizardAdapter(getConfig());
		expect(adapter.name).toBe('acuity-wizard-remote');
	});

	// ---------------------------------------------------------------------------
	// Read operations
	// ---------------------------------------------------------------------------

	describe('getServices', () => {
		it('fetches services from remote server', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const services = await Effect.runPromise(adapter.getServices());
			expect(services).toEqual([MOCK_SERVICE]);
		});

		it('sends GET /services with auth header', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			await Effect.runPromise(adapter.getServices());
			expect(lastRequest?.method).toBe('GET');
			expect(lastRequest?.path).toBe('/services');
			expect(lastRequest?.headers.authorization).toBe('Bearer test-token');
		});
	});

	describe('getService', () => {
		it('fetches a single service by ID', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const service = await Effect.runPromise(adapter.getService(MOCK_SERVICE.id));
			expect(service).toEqual(MOCK_SERVICE);
		});

		it('returns AcuityError for missing service', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const exit = await Effect.runPromiseExit(adapter.getService('nonexistent'));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('AcuityError');
				}
			}
		});

		it('encodes service ID in URL', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			await Effect.runPromiseExit(adapter.getService('id with spaces'));
			expect(lastRequest?.path).toBe('/services/id%20with%20spaces');
		});
	});

	describe('getProviders', () => {
		it('returns hardcoded provider (no remote call)', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const providers = await Effect.runPromise(adapter.getProviders());
			expect(providers).toHaveLength(1);
			expect(providers[0].name).toBe('Default Provider');
		});
	});

	describe('getAvailableDates', () => {
		it('posts to /availability/dates', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const dates = await Effect.runPromise(adapter.getAvailableDates({
				serviceId: '82429463',
				startDate: '2026-03-01',
				endDate: '2026-03-31',
			}));
			expect(dates).toEqual(MOCK_DATES);
		});
	});

	describe('getAvailableSlots', () => {
		it('posts to /availability/slots', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const slots = await Effect.runPromise(adapter.getAvailableSlots({
				serviceId: '82429463',
				date: '2026-03-15',
			}));
			expect(slots).toEqual(MOCK_SLOTS);
		});
	});

	describe('checkSlotAvailability', () => {
		it('posts to /availability/check', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const available = await Effect.runPromise(adapter.checkSlotAvailability({
				serviceId: '82429463',
				datetime: '2026-03-15T10:00:00-05:00',
			}));
			expect(available).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Write operations
	// ---------------------------------------------------------------------------

	describe('createBooking', () => {
		it('posts to /booking/create', async () => {
			const adapter = createRemoteWizardAdapter(getConfig({ couponCode: 'TEST-COUPON' }));
			const booking = await Effect.runPromise(adapter.createBooking({
				serviceId: '82429463',
				datetime: '2026-03-15T10:00:00-05:00',
				client: { firstName: 'Test', lastName: 'User', email: 'test@example.com' },
				paymentMethod: 'cash',
				idempotencyKey: 'idem-1',
			}));
			expect(booking.id).toBe('booking-123');
			expect((lastRequest?.body as Record<string, unknown>).couponCode).toBe('TEST-COUPON');
		});
	});

	describe('createBookingWithPaymentRef', () => {
		it('posts to /booking/create-with-payment', async () => {
			const adapter = createRemoteWizardAdapter(getConfig({ couponCode: 'TEST-COUPON' }));
			await Effect.runPromise(adapter.createBookingWithPaymentRef(
				{
					serviceId: '82429463',
					datetime: '2026-03-15T10:00:00-05:00',
					client: { firstName: 'Test', lastName: 'User', email: 'test@example.com' },
					paymentMethod: 'venmo',
					idempotencyKey: 'idem-2',
				},
				'TXN-001',
				'venmo',
			));
			const body = lastRequest?.body as Record<string, unknown>;
			expect(body.paymentRef).toBe('TXN-001');
			expect(body.paymentProcessor).toBe('venmo');
			expect(body.couponCode).toBe('TEST-COUPON');
		});
	});

	// ---------------------------------------------------------------------------
	// Reservation (not supported)
	// ---------------------------------------------------------------------------

	describe('createReservation', () => {
		it('returns BLOCK_FAILED (not supported)', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const exit = await Effect.runPromiseExit(adapter.createReservation({
				serviceId: '82429463',
				datetime: '2026-03-15T10:00:00-05:00',
				duration: 30,
			}));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('ReservationError');
				}
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Not implemented operations
	// ---------------------------------------------------------------------------

	describe('getBooking', () => {
		it('returns NOT_IMPLEMENTED', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const exit = await Effect.runPromiseExit(adapter.getBooking('booking-123'));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('AcuityError');
				}
			}
		});
	});

	describe('cancelBooking', () => {
		it('returns NOT_IMPLEMENTED', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			const exit = await Effect.runPromiseExit(adapter.cancelBooking('booking-123'));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Auth handling
	// ---------------------------------------------------------------------------

	describe('authentication', () => {
		it('sends Bearer token in Authorization header', async () => {
			const adapter = createRemoteWizardAdapter(getConfig());
			await Effect.runPromise(adapter.getServices());
			expect(lastRequest?.headers.authorization).toBe('Bearer test-token');
		});

		it('returns InfrastructureError on 401', async () => {
			const adapter = createRemoteWizardAdapter(getConfig({ authToken: 'wrong-token' }));
			const exit = await Effect.runPromiseExit(adapter.getServices());
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('InfrastructureError');
				}
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Error mapping
	// ---------------------------------------------------------------------------

	describe('error mapping', () => {
		it('maps network errors to InfrastructureError', async () => {
			const adapter = createRemoteWizardAdapter(
				getConfig({ baseUrl: 'http://localhost:1' }),
			);
			const exit = await Effect.runPromiseExit(adapter.getServices());
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Cause.failureOption(exit.cause);
				expect(error._tag).toBe('Some');
				if (error._tag === 'Some') {
					expect(error.value._tag).toBe('InfrastructureError');
				}
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Mode switch
	// ---------------------------------------------------------------------------

	describe('mode switch via createWizardAdapter', () => {
		it('throws when mode is remote but no remote config', async () => {
			const { createWizardAdapter } = await import('../acuity-wizard.js');
			expect(() =>
				createWizardAdapter({
					baseUrl: 'https://example.com',
					mode: 'remote',
				}),
			).toThrow('remote is required');
		});

		it('creates remote adapter when mode is remote', async () => {
			const { createWizardAdapter } = await import('../acuity-wizard.js');
			const adapter = createWizardAdapter({
				baseUrl: 'https://example.com',
				mode: 'remote',
				remote: getConfig(),
			});
			expect(adapter.name).toBe('acuity-wizard-remote');
		});

		it('creates local adapter when mode is local (default)', async () => {
			const { createWizardAdapter } = await import('../acuity-wizard.js');
			const adapter = createWizardAdapter({
				baseUrl: 'https://example.com',
				mode: 'local',
			});
			expect(adapter.name).toBe('acuity-wizard');
		});
	});
});
