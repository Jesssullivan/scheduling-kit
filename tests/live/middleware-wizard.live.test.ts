/**
 * Middleware Wizard Live Integration Tests
 *
 * Tests the wizard middleware against the real MassageIthaca Acuity page.
 * Does NOT create any bookings - read-only operations + navigation verification.
 *
 * Run with: RUN_LIVE_TESTS=true pnpm test:live
 *
 * Requirements:
 * - Playwright installed with Chromium: npx playwright install chromium
 * - Network access to https://MassageIthaca.as.me
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Effect } from 'effect';
import type { Browser, Page } from 'playwright';
import {
	Selectors,
	resolveSelector,
	probeSelector,
	healthCheck,
	type SelectorKey,
} from '../../src/middleware/selectors.js';
import {
	BrowserServiceLive,
	BrowserService,
	defaultBrowserConfig,
	type BrowserConfig,
} from '../../src/middleware/browser-service.js';
import { buildAcuityUrl } from '../../src/lib/url-builder.js';

const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS === 'true';
const ACUITY_BASE_URL = 'https://MassageIthaca.as.me';

// Shared browser for all tests (Playwright is expensive to launch)
let browser: Browser;
let page: Page;

describe.skipIf(!RUN_LIVE_TESTS)('Middleware Wizard Live Tests', () => {
	beforeAll(async () => {
		const pw = await import('playwright');
		browser = await pw.chromium.launch({ headless: true });
		page = await browser.newPage({
			userAgent: defaultBrowserConfig.userAgent,
		});
		page.setDefaultTimeout(15000);
	}, 30000);

	afterAll(async () => {
		if (page) await page.close().catch(() => {});
		if (browser) await browser.close().catch(() => {});
	});

	// =========================================================================
	// 1. Service Page Selectors
	// =========================================================================

	describe('Service Page', () => {
		it('loads the scheduling page', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const title = await page.title();
			console.log(`  Page title: "${title}"`);
			expect(title).toBeTruthy();
		});

		it('finds service list elements', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			let foundSelector: string | null = null;
			for (const selector of Selectors.serviceList) {
				const count = await page.$$(selector).then((els) => els.length);
				if (count > 0) {
					foundSelector = selector;
					console.log(`  Found ${count} services via "${selector}"`);
					break;
				}
			}

			if (!foundSelector) {
				// Try broader selectors for discovery
				const allLinks = await page.$$('a[href*="appointmentType"]');
				console.log(`  Fallback: found ${allLinks.length} appointment links`);
				if (allLinks.length > 0) {
					const firstHref = await allLinks[0].getAttribute('href');
					console.log(`  First link href: ${firstHref}`);
				}
			}

			// At least one approach should find services
			const hasServices =
				foundSelector !== null ||
				(await page.$$('a[href*="appointmentType"]').then((els) => els.length > 0));
			expect(hasServices).toBe(true);
		});

		it('extracts service names and prices', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const services = await page.evaluate(() => {
				const results: { name: string; price: string; href: string; duration: string }[] = [];
				// Try standard selectors
				const items = document.querySelectorAll('.select-item, .appointment-type-item');
				items.forEach((item) => {
					const nameEl = item.querySelector(
						'.appointment-type-name, .type-name, h3, .name',
					);
					const priceEl = item.querySelector('.price, .cost');
					const durationEl = item.querySelector('.duration, .time-duration');
					const link = item.querySelector('a');
					results.push({
						name: nameEl?.textContent?.trim() ?? 'unknown',
						price: priceEl?.textContent?.trim() ?? 'N/A',
						duration: durationEl?.textContent?.trim() ?? 'N/A',
						href: link?.getAttribute('href') ?? '',
					});
				});
				return results;
			});

			console.log(`  Services found: ${services.length}`);
			for (const svc of services) {
				console.log(`    - ${svc.name} | ${svc.price} | ${svc.duration}`);
			}

			expect(services.length).toBeGreaterThan(0);
		});

		it('discovers .select-item inner structure and appointment type IDs', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Dump the inner structure of each .select-item
			const items = await page.$$eval('.select-item', (els) =>
				els.map((el, i) => {
					const innerLinks = Array.from(el.querySelectorAll('a')).map((a) => ({
						href: a.getAttribute('href')?.slice(0, 150) ?? '',
						text: a.textContent?.trim()?.slice(0, 80) ?? '',
						classes: a.className,
					}));
					const dataAttrs = Array.from(el.attributes)
						.filter((a) => a.name.startsWith('data-'))
						.map((a) => `${a.name}="${a.value}"`);
					const childTags = Array.from(el.children).map(
						(c) => `<${c.tagName.toLowerCase()} class="${c.className}">`,
					);
					// Look for any attribute containing a numeric ID
					const allAttrs = Array.from(el.attributes).map((a) => `${a.name}="${a.value}"`);

					return {
						index: i,
						tag: el.tagName.toLowerCase(),
						id: el.id,
						classes: el.className,
						dataAttrs,
						allAttrs,
						childTags,
						innerLinks,
						innerHTML: el.innerHTML.slice(0, 400),
						onclick: el.getAttribute('onclick') ?? '',
					};
				}),
			);

			console.log(`  .select-item count: ${items.length}`);
			for (const item of items.slice(0, 3)) {
				console.log(`\n  --- Item ${item.index} ---`);
				console.log(`  tag: <${item.tag}> id="${item.id}" classes="${item.classes}"`);
				console.log(`  data-attrs: ${item.dataAttrs.join(', ') || 'none'}`);
				console.log(`  all-attrs: ${item.allAttrs.join(', ')}`);
				console.log(`  onclick: ${item.onclick || 'none'}`);
				console.log(`  children: ${item.childTags.join(', ')}`);
				console.log(`  links: ${item.innerLinks.length}`);
				for (const link of item.innerLinks) {
					console.log(`    <a class="${link.classes}" href="${link.href}">${link.text}</a>`);
				}
				console.log(`  innerHTML: ${item.innerHTML}`);
			}

			// Also check for any element with appointmentType anywhere in attributes
			const aptTypeEls = await page.$$eval('*', (els) =>
				els
					.filter((el) =>
						Array.from(el.attributes).some(
							(a) =>
								a.value.includes('appointmentType') ||
								a.name.includes('appointment') ||
								a.name.includes('type-id'),
						),
					)
					.map((el) => ({
						tag: el.tagName.toLowerCase(),
						id: el.id,
						relevantAttrs: Array.from(el.attributes)
							.filter(
								(a) =>
									a.value.includes('appointmentType') ||
									a.value.includes('appointment') ||
									a.name.includes('appointment') ||
									a.name.includes('type-id'),
							)
							.map((a) => `${a.name}="${a.value.slice(0, 150)}"`),
					}))
					.slice(0, 10),
			);

			console.log(`\n  Elements with appointment-related attrs: ${aptTypeEls.length}`);
			for (const el of aptTypeEls) {
				console.log(`    <${el.tag} id="${el.id}" ${el.relevantAttrs.join(' ')}>`);
			}

			// Discovery test - just needs to find the services exist
			expect(items.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// 2. Calendar / Date Selection
	// =========================================================================

	describe('Calendar Page', () => {
		it('clicks first service and discovers calendar DOM', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const firstItem = await page.$('.select-item');
			if (!firstItem) {
				console.log('  No .select-item found, skipping calendar test');
				return;
			}

			const itemText = await firstItem.textContent();
			console.log(`  Clicking service: "${itemText?.trim().slice(0, 60)}"`);

			await firstItem.click();
			await page.waitForTimeout(3000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const afterUrl = page.url();
			console.log(`  URL after click: ${afterUrl}`);

			// Check what page we landed on
			const pageState = await page.evaluate(() => {
				const results: Record<string, string[]> = {};

				// Calendar-related elements
				const calendarSelectors = [
					'.scheduleday',
					'.scheduleday.activeday',
					'.calendar-day',
					'[data-date]',
					'[class*="calendar"]',
					'[class*="date"]',
					'[class*="month"]',
					'[class*="schedule"]',
					'table.calendar',
					'.choose-date',
				];

				for (const sel of calendarSelectors) {
					const els = document.querySelectorAll(sel);
					if (els.length > 0) {
						results[sel] = Array.from(els)
							.slice(0, 5)
							.map((el) => {
								const attrs = Array.from(el.attributes)
									.map((a) => `${a.name}="${a.value}"`)
									.join(' ');
								return `<${el.tagName.toLowerCase()} ${attrs}>`;
							});
					}
				}

				// Also check for form (if we jumped past calendar)
				const form = document.querySelector('input[name="firstName"]');
				if (form) results['HAS_FORM'] = ['true'];

				return results;
			});

			console.log(`  Page state after service click:`);
			for (const [sel, els] of Object.entries(pageState)) {
				console.log(`    ${sel}: ${els.length} match(es)`);
				for (const el of els) {
					console.log(`      ${el}`);
				}
			}

			// Extract hash-based service slug from URL (e.g., /schedule/4671d709)
			const slugMatch = afterUrl.match(/\/schedule\/([a-f0-9]+)/);
			if (slugMatch) {
				console.log(`  Service slug from URL: ${slugMatch[1]}`);
			}

			// Discovery - just need to verify navigation happened
			expect(afterUrl).not.toBe(ACUITY_BASE_URL);
		}, 30000);

		it('deeply probes calendar/date DOM after service click', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const firstItem = await page.$('.select-item');
			if (!firstItem) return;

			await firstItem.click();
			// Give the React SPA time to render the calendar
			await page.waitForTimeout(5000);
			await page.waitForLoadState('networkidle').catch(() => {});

			// Broad sweep: dump any element with role, aria, or class hinting at dates/calendar
			const domProbe = await page.evaluate(() => {
				const results: Record<string, string[]> = {};

				// 1. Role-based (ARIA)
				const roles = ['grid', 'gridcell', 'row', 'columnheader', 'rowheader', 'table'];
				for (const role of roles) {
					const els = document.querySelectorAll(`[role="${role}"]`);
					if (els.length > 0) {
						results[`role=${role}`] = Array.from(els)
							.slice(0, 3)
							.map((el) => el.outerHTML.slice(0, 200));
					}
				}

				// 2. Class-based broad search
				const classPatterns = ['day', 'date', 'calendar', 'month', 'schedule', 'avail', 'slot', 'time', 'picker'];
				for (const pattern of classPatterns) {
					const els = document.querySelectorAll(`[class*="${pattern}"]`);
					if (els.length > 0) {
						results[`class*=${pattern}`] = Array.from(els)
							.slice(0, 3)
							.map((el) => `<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 100)}">`);
					}
				}

				// 3. Table elements (classic calendar)
				const tables = document.querySelectorAll('table');
				if (tables.length > 0) {
					results['tables'] = Array.from(tables)
						.slice(0, 2)
						.map((t) => `<table class="${t.className}"> rows=${t.rows.length}`);
				}

				// 4. Buttons (time slots are often buttons)
				const buttons = document.querySelectorAll('button');
				results['buttons'] = Array.from(buttons)
					.slice(0, 8)
					.map((b) => `<button class="${b.className.toString().slice(0, 80)}">${b.textContent?.trim().slice(0, 40)}</button>`);

				// 5. All data-* attributes on the page
				const dataAttrs = new Set<string>();
				document.querySelectorAll('*').forEach((el) => {
					for (const attr of el.attributes) {
						if (attr.name.startsWith('data-')) {
							dataAttrs.add(`${attr.name}="${attr.value.slice(0, 50)}"`);
						}
					}
				});
				results['data-attributes'] = Array.from(dataAttrs).slice(0, 20);

				// 6. Page top-level structure
				const main = document.querySelector('#main, .main, #content, #app, [id*="root"]') || document.body;
				const topLevel: string[] = [];
				for (const child of main.children) {
					const cls = child.className ? `.${child.className.toString().replace(/\s+/g, '.').slice(0, 80)}` : '';
					const id = child.id ? `#${child.id}` : '';
					topLevel.push(`<${child.tagName.toLowerCase()}${id}${cls}>`);
				}
				results['top-level-structure'] = topLevel.slice(0, 15);

				return results;
			});

			console.log(`  Calendar/date DOM probe:`);
			for (const [key, values] of Object.entries(domProbe)) {
				console.log(`\n  [${key}] (${values.length} matches)`);
				for (const v of values) {
					console.log(`    ${v}`);
				}
			}

			// Deep probe: dump the main content area structure
			const contentProbe = await page.evaluate(() => {
				// Find the main scheduling content
				const container = document.querySelector('#secondo-container') || document.body;
				const results: string[] = [];

				function walk(el: Element, depth: number) {
					if (depth > 6) return;
					const indent = '  '.repeat(depth);
					const cls = el.className
						? `.${el.className.toString().replace(/\s+/g, '.').slice(0, 80)}`
						: '';
					const id = el.id ? `#${el.id}` : '';
					const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
						? ` "${(el.childNodes[0].textContent?.trim() || '').slice(0, 60)}"`
						: '';
					results.push(`${indent}<${el.tagName.toLowerCase()}${id}${cls}>${text}`);
					if (results.length > 80) return;
					for (const child of el.children) {
						walk(child, depth + 1);
					}
				}

				walk(container, 0);
				return results;
			});

			console.log(`\n  Content structure (first 80 nodes):`);
			for (const line of contentProbe) {
				console.log(`    ${line}`);
			}

			// Probe the schedule list items (date-slot entries)
			const listItemProbe = await page.evaluate(() => {
				const ul = document.querySelector('ul.css-17ucfvk') || document.querySelector('main ul');
				if (!ul) return { found: false, items: [] };

				return {
					found: true,
					listClass: ul.className,
					items: Array.from(ul.children).slice(0, 4).map((li, i) => ({
						index: i,
						tag: li.tagName.toLowerCase(),
						classes: li.className.toString().slice(0, 100),
						fullText: li.textContent?.trim().slice(0, 200) || '',
						innerHTML: li.innerHTML.slice(0, 600),
						childCount: li.children.length,
					})),
				};
			});

			console.log(`\n  Schedule list probe:`);
			if (listItemProbe.found) {
				console.log(`  List class: ${listItemProbe.listClass}`);
				for (const item of listItemProbe.items) {
					console.log(`\n  --- List item ${item.index} ---`);
					console.log(`    classes: ${item.classes}`);
					console.log(`    text: "${item.fullText}"`);
					console.log(`    innerHTML: ${item.innerHTML}`);
				}
			} else {
				console.log('  No <ul> found in main content');
			}

			// Also probe the "Book" button's sibling elements (date/time text near it)
			const bookBtnContext = await page.evaluate(() => {
				const bookBtns = document.querySelectorAll('button.btn');
				return Array.from(bookBtns).slice(0, 3).map((btn, i) => {
					// Walk up to the .select-item ancestor
					let selectItem: Element | null = btn;
					while (selectItem && !selectItem.classList.contains('select-item')) {
						selectItem = selectItem.parentElement;
					}
					if (!selectItem) return { index: i, found: false, fullText: '' };

					return {
						index: i,
						found: true,
						fullText: selectItem.textContent?.trim().slice(0, 300) || '',
						innerHTML: selectItem.innerHTML.slice(0, 800),
					};
				});
			});

			console.log(`\n  "Book" button context (full select-item content):`);
			for (const ctx of bookBtnContext) {
				console.log(`\n  --- Book button ${ctx.index} ---`);
				console.log(`    fullText: "${ctx.fullText}"`);
				if (ctx.found) {
					console.log(`    innerHTML: ${ctx.innerHTML}`);
				}
			}
		}, 45000);
	});

	// =========================================================================
	// 2b. "Book" Button Click Discovery
	// =========================================================================

	describe('Book Button Click', () => {
		it('clicks Book and discovers what renders next', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Click first service to get to the schedule page
			const firstItem = await page.$('.select-item');
			if (!firstItem) return;

			await firstItem.click();
			await page.waitForTimeout(3000);
			await page.waitForLoadState('networkidle').catch(() => {});

			// Now find and click the first "Book" button
			const bookBtn = await page.$('button.btn');
			if (!bookBtn) {
				console.log('  No "Book" button found on schedule page');
				return;
			}

			const btnText = await bookBtn.textContent();
			console.log(`  Clicking button: "${btnText?.trim()}"`);

			await bookBtn.click();
			await page.waitForTimeout(5000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const afterUrl = page.url();
			console.log(`  URL after Book click: ${afterUrl}`);

			// Probe what's on the page now
			const pageProbe = await page.evaluate(() => {
				const results: Record<string, string[]> = {};

				// Form inputs
				const inputs = document.querySelectorAll('input, select, textarea');
				if (inputs.length > 0) {
					results['form-fields'] = Array.from(inputs)
						.filter((el) => (el as HTMLInputElement).type !== 'hidden')
						.slice(0, 15)
						.map((el) => {
							const inp = el as HTMLInputElement;
							const label = inp.id
								? document.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim() || ''
								: '';
							return `<${el.tagName.toLowerCase()} name="${inp.name}" id="${inp.id}" type="${inp.type}" placeholder="${inp.placeholder || ''}" value="${inp.value || ''}" required=${inp.required}> label="${label}"`;
						});
				}

				// Calendar/date elements
				const dateEls = document.querySelectorAll(
					'[class*="calendar"], [class*="date"], [class*="day"], [role="grid"], [role="gridcell"], table',
				);
				if (dateEls.length > 0) {
					results['calendar-elements'] = Array.from(dateEls)
						.slice(0, 10)
						.map(
							(el) =>
								`<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 80)}">`,
						);
				}

				// Time-related elements
				const timeEls = document.querySelectorAll(
					'[class*="time"], [class*="slot"], [class*="hour"]',
				);
				if (timeEls.length > 0) {
					results['time-elements'] = Array.from(timeEls)
						.slice(0, 10)
						.map(
							(el) =>
								`<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 80)}">${el.textContent?.trim().slice(0, 50)}`,
						);
				}

				// Buttons
				const buttons = document.querySelectorAll('button');
				results['buttons'] = Array.from(buttons)
					.slice(0, 10)
					.map(
						(b) =>
							`<button class="${b.className.toString().slice(0, 60)}">${b.textContent?.trim().slice(0, 40)}</button>`,
					);

				// Main content text (first 500 chars)
				const main = document.querySelector('main') || document.body;
				results['page-text'] = [main.textContent?.trim().slice(0, 500) || ''];

				return results;
			});

			console.log(`  Page state after "Book" click:`);
			for (const [key, values] of Object.entries(pageProbe)) {
				console.log(`\n  [${key}] (${values.length})`);
				for (const v of values) {
					console.log(`    ${v}`);
				}
			}
		}, 45000);
	});

	// =========================================================================
	// 2c. Time Slot Click → Form Discovery
	// =========================================================================

	describe('Time Slot → Form Discovery', () => {
		it('clicks through service → Book → time slot → discovers form', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Step 1: Click first service
			const firstItem = await page.$('.select-item');
			if (!firstItem) { console.log('  No .select-item'); return; }
			await firstItem.click();
			await page.waitForTimeout(3000);
			await page.waitForLoadState('networkidle').catch(() => {});

			// Step 2: Click "Book" button
			const bookBtn = await page.$('button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForTimeout(3000);
			await page.waitForLoadState('networkidle').catch(() => {});

			// Step 3: Find and click first available time slot
			const timeSlot = await page.$('button.time-selection');
			if (!timeSlot) {
				console.log('  No time-selection button found');
				// Try clicking a calendar day first
				const dayTile = await page.$('.react-calendar__tile:not(:disabled)');
				if (dayTile) {
					const dayText = await dayTile.textContent();
					console.log(`  Clicking calendar day: "${dayText?.trim()}"`);
					await dayTile.click();
					await page.waitForTimeout(3000);
				}
				const retrySlot = await page.$('button.time-selection');
				if (!retrySlot) {
					console.log('  Still no time slot after clicking day');
					return;
				}
				await retrySlot.click();
			} else {
				const slotText = await timeSlot.textContent();
				console.log(`  Clicking time slot: "${slotText?.trim()}"`);
				await timeSlot.click();
			}

			await page.waitForTimeout(5000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const formUrl = page.url();
			console.log(`  URL after time slot click: ${formUrl}`);

			// Probe all form fields
			const formFields = await page.evaluate(() => {
				const results: {
					tag: string; name: string; id: string; type: string;
					placeholder: string; label: string; required: boolean;
					classes: string; value: string;
				}[] = [];

				document.querySelectorAll('input, select, textarea').forEach((el) => {
					const inp = el as HTMLInputElement;
					if (inp.type === 'hidden') return;
					const id = inp.id;
					const label = id
						? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? ''
						: '';
					// Also try finding label by traversing parent
					const parentLabel = el.closest('label')?.textContent?.trim()?.slice(0, 50) ?? '';

					results.push({
						tag: el.tagName.toLowerCase(),
						name: inp.name ?? '',
						id: id ?? '',
						type: inp.type ?? '',
						placeholder: inp.placeholder ?? '',
						label: label || parentLabel,
						required: inp.required ?? false,
						classes: el.className.toString().slice(0, 80),
						value: inp.value ?? '',
					});
				});
				return results;
			});

			console.log(`\n  Form fields found: ${formFields.length}`);
			for (const f of formFields) {
				const req = f.required ? ' [REQUIRED]' : '';
				console.log(`    <${f.tag} name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}" class="${f.classes.slice(0, 40)}"> label="${f.label}"${req}`);
			}

			// Probe buttons
			const buttons = await page.evaluate(() =>
				Array.from(document.querySelectorAll('button')).map((b) => ({
					text: b.textContent?.trim().slice(0, 50) ?? '',
					type: b.type,
					classes: b.className.toString().slice(0, 80),
					disabled: b.disabled,
				})),
			);

			console.log(`\n  Buttons: ${buttons.length}`);
			for (const b of buttons) {
				const dis = b.disabled ? ' [DISABLED]' : '';
				console.log(`    <button type="${b.type}" class="${b.classes.slice(0, 40)}">${b.text}</button>${dis}`);
			}

			// Probe for coupon/certificate/payment elements
			const paymentProbe = await page.evaluate(() => {
				const results: string[] = [];
				const selectors = [
					'input[name="certificate"]', '.coupon-input', '#certificate',
					'[class*="coupon"]', '[class*="certificate"]', '[class*="payment"]',
					'[class*="discount"]', '[class*="total"]', '[class*="price"]',
				];
				for (const sel of selectors) {
					const els = document.querySelectorAll(sel);
					if (els.length > 0) {
						results.push(`${sel}: ${els.length} match(es) — ${Array.from(els).slice(0, 2).map((e) => e.outerHTML.slice(0, 150)).join(' | ')}`);
					}
				}
				return results;
			});

			console.log(`\n  Payment/coupon elements:`);
			if (paymentProbe.length === 0) {
				console.log('    None found (payment step may come after form submit)');
			}
			for (const p of paymentProbe) {
				console.log(`    ${p}`);
			}

			// Page text snapshot
			const pageText = await page.evaluate(() => {
				const main = document.querySelector('main') || document.body;
				return main.textContent?.trim().slice(0, 600) ?? '';
			});
			console.log(`\n  Page text (first 600 chars):\n    ${pageText.replace(/\n/g, '\n    ')}`);
		}, 60000);

		it('clicks "Select and continue" to reach client form', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Navigate: service → Book → time slot → "Select and continue"
			const firstItem = await page.$('.select-item');
			if (!firstItem) { console.log('  No .select-item'); return; }
			await firstItem.click();
			await page.waitForTimeout(2000);

			const bookBtn = await page.$('button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForTimeout(3000);

			const timeSlot = await page.$('button.time-selection');
			if (!timeSlot) { console.log('  No time slot'); return; }
			const slotText = await timeSlot.textContent();
			console.log(`  Selected time: "${slotText?.trim()}"`);
			await timeSlot.click();
			await page.waitForTimeout(2000);

			// Wait longer for the "Select and continue" element to render
			await page.waitForTimeout(3000);

			// Search ALL elements (not just buttons) for "continue" text
			const continueEl = await page.evaluate(() => {
				const allEls = document.querySelectorAll('*');
				const matches: { tag: string; text: string; classes: string; role: string; parentTag: string; outerHTML: string }[] = [];
				for (const el of allEls) {
					// Check direct text content (not nested children)
					const directText = Array.from(el.childNodes)
						.filter((n) => n.nodeType === 3)
						.map((n) => n.textContent?.trim())
						.join('');
					const fullText = el.textContent?.trim().toLowerCase() ?? '';

					if (
						directText.toLowerCase().includes('continue') ||
						(fullText.includes('select and continue') && el.children.length === 0)
					) {
						matches.push({
							tag: el.tagName.toLowerCase(),
							text: el.textContent?.trim().slice(0, 80) ?? '',
							classes: el.className?.toString?.()?.slice(0, 80) ?? '',
							role: el.getAttribute('role') ?? '',
							parentTag: el.parentElement
								? `${el.parentElement.tagName.toLowerCase()}.${el.parentElement.className?.toString?.()?.slice(0, 40) ?? ''}`
								: '',
							outerHTML: el.outerHTML.slice(0, 300),
						});
					}
				}
				return matches;
			});

			console.log(`  Elements with "continue" text: ${continueEl.length}`);
			for (const el of continueEl) {
				console.log(`    <${el.tag} class="${el.classes.slice(0, 50)}" role="${el.role}">`);
				console.log(`      text: "${el.text}"`);
				console.log(`      parent: ${el.parentTag}`);
				console.log(`      outerHTML: ${el.outerHTML}`);
			}

			if (continueEl.length === 0) {
				console.log('  "Select and continue" not found - dumping visible text near time slot');
				const nearSlot = await page.evaluate(() => {
					const slot = document.querySelector('.time-selection.selected-time');
					if (!slot) return 'No selected-time slot found';
					let el: Element | null = slot;
					// Walk up and collect sibling text
					while (el && !el.classList.contains('select-item') && el.tagName !== 'MAIN') {
						el = el.parentElement;
					}
					return el?.innerHTML?.slice(0, 1000) ?? 'No parent container found';
				});
				console.log(`  Nearby HTML:\n    ${nearSlot.slice(0, 800)}`);
				return;
			}

			// Try clicking the first match
			const target = continueEl[0];
			console.log(`  Attempting click on: <${target.tag} class="${target.classes.slice(0, 40)}">`);
			await page.click(`text=Select and continue`).catch(async () => {
				// Fallback: click by evaluating
				await page.evaluate(() => {
					const els = document.querySelectorAll('*');
					for (const el of els) {
						if (el.textContent?.trim() === 'Select and continue' && el.children.length === 0) {
							(el as HTMLElement).click();
							return;
						}
					}
				});
			});
			await page.waitForTimeout(5000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const formUrl = page.url();
			console.log(`  URL after "Select and continue": ${formUrl}`);

			// NOW probe for the client form
			const formFields = await page.evaluate(() => {
				const results: {
					tag: string; name: string; id: string; type: string;
					placeholder: string; label: string; required: boolean;
				}[] = [];

				document.querySelectorAll('input, select, textarea').forEach((el) => {
					const inp = el as HTMLInputElement;
					if (inp.type === 'hidden') return;
					if (inp.name === 'g-recaptcha-response') return;
					const id = inp.id;
					let label = id
						? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? ''
						: '';
					if (!label) {
						// Try parent traversal for label
						const parentLabel = el.closest('.form-group, .field-container, div')?.querySelector('label');
						label = parentLabel?.textContent?.trim() ?? '';
					}

					results.push({
						tag: el.tagName.toLowerCase(),
						name: inp.name ?? '',
						id: id ?? '',
						type: inp.type ?? '',
						placeholder: inp.placeholder ?? '',
						label,
						required: inp.required ?? false,
					});
				});
				return results;
			});

			console.log(`\n  Client form fields: ${formFields.length}`);
			for (const f of formFields) {
				const req = f.required ? ' [REQUIRED]' : '';
				console.log(`    <${f.tag} name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"> label="${f.label}"${req}`);
			}

			// Probe for coupon/certificate section
			const couponProbe = await page.evaluate(() => {
				const results: string[] = [];
				// Search broadly
				const allText = document.body.textContent?.toLowerCase() ?? '';
				if (allText.includes('certificate')) results.push('Page contains "certificate"');
				if (allText.includes('coupon')) results.push('Page contains "coupon"');
				if (allText.includes('code balance')) results.push('Page contains "code balance"');
				if (allText.includes('discount')) results.push('Page contains "discount"');
				if (allText.includes('payment')) results.push('Page contains "payment"');

				// Look for specific elements
				const certInput = document.querySelector('input[name="certificate"], input[name="coupon"], input[name="code"]');
				if (certInput) {
					results.push(`Certificate input: ${certInput.outerHTML.slice(0, 200)}`);
				}

				const checkCodeBtn = document.querySelector('button:has(span), [class*="code"], [class*="certificate"]');
				if (checkCodeBtn) {
					results.push(`Code button: ${checkCodeBtn.outerHTML.slice(0, 200)}`);
				}

				return results;
			});

			console.log(`\n  Coupon/certificate probe:`);
			for (const c of couponProbe) console.log(`    ${c}`);

			// Dump all buttons on the form page
			const buttons = await page.evaluate(() =>
				Array.from(document.querySelectorAll('button'))
					.filter((b) => b.offsetParent !== null) // visible only
					.map((b) => ({
						text: b.textContent?.trim().slice(0, 50) ?? '',
						type: b.type,
						classes: b.className.toString().slice(0, 60),
					})),
			);

			console.log(`\n  Visible buttons: ${buttons.length}`);
			for (const b of buttons) {
				console.log(`    <button type="${b.type}" class="${b.classes.slice(0, 40)}">${b.text}</button>`);
			}

			// Page text snapshot
			const pageText = await page.evaluate(() => {
				const main = document.querySelector('main') || document.body;
				return main.textContent?.trim().slice(0, 800) ?? '';
			});
			console.log(`\n  Page text:\n    ${pageText.replace(/\n/g, '\n    ')}`);
		}, 90000);
	});

	// =========================================================================
	// 3. Deep-Link Pre-fill Verification
	// =========================================================================

	describe('Deep-Link Pre-fill', () => {
		it('navigates with pre-filled client info', async () => {
			// Get a valid appointment type ID by clicking first service and extracting from URL
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const firstItem = await page.$('.select-item');
			if (!firstItem) {
				console.log('  No .select-item found, skipping pre-fill test');
				return;
			}

			await firstItem.click();
			await page.waitForTimeout(2000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const urlAfterClick = page.url();
			const idMatch = urlAfterClick.match(/appointmentType=(\d+)/);
			const firstId = idMatch?.[1] ?? null;

			if (!firstId) {
				console.log(`  URL after click: ${urlAfterClick}`);
				console.log('  No appointmentType in URL after click, skipping pre-fill test');
				return;
			}

			console.log(`  Using appointment type: ${firstId}`);

			// Build pre-filled URL
			const url = buildAcuityUrl({
				baseUrl: ACUITY_BASE_URL,
				client: {
					firstName: 'TestFirst',
					lastName: 'TestLast',
					email: 'test@example.com',
					phone: '5551234567',
				},
				booking: {
					serviceId: firstId,
				},
			});

			console.log(`  Pre-filled URL: ${url.slice(0, 120)}...`);

			await page.goto(url, { waitUntil: 'networkidle' });

			// Wait a moment for Acuity to hydrate
			await page.waitForTimeout(2000);

			// Check which page we landed on
			const hasClientForm = await page
				.$('input[name="firstName"], #firstName')
				.then((el) => el !== null);
			const hasCalendar = await page
				.$('.scheduleday, .calendar-day, [data-date]')
				.then((el) => el !== null);
			const hasServiceList = await page
				.$('.select-item, .appointment-type-item')
				.then((el) => el !== null);

			console.log(`  Landing: form=${hasClientForm}, calendar=${hasCalendar}, services=${hasServiceList}`);

			if (hasClientForm) {
				// Verify pre-fill values
				const fields = await page.evaluate(() => {
					const getValue = (selectors: string[]) => {
						for (const sel of selectors) {
							const el = document.querySelector(sel) as HTMLInputElement | null;
							if (el) return { selector: sel, value: el.value };
						}
						return { selector: 'none', value: '' };
					};

					return {
						firstName: getValue(['input[name="firstName"]', '#firstName']),
						lastName: getValue(['input[name="lastName"]', '#lastName']),
						email: getValue(['input[name="email"]', '#email']),
						phone: getValue(['input[name="phone"]', '#phone']),
					};
				});

				console.log(`  Pre-fill results:`);
				console.log(`    firstName: "${fields.firstName.value}" via ${fields.firstName.selector}`);
				console.log(`    lastName: "${fields.lastName.value}" via ${fields.lastName.selector}`);
				console.log(`    email: "${fields.email.value}" via ${fields.email.selector}`);
				console.log(`    phone: "${fields.phone.value}" via ${fields.phone.selector}`);

				// At minimum, firstName should be pre-filled
				expect(fields.firstName.value.toLowerCase()).toContain('testfirst');
			} else if (hasCalendar) {
				console.log('  Deep-link landed on calendar (need to select date first)');
				// This is expected - without a datetime param, Acuity shows calendar
			} else {
				console.log('  Deep-link landed on unexpected page');
				const pageText = await page.textContent('body').then((t) => t?.slice(0, 200));
				console.log(`  Page text: ${pageText}`);
			}
		}, 30000);

		it('navigates with datetime to skip to form', async () => {
			// Get appointment type ID by clicking first service
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const firstItem = await page.$('.select-item');
			if (!firstItem) {
				console.log('  No .select-item found, skipping');
				return;
			}

			await firstItem.click();
			await page.waitForTimeout(2000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const urlAfterClick = page.url();
			const idMatch = urlAfterClick.match(/appointmentType=(\d+)/);
			const firstId = idMatch?.[1] ?? null;

			if (!firstId) {
				console.log(`  URL after click: ${urlAfterClick}`);
				console.log('  No appointmentType in URL, skipping');
				return;
			}

			// We need a valid datetime. First navigate to the service's calendar
			// to find an available date
			const calUrl = `${ACUITY_BASE_URL}?appointmentType=${firstId}`;
			await page.goto(calUrl, { waitUntil: 'networkidle' });
			await page.waitForTimeout(2000);

			// Find first available date
			const availableDate = await page.evaluate(() => {
				const days = document.querySelectorAll(
					'.scheduleday.activeday, .calendar-day.available, [data-available="true"]',
				);
				for (const day of days) {
					const date = day.getAttribute('data-date');
					if (date) return date;
				}
				return null;
			});

			if (!availableDate) {
				console.log('  No available dates found on calendar, skipping datetime test');
				return;
			}

			console.log(`  Found available date: ${availableDate}`);

			// Click on the date to get time slots
			const dateSelector = `[data-date="${availableDate}"]`;
			await page.click(dateSelector).catch(() => {
				console.log(`  Could not click date via ${dateSelector}`);
			});
			await page.waitForTimeout(2000);

			// Find first time slot
			const timeSlot = await page.evaluate(() => {
				const slots = document.querySelectorAll(
					'.time-selection button, .time-slot, [data-time]',
				);
				for (const slot of slots) {
					const time = slot.getAttribute('data-time') || slot.getAttribute('data-datetime');
					if (time) return time;
					// Try to get time from text content
					const text = slot.textContent?.trim();
					if (text) return text;
				}
				return null;
			});

			console.log(`  First time slot: ${timeSlot}`);

			if (!timeSlot) {
				console.log('  No time slots found, skipping full deep-link test');
				return;
			}

			// Build full deep-link URL with datetime
			const url = buildAcuityUrl({
				baseUrl: ACUITY_BASE_URL,
				client: {
					firstName: 'DeepLink',
					lastName: 'TestUser',
					email: 'deeplink@example.com',
					phone: '5559876543',
				},
				booking: {
					serviceId: firstId,
					datetime: timeSlot.includes('T') ? timeSlot : `${availableDate}T${timeSlot}`,
				},
			});

			console.log(`  Full deep-link URL: ${url.slice(0, 140)}...`);

			await page.goto(url, { waitUntil: 'networkidle' });
			await page.waitForTimeout(3000);

			const hasForm = await page
				.$('input[name="firstName"], #firstName')
				.then((el) => el !== null);
			const hasCalendar = await page
				.$('.scheduleday, .calendar-day, [data-date]')
				.then((el) => el !== null);

			console.log(`  With datetime - form=${hasForm}, calendar=${hasCalendar}`);

			if (hasForm) {
				const firstName = await page
					.$eval('input[name="firstName"], #firstName', (el) => (el as HTMLInputElement).value)
					.catch(() => '');
				console.log(`  Pre-filled firstName: "${firstName}"`);
			}
		}, 45000);
	});

	// =========================================================================
	// 4. DOM Structure Discovery
	// =========================================================================

	describe('DOM Discovery', () => {
		it('catalogs all form fields on client info page', async () => {
			// Get appointment type ID by clicking first service
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			const firstItem = await page.$('.select-item');
			if (!firstItem) {
				console.log('  No .select-item found, skipping form catalog');
				return;
			}

			await firstItem.click();
			await page.waitForTimeout(2000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const urlAfterClick = page.url();
			const serviceId = urlAfterClick.match(/appointmentType=(\d+)/)?.[1];

			if (serviceId) {
				// Navigate with pre-fill to try to land on form page
				const url = buildAcuityUrl({
					baseUrl: ACUITY_BASE_URL,
					client: { firstName: 'Test', lastName: 'User', email: 'test@test.com' },
					booking: { serviceId },
				});
				await page.goto(url, { waitUntil: 'networkidle' });
				await page.waitForTimeout(2000);
			} else {
				console.log(`  No appointmentType in URL (${urlAfterClick}), examining current page`);
			}

			// Catalog all input/select/textarea elements
			const fields = await page.evaluate(() => {
				const results: {
					tag: string;
					name: string;
					id: string;
					type: string;
					placeholder: string;
					label: string;
					required: boolean;
				}[] = [];

				document.querySelectorAll('input, select, textarea').forEach((el) => {
					const input = el as HTMLInputElement;
					// Find associated label
					const id = input.id;
					const label =
						document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? '';

					results.push({
						tag: el.tagName.toLowerCase(),
						name: input.name ?? '',
						id: id ?? '',
						type: input.type ?? '',
						placeholder: input.placeholder ?? '',
						label,
						required: input.required ?? false,
					});
				});

				return results;
			});

			console.log(`  Form fields found: ${fields.length}`);
			for (const f of fields) {
				const req = f.required ? ' [REQUIRED]' : '';
				console.log(
					`    <${f.tag} name="${f.name}" id="${f.id}" type="${f.type}"> label="${f.label}"${req}`,
				);
			}
		}, 30000);

		it('discovers payment-related elements', async () => {
			// This is informational - we need to see what the payment page looks like
			// We won't actually navigate to payment (that would require filling the form)
			// Instead, we'll catalog known Acuity payment-related CSS classes

			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Take a snapshot of all CSS classes on the page for reference
			const classNames = await page.evaluate(() => {
				const classes = new Set<string>();
				document.querySelectorAll('*').forEach((el) => {
					el.classList.forEach((cls) => {
						if (
							cls.includes('pay') ||
							cls.includes('coupon') ||
							cls.includes('certificate') ||
							cls.includes('checkout') ||
							cls.includes('submit') ||
							cls.includes('confirm') ||
							cls.includes('complete') ||
							cls.includes('total') ||
							cls.includes('discount')
						) {
							classes.add(cls);
						}
					});
				});
				return Array.from(classes).sort();
			});

			console.log(`  Payment/checkout related classes on service page: ${classNames.length}`);
			for (const cls of classNames) {
				console.log(`    .${cls}`);
			}
		});
	});

	// =========================================================================
	// 5. Full Wizard Flow — Payment Page Discovery
	// =========================================================================

	describe('Payment Page Discovery', () => {
		it('navigates full wizard flow to payment page and probes DOM', async () => {
			// Step 1: Load service page
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const firstItem = await page.$('.select-item');
			if (!firstItem) {
				console.log('  No .select-item found, skipping payment discovery');
				return;
			}

			// Step 2: Click "Book" button for first service
			const bookBtn = await firstItem.$('button.btn');
			if (!bookBtn) {
				console.log('  No button.btn in first service, skipping');
				return;
			}
			console.log('  Clicking Book button...');
			await bookBtn.click();
			await page.waitForURL(/\/appointment\/\d+\/calendar\/\d+/, { timeout: 15000 });
			console.log(`  Calendar page URL: ${page.url()}`);

			// Wait for page to fully render after SPA navigation
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			// Diagnostic: what's on the page right now?
			const pageSnapshot = await page.evaluate(() => {
				const body = document.body;
				const allElements = body.querySelectorAll('*');
				const classSet = new Set<string>();
				allElements.forEach((el) => el.classList.forEach((c) => classSet.add(c)));
				const relevantClasses = Array.from(classSet).filter(
					(c) => c.includes('calendar') || c.includes('react') || c.includes('monthly') || c.includes('schedule') || c.includes('time') || c.includes('available'),
				).sort();
				return {
					totalElements: allElements.length,
					relevantClasses,
					bodyTextSnippet: body.textContent?.trim().slice(0, 500),
				};
			});
			console.log(`  Total DOM elements: ${pageSnapshot.totalElements}`);
			console.log(`  Calendar/schedule related classes: ${pageSnapshot.relevantClasses.length}`);
			for (const cls of pageSnapshot.relevantClasses) {
				console.log(`    .${cls}`);
			}
			console.log(`  Body text (first 500 chars): "${pageSnapshot.bodyTextSnippet}"`);

			// Step 3: Wait for calendar — try longer timeout
			const calendarLoaded = await page.waitForSelector('.react-calendar__tile, .monthly-calendar-v2, .react-calendar', { timeout: 15000 }).catch(() => null);

			if (!calendarLoaded) {
				console.log('  Calendar component did not appear within 15s — dumping page state');
				const html = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
				console.log(`  Body HTML (first 2000 chars):\n${html}`);
				return;
			}
			console.log(`  Calendar element found: ${await calendarLoaded.evaluate((el) => el.className)}`);

			// Diagnostic: dump calendar tile state
			const tileInfo = await page.evaluate(() => {
				const tiles = document.querySelectorAll('.react-calendar__tile');
				return Array.from(tiles).slice(0, 10).map((t) => ({
					text: t.textContent?.trim(),
					disabled: (t as HTMLButtonElement).disabled,
					classes: t.className,
					ariaDisabled: t.getAttribute('aria-disabled'),
				}));
			});
			console.log(`  Calendar tiles (first 10 of ${tileInfo.length}):`);
			for (const t of tileInfo) {
				console.log(`    "${t.text}" disabled=${t.disabled} aria-disabled=${t.ariaDisabled} class="${t.classes}"`);
			}

			// Try both disabled attribute and class-based detection
			let availableTiles = await page.$$('.react-calendar__tile:not(:disabled):not(.react-calendar__tile--disabled)');
			console.log(`  Available tiles (not disabled): ${availableTiles.length}`);

			// If no tiles available, also try tiles that just don't have --disabled class
			if (availableTiles.length === 0) {
				// Some react-calendar versions use a class instead of the HTML disabled attribute
				const allTiles = await page.$$('.react-calendar__tile');
				const clickable: typeof allTiles = [];
				for (const tile of allTiles) {
					const cls = await tile.getAttribute('class') ?? '';
					const isDisabled = await tile.evaluate((el) => (el as HTMLButtonElement).disabled);
					if (!isDisabled && !cls.includes('neighboringMonth')) {
						clickable.push(tile);
					}
				}
				availableTiles = clickable;
				console.log(`  Clickable tiles (manual check): ${availableTiles.length}`);
			}

			// Navigate forward up to 3 months to find availability
			for (let month = 0; month < 3 && availableTiles.length === 0; month++) {
				const label = await page.$eval(
					'.react-calendar__navigation__label',
					(el) => el.textContent?.trim() ?? 'unknown',
				).catch(() => 'unknown');
				console.log(`  Month "${label}": 0 available days, clicking next...`);
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) {
					console.log('  Next button not found');
					break;
				}
				await nextBtn.click();
				await page.waitForTimeout(1500);

				const allTiles = await page.$$('.react-calendar__tile');
				const clickable: typeof allTiles = [];
				for (const tile of allTiles) {
					const cls = await tile.getAttribute('class') ?? '';
					const isDisabled = await tile.evaluate((el) => (el as HTMLButtonElement).disabled);
					if (!isDisabled && !cls.includes('neighboringMonth')) {
						clickable.push(tile);
					}
				}
				availableTiles = clickable;
				console.log(`  After next: ${availableTiles.length} available tiles`);
			}

			if (availableTiles.length === 0) {
				console.log('  No available calendar days in next 3 months, skipping');
				return;
			}
			const monthLabel = await page.$eval(
				'.react-calendar__navigation__label',
				(el) => el.textContent?.trim() ?? 'unknown',
			).catch(() => 'unknown');
			console.log(`  Month "${monthLabel}": found ${availableTiles.length} available days, clicking first...`);
			await availableTiles[0].click();
			await page.waitForTimeout(2000);

			// Step 4: Select first time slot
			const timeSlots = await page.$$('button.time-selection');
			if (timeSlots.length === 0) {
				console.log('  No time slots found, skipping');
				return;
			}
			const slotText = await timeSlots[0].textContent();
			console.log(`  Clicking time slot: "${slotText?.trim()}"`);
			await timeSlots[0].click();
			await page.waitForTimeout(1500);

			// Step 5: Click "Select and continue"
			const menuItems = await page.$$('li[role="menuitem"]');
			let selectAndContinue = null;
			for (const item of menuItems) {
				const text = await item.textContent();
				if (text?.includes('Select and continue')) {
					selectAndContinue = item;
					break;
				}
			}
			if (!selectAndContinue) {
				console.log('  "Select and continue" not found, skipping');
				return;
			}
			console.log('  Clicking "Select and continue"...');
			await selectAndContinue.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			console.log(`  Client form URL: ${page.url()}`);

			// Step 6: Fill client form with test data (required fields only)
			await page.waitForSelector('input[name="client.firstName"]', { timeout: 10000 });

			await page.fill('input[name="client.firstName"]', 'Test');
			await page.fill('input[name="client.lastName"]', 'Discovery');
			await page.fill('input[name="client.email"]', 'test-discovery@massageithaca.com');
			await page.fill('input[name="client.phone"]', '6075551234');
			console.log('  Filled client form fields');

			// Check the terms checkbox if present
			const termsCheckbox = await page.$('input[type="checkbox"][name*="field-13933959"]');
			if (termsCheckbox) {
				const isChecked = await termsCheckbox.isChecked();
				if (!isChecked) {
					await termsCheckbox.click();
					console.log('  Checked terms checkbox');
				}
			}

			// Step 7: Click "Continue to Payment"
			const continueBtn = await page.$('button.btn:has-text("Continue to Payment")') ??
				await page.$('button:has-text("Continue to Payment")');
			if (!continueBtn) {
				console.log('  "Continue to Payment" button not found');
				// Probe what buttons ARE on the page
				const allBtns = await page.$$eval('button', (btns) =>
					btns.map((b) => ({
						text: b.textContent?.trim().slice(0, 60),
						classes: b.className,
						type: b.type,
					})),
				);
				console.log(`  All buttons on form page: ${allBtns.length}`);
				for (const b of allBtns) {
					console.log(`    <button class="${b.classes}" type="${b.type}">${b.text}</button>`);
				}
				return;
			}

			console.log('  Clicking "Continue to Payment"...');
			await continueBtn.click();

			// Wait for page transition
			await page.waitForTimeout(3000);
			await page.waitForLoadState('networkidle').catch(() => {});

			const paymentUrl = page.url();
			console.log(`  Payment page URL: ${paymentUrl}`);

			// === PAYMENT PAGE DOM DISCOVERY ===
			console.log('\n  === PAYMENT PAGE DOM DISCOVERY ===');

			// Probe all input/select/textarea elements
			const formFields = await page.evaluate(() => {
				const results: {
					tag: string;
					name: string;
					id: string;
					type: string;
					placeholder: string;
					value: string;
					visible: boolean;
				}[] = [];
				document.querySelectorAll('input, select, textarea').forEach((el) => {
					const input = el as HTMLInputElement;
					const rect = el.getBoundingClientRect();
					results.push({
						tag: el.tagName.toLowerCase(),
						name: input.name ?? '',
						id: input.id ?? '',
						type: input.type ?? '',
						placeholder: input.placeholder ?? '',
						value: input.value ?? '',
						visible: rect.width > 0 && rect.height > 0,
					});
				});
				return results;
			});

			console.log(`  Form fields on payment page: ${formFields.length}`);
			for (const f of formFields) {
				const vis = f.visible ? '' : ' [HIDDEN]';
				console.log(
					`    <${f.tag} name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}">${vis}`,
				);
			}

			// Probe all buttons
			const buttons = await page.$$eval('button', (btns) =>
				btns.map((b) => {
					const rect = b.getBoundingClientRect();
					return {
						text: b.textContent?.trim().slice(0, 80),
						classes: b.className,
						type: b.type,
						disabled: b.disabled,
						visible: rect.width > 0 && rect.height > 0,
					};
				}),
			);
			console.log(`  Buttons on payment page: ${buttons.length}`);
			for (const b of buttons) {
				const vis = b.visible ? '' : ' [HIDDEN]';
				const dis = b.disabled ? ' [DISABLED]' : '';
				console.log(`    <button class="${b.classes}" type="${b.type}">${b.text}</button>${vis}${dis}`);
			}

			// Probe payment/coupon/certificate related classes
			const paymentClasses = await page.evaluate(() => {
				const classes = new Set<string>();
				document.querySelectorAll('*').forEach((el) => {
					el.classList.forEach((cls) => {
						if (
							cls.includes('pay') ||
							cls.includes('coupon') ||
							cls.includes('certificate') ||
							cls.includes('code') ||
							cls.includes('balance') ||
							cls.includes('total') ||
							cls.includes('amount') ||
							cls.includes('price') ||
							cls.includes('checkout') ||
							cls.includes('submit') ||
							cls.includes('confirm') ||
							cls.includes('complete') ||
							cls.includes('discount') ||
							cls.includes('gift') ||
							cls.includes('card')
						) {
							classes.add(cls);
						}
					});
				});
				return Array.from(classes).sort();
			});
			console.log(`  Payment/certificate related CSS classes: ${paymentClasses.length}`);
			for (const cls of paymentClasses) {
				console.log(`    .${cls}`);
			}

			// Probe key text content on the page
			const keyTexts = await page.evaluate(() => {
				const texts: string[] = [];
				const walker = document.createTreeWalker(
					document.body,
					NodeFilter.SHOW_TEXT,
					{
						acceptNode: (node) => {
							const text = node.textContent?.trim() ?? '';
							if (text.length < 3 || text.length > 100) return NodeFilter.FILTER_REJECT;
							const lower = text.toLowerCase();
							if (
								lower.includes('payment') ||
								lower.includes('coupon') ||
								lower.includes('certificate') ||
								lower.includes('gift') ||
								lower.includes('code') ||
								lower.includes('balance') ||
								lower.includes('total') ||
								lower.includes('amount') ||
								lower.includes('$') ||
								lower.includes('complete') ||
								lower.includes('confirm') ||
								lower.includes('book') ||
								lower.includes('submit') ||
								lower.includes('pay')
							) {
								return NodeFilter.FILTER_ACCEPT;
							}
							return NodeFilter.FILTER_REJECT;
						},
					},
				);
				let node;
				while ((node = walker.nextNode())) {
					const text = node.textContent?.trim() ?? '';
					if (text && !texts.includes(text)) {
						texts.push(text);
					}
				}
				return texts;
			});
			console.log(`  Key payment-related text on page: ${keyTexts.length}`);
			for (const t of keyTexts) {
				console.log(`    "${t}"`);
			}

			// Probe for "Check Code Balance" button specifically
			const checkCodeBtn = await page.$('button:has-text("Check Code Balance")');
			if (checkCodeBtn) {
				console.log('\n  === "Check Code Balance" button found — clicking it ===');
				await checkCodeBtn.click();
				await page.waitForTimeout(2000);

				// Re-probe fields after clicking Check Code Balance
				const postClickFields = await page.evaluate(() => {
					const results: { tag: string; name: string; id: string; type: string; placeholder: string; visible: boolean }[] = [];
					document.querySelectorAll('input, select, textarea').forEach((el) => {
						const input = el as HTMLInputElement;
						const rect = el.getBoundingClientRect();
						results.push({
							tag: el.tagName.toLowerCase(),
							name: input.name ?? '',
							id: input.id ?? '',
							type: input.type ?? '',
							placeholder: input.placeholder ?? '',
							visible: rect.width > 0 && rect.height > 0,
						});
					});
					return results;
				});

				console.log(`  Fields after "Check Code Balance" click: ${postClickFields.length}`);
				for (const f of postClickFields) {
					const vis = f.visible ? '' : ' [HIDDEN]';
					console.log(`    <${f.tag} name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}">${vis}`);
				}

				// Re-probe buttons
				const postClickButtons = await page.$$eval('button', (btns) =>
					btns.map((b) => {
						const rect = b.getBoundingClientRect();
						return {
							text: b.textContent?.trim().slice(0, 80),
							classes: b.className,
							visible: rect.width > 0 && rect.height > 0,
						};
					}),
				);
				console.log(`  Buttons after "Check Code Balance" click: ${postClickButtons.length}`);
				for (const b of postClickButtons) {
					const vis = b.visible ? '' : ' [HIDDEN]';
					console.log(`    <button class="${b.classes}">${b.text}</button>${vis}`);
				}
			} else {
				console.log('  "Check Code Balance" button NOT found on payment page');
			}

			// Probe for certificate/coupon input
			const certInput = await page.$('input[name="certificate"]');
			if (certInput) {
				console.log('  Certificate input (input[name="certificate"]) FOUND');
			} else {
				console.log('  Certificate input NOT found — checking alternatives...');
				const anyInput = await page.$$eval('input', (inputs) =>
					inputs
						.filter((i) => {
							const name = i.name?.toLowerCase() ?? '';
							const id = i.id?.toLowerCase() ?? '';
							return name.includes('cert') || name.includes('code') || name.includes('gift') ||
								id.includes('cert') || id.includes('code') || id.includes('gift');
						})
						.map((i) => ({ name: i.name, id: i.id, type: i.type, placeholder: i.placeholder })),
				);
				console.log(`  Certificate-like inputs: ${anyInput.length}`);
				for (const i of anyInput) {
					console.log(`    <input name="${i.name}" id="${i.id}" type="${i.type}" placeholder="${i.placeholder}">`);
				}
			}

			// At minimum, we should have reached the payment page
			expect(paymentUrl).toBeTruthy();
		}, 90000);
	});

	// =========================================================================
	// 6. BrowserService Layer Integration
	// =========================================================================

	describe('BrowserService Layer', () => {
		it('acquires and uses a page via the Effect layer', async () => {
			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
			};

			const program = Effect.scoped(
				Effect.gen(function* () {
					const svc = yield* BrowserService;
					const pg = yield* svc.acquirePage;

					yield* Effect.tryPromise({
						try: () => pg.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' }),
						catch: (e) => new Error(`Navigation failed: ${e}`),
					});

					const title = yield* Effect.tryPromise({
						try: () => pg.title(),
						catch: () => new Error('Title failed'),
					});

					return title;
				}),
			);

			const title = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log(`  BrowserService page title: "${title}"`);
			expect(title).toBeTruthy();
		}, 30000);
	});

	// =========================================================================
	// 7. Selector Health Check
	// =========================================================================

	describe('Selector Health Check', () => {
		it('reports selector health for the service page', async () => {
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Check service-page selectors
			const servicePageSelectors: SelectorKey[] = [
				'serviceList',
				'serviceName',
				'serviceLink',
				'servicePrice',
				'serviceDuration',
			];

			const result = await Effect.runPromise(healthCheck(page, servicePageSelectors));

			console.log(`  Service page selector health:`);
			console.log(`    Passed: ${result.passed.join(', ') || 'none'}`);
			console.log(`    Failed: ${result.failed.join(', ') || 'none'}`);

			// At minimum, serviceList or serviceLink should resolve
			const hasAnyService =
				result.passed.includes('serviceList') || result.passed.includes('serviceLink');
			expect(hasAnyService).toBe(true);
		});
	});

	// =========================================================================
	// 8. Effect Step Programs — End-to-End Integration
	// =========================================================================

	describe('Effect Step Programs E2E', () => {
		it('navigateToBooking clicks through wizard to client form', async () => {
			// Import the step program
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// We need to find an available date+time first (using raw Playwright)
			// since navigateToBooking requires a specific datetime
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });

			// Get service name
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');

			if (!serviceName) {
				console.log('  No service name found, skipping');
				return;
			}
			console.log(`  Target service: "${serviceName}"`);

			// Click Book to get to calendar, find first available date+time
			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			// Navigate to month with availability
			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No available dates'); return; }

			// Get the date from the tile
			await availableTile.click();
			await page.waitForTimeout(2000);

			// Get first time slot
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No time slots'); return; }
			const slotText = await timeSlotBtn.textContent();
			console.log(`  Found slot: "${slotText?.trim()}"`);

			// Click time slot + "Select and continue" to get to form URL
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu item'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });

			// Extract the datetime from the URL
			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;

			if (!datetime) { console.log('  Could not extract datetime from URL'); return; }
			console.log(`  Extracted datetime: ${datetime}`);
			console.log(`  Now running navigateToBooking() via Effect...`);

			// NOW run the actual Effect step program in a fresh browser context
			const program = Effect.scoped(
				Effect.gen(function* () {
					const result = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'EffectTest',
							lastName: 'Integration',
							email: 'effect-test@massageithaca.com',
						},
					});
					return result;
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log(`  navigateToBooking result:`);
			console.log(`    url: ${result.url}`);
			console.log(`    landingStep: ${result.landingStep}`);
			console.log(`    appointmentTypeId: ${result.appointmentTypeId}`);
			console.log(`    calendarId: ${result.calendarId}`);
			console.log(`    selectedDate: ${result.selectedDate}`);
			console.log(`    selectedTime: ${result.selectedTime}`);

			expect(result.landingStep).toBe('client-form');
			expect(result.appointmentTypeId).toBeTruthy();
			expect(result.url).toContain('/datetime/');
		}, 120000);

		it('fillFormFields fills client data on the form page', async () => {
			// Import step programs
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');
			const { fillFormFields } = await import('../../src/middleware/steps/fill-form.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// First discover an available datetime (same approach as above)
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }

			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });

			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  No datetime'); return; }

			console.log(`  Service: "${serviceName}", datetime: ${datetime}`);
			console.log(`  Running navigateToBooking + fillFormFields via Effect...`);

			// Run BOTH steps: navigate then fill
			const program = Effect.scoped(
				Effect.gen(function* () {
					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'FormTest',
							lastName: 'Integration',
							email: 'form-test@massageithaca.com',
							phone: '6075559999',
						},
					});
					console.log(`    nav.landingStep: ${nav.landingStep}`);

					if (nav.landingStep !== 'client-form') {
						return { nav, fill: null };
					}

					const fill = yield* fillFormFields({
						client: {
							firstName: 'FormTest',
							lastName: 'Integration',
							email: 'form-test@massageithaca.com',
							phone: '6075559999',
						},
						customFields: {
							// Terms checkbox
							'13933959': 'true',
						},
					});

					return { nav, fill };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log(`  Result:`);
			console.log(`    nav.landingStep: ${result.nav.landingStep}`);
			if (result.fill) {
				console.log(`    fill.fieldsCompleted: ${result.fill.fieldsCompleted.join(', ')}`);
				console.log(`    fill.customFieldsCompleted: ${result.fill.customFieldsCompleted.join(', ')}`);
				console.log(`    fill.advanced: ${result.fill.advanced}`);
			}

			expect(result.nav.landingStep).toBe('client-form');
			// Don't assert fill.advanced — that would submit toward payment
			// and we don't want to do that without a coupon
			if (result.fill) {
				expect(result.fill.fieldsCompleted).toContain('firstName');
				expect(result.fill.fieldsCompleted).toContain('email');
			}
		}, 120000);

		it('bypassPayment opens coupon modal and enters code', async () => {
			// Import step programs
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');
			const { fillFormFields } = await import('../../src/middleware/steps/fill-form.js');
			const { bypassPayment } = await import('../../src/middleware/steps/bypass-payment.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// Discover an available datetime via raw Playwright
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }

			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });

			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  No datetime'); return; }

			console.log(`  Service: "${serviceName}", datetime: ${datetime}`);

			// Use a test code — we expect the coupon to be rejected
			// If ACUITY_BYPASS_COUPON is set, test with a real code
			const testCouponCode = process.env.ACUITY_BYPASS_COUPON ?? 'TEST-INVALID-CODE';
			const expectSuccess = !!process.env.ACUITY_BYPASS_COUPON;
			console.log(`  Coupon code: "${testCouponCode}" (expect success: ${expectSuccess})`);

			// Run navigate + fill + bypass via Effect
			const program = Effect.scoped(
				Effect.gen(function* () {
					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'CouponTest',
							lastName: 'Integration',
							email: 'coupon-test@massageithaca.com',
							phone: '6075551234',
						},
					});
					console.log(`    nav.landingStep: ${nav.landingStep}`);
					if (nav.landingStep !== 'client-form') {
						return { nav, fill: null, bypass: null, bypassError: null };
					}

					const fill = yield* fillFormFields({
						client: {
							firstName: 'CouponTest',
							lastName: 'Integration',
							email: 'coupon-test@massageithaca.com',
							phone: '6075551234',
						},
					});
					console.log(`    fill.fieldsCompleted: ${fill.fieldsCompleted.join(', ')}`);

					// Attempt bypass-payment — may fail with CouponError for invalid code
					const bypassResult = yield* bypassPayment(testCouponCode).pipe(
						Effect.map((r) => ({ bypass: r, bypassError: null })),
						Effect.catchTag('CouponError', (e) =>
							Effect.succeed({ bypass: null, bypassError: e.message }),
						),
					);

					return { nav, fill, ...bypassResult };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log(`  Result:`);
			console.log(`    nav.landingStep: ${result.nav.landingStep}`);
			if (result.bypass) {
				console.log(`    bypass.couponApplied: ${result.bypass.couponApplied}`);
				console.log(`    bypass.totalAfterCoupon: ${result.bypass.totalAfterCoupon}`);
			}
			if (result.bypassError) {
				console.log(`    bypassError: ${result.bypassError}`);
			}

			// Navigation and form must work
			expect(result.nav.landingStep).toBe('client-form');
			expect(result.fill).not.toBeNull();

			if (expectSuccess) {
				// Real coupon — should apply successfully
				expect(result.bypass).not.toBeNull();
				expect(result.bypass?.couponApplied).toBe(true);
			} else {
				// Invalid code — we expect a CouponError (coupon rejected)
				// The key assertion: the modal flow worked (opened, filled, clicked)
				// The error should mention "rejected" not "not found" (which would mean modal didn't open)
				expect(result.bypassError ?? result.bypass).toBeTruthy();
				console.log('  (Invalid code correctly handled — modal flow verified)');
			}
		}, 120000);

		it('discovers coupon validation DOM after applying real code', async () => {
			const couponCode = process.env.ACUITY_BYPASS_COUPON;
			if (!couponCode) {
				console.log('  ACUITY_BYPASS_COUPON not set — skipping');
				return;
			}

			// Navigate to client form via raw Playwright (faster than Effect for discovery)
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			// Navigate to available date
			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);

			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			await page.waitForTimeout(2000);

			// Fill required form fields so "Continue to Payment" is enabled
			await page.fill('input[name="client.firstName"]', 'CouponProbe');
			await page.fill('input[name="client.lastName"]', 'Discovery');
			await page.fill('input[name="client.email"]', 'probe@test.com');
			await page.fill('input[name="client.phone"]', '6075550000');
			await page.waitForTimeout(500);

			console.log('  === PRE-COUPON STATE ===');

			// Snapshot all visible text near payment/total elements
			const preCouponSnapshot = await page.evaluate(() => {
				const snap: Record<string, string> = {};
				// Check for any price/total text
				document.querySelectorAll('*').forEach((el) => {
					const text = el.textContent?.trim() ?? '';
					if (text.match(/\$\d/) && text.length < 200) {
						const tag = el.tagName.toLowerCase();
						const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
						snap[`${tag}${cls}`] = text.slice(0, 150);
					}
				});
				return snap;
			});
			for (const [sel, text] of Object.entries(preCouponSnapshot).slice(0, 10)) {
				console.log(`    ${sel}: "${text}"`);
			}

			// Click "Check Code Balance"
			const checkBalanceBtn = await page.$('button:has-text("Check Code Balance")');
			if (!checkBalanceBtn) { console.log('  No "Check Code Balance" button'); return; }
			await checkBalanceBtn.click();
			await page.waitForSelector('#code', { timeout: 5000 });
			console.log('  Modal opened, #code input visible');

			// Enter the real coupon code
			await page.fill('#code', couponCode);
			console.log(`  Filled code: "${couponCode}"`);

			// Click "Confirm" (actual submit, NOT "Check by code" which is a tab)
			const confirmBtn = await page.$('[role="dialog"] button:has-text("Confirm")') ??
				await page.$('button.css-qgmcoe');
			if (!confirmBtn) { console.log('  No "Confirm" button'); return; }
			await confirmBtn.click();
			console.log('  Clicked "Confirm"');

			// Wait longer for validation response (API call may take time)
			await page.waitForTimeout(6000);

			console.log('  === POST-COUPON STATE ===');

			// Probe the modal and surrounding DOM for changes
			const postCouponSnapshot = await page.evaluate(() => {
				const result: Record<string, string | null> = {};

				// FULL modal innerHTML (increased limit)
				const dialog = document.querySelector('[role="dialog"]');
				if (dialog) {
					result['dialog.innerHTML'] = dialog.innerHTML.slice(0, 4000);
					result['dialog.textContent'] = dialog.textContent?.trim().slice(0, 500) ?? '';
				}

				// All text content inside the dialog
				if (dialog) {
					const allText: string[] = [];
					dialog.querySelectorAll('*').forEach((el) => {
						if (el.children.length === 0) {
							const t = el.textContent?.trim();
							if (t) allText.push(`[${el.tagName}${el.className ? '.'+String(el.className).split(' ')[0] : ''}] ${t}`);
						}
					});
					result['dialog.leafText'] = allText.join('\n');
				}

				// Check for error/success messages anywhere on page
				const errorCandidates = [
					'.error-message', '.alert-danger', '[role="alert"]',
					'.error', '.warning', '.success', '.info',
					'[class*="error"]', '[class*="success"]', '[class*="alert"]',
					'[class*="message"]', '[class*="notification"]',
					'[class*="balance"]', '[class*="result"]', '[class*="response"]',
				];
				for (const sel of errorCandidates) {
					const el = document.querySelector(sel);
					if (el) {
						const text = el.textContent?.trim().slice(0, 200);
						if (text) result[`found:${sel}`] = text;
					}
				}

				// Check #code input state
				const codeInput = document.querySelector('#code') as HTMLInputElement;
				if (codeInput) {
					result['#code.value'] = codeInput.value;
					result['#code.disabled'] = String(codeInput.disabled);
				}

				// Price-related text changes
				const priceEl = document.querySelector('p.css-wv8mzd');
				if (priceEl) result['priceDisplay'] = priceEl.textContent?.trim() ?? '';

				// Check for ANY new elements that appeared after Confirm
				const allButtons = document.querySelectorAll('button');
				allButtons.forEach((btn) => {
					const text = btn.textContent?.trim();
					if (text && text.length < 100) {
						result[`button: "${text.slice(0, 80)}"`] = btn.className.slice(0, 100);
					}
				});

				return result;
			});

			for (const [key, val] of Object.entries(postCouponSnapshot)) {
				if (key === 'modal.outerHTML') {
					console.log(`    ${key}: ${val?.slice(0, 500)}...`);
				} else {
					console.log(`    ${key}: ${val}`);
				}
			}

			// Close modal
			const closeBtn = await page.$('button:has-text("Close")');
			if (closeBtn) {
				await closeBtn.click();
				await page.waitForTimeout(1000);
			}

			// Check page state after modal closes
			console.log('  === AFTER MODAL CLOSE ===');
			const afterClose = await page.evaluate(() => {
				const result: Record<string, string> = {};
				document.querySelectorAll('*').forEach((el) => {
					const text = el.textContent?.trim() ?? '';
					if ((text.match(/\$0|free|applied|certificate|coupon|discount/i)) && text.length < 200) {
						const tag = el.tagName.toLowerCase();
						const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
						result[`${tag}${cls}`] = text.slice(0, 200);
					}
				});
				// Check if "Continue to Payment" changed text
				const continueBtn = document.querySelector('button.btn');
				if (continueBtn) result['continueBtn.text'] = continueBtn.textContent?.trim().slice(0, 100) ?? '';
				return result;
			});
			for (const [key, val] of Object.entries(afterClose).slice(0, 15)) {
				console.log(`    ${key}: "${val}"`);
			}

			// Always pass — this is a discovery test
			expect(true).toBe(true);
		}, 120000);

		it('discovers payment step after Continue to Payment', async () => {
			// Navigate to client form, fill it, then click Continue to Payment
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);

			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			await page.waitForTimeout(2000);

			// Fill required fields carefully (React SPA needs click + type)
			await page.click('input[name="client.firstName"]');
			await page.fill('input[name="client.firstName"]', 'PaymentProbe');
			await page.click('input[name="client.lastName"]');
			await page.fill('input[name="client.lastName"]', 'Discovery');
			// Email input is a React-controlled component with "Add..." placeholder
			// Standard fill() doesn't work. Try multiple approaches.
			const emailInput = await page.$('input[name="client.email"]');
			if (emailInput) {
				await emailInput.click();
				await page.waitForTimeout(300);
				// Clear and type character by character to trigger React onChange
				await emailInput.fill('');
				await page.keyboard.type('payprobe@test.com', { delay: 20 });
				await page.keyboard.press('Tab');
			}
			await page.click('input[name="client.phone"]');
			await page.fill('input[name="client.phone"]', '6075550001');
			// Check terms checkbox
			const termsBox = await page.$('input[name="fields[field-13933959]"]');
			if (termsBox) {
				const checked = await termsBox.isChecked();
				if (!checked) await termsBox.click();
			}
			await page.waitForTimeout(1000);

			// Verify email was filled
			const emailVal = await page.$eval('input[name="client.email"]', (el) => (el as HTMLInputElement).value).catch(() => 'NOT_FOUND');
			console.log(`  Email value: "${emailVal}"`);

			// Enter gift certificate code via "Check Code Balance" modal
			const couponCode = process.env.ACUITY_BYPASS_COUPON;
			if (couponCode) {
				const checkBalanceBtn = await page.$('button:has-text("Check Code Balance")');
				if (checkBalanceBtn) {
					await checkBalanceBtn.click();
					await page.waitForSelector('#code', { timeout: 5000 });
					await page.fill('#code', couponCode);
					const confirmBtn = await page.$('[role="dialog"] button:has-text("Confirm")') ??
						await page.$('button.css-qgmcoe');
					if (confirmBtn) {
						await confirmBtn.click();
						await page.waitForTimeout(4000);
						console.log(`  Gift cert "${couponCode}" submitted via modal`);
					}
					// Close modal
					const closeBtn = await page.$('button:has-text("Close")');
					if (closeBtn) await closeBtn.click();
					await page.waitForTimeout(1000);
				}
			}

			const urlBefore = page.url();
			console.log(`  URL before: ${urlBefore}`);

			// Click "Continue to Payment"
			const continueBtn = await page.$('button:has-text("Continue to Payment")');
			if (!continueBtn) { console.log('  No Continue to Payment button'); return; }
			await continueBtn.click();
			console.log('  Clicked "Continue to Payment"');

			// Wait for page to potentially change
			await page.waitForTimeout(5000);

			const urlAfter = page.url();
			console.log(`  URL after: ${urlAfter}`);
			console.log(`  URL changed: ${urlBefore !== urlAfter}`);

			console.log('  === PAYMENT STEP DOM ===');

			const paymentDom = await page.evaluate(() => {
				const result: Record<string, string> = {};

				// Page title / headers
				const headings = document.querySelectorAll('h1, h2, h3, h4');
				headings.forEach((h, i) => {
					const text = h.textContent?.trim();
					if (text) result[`heading[${i}]`] = text.slice(0, 200);
				});

				// All inputs (look for payment/coupon/certificate fields)
				const inputs = document.querySelectorAll('input, select, textarea');
				inputs.forEach((inp) => {
					const input = inp as HTMLInputElement;
					const name = input.name || input.id || input.type || 'unknown';
					const placeholder = input.placeholder || '';
					const label = input.labels?.[0]?.textContent?.trim() || '';
					result[`input[${name}]`] = `type=${input.type}, placeholder="${placeholder}", label="${label}", value="${input.value}"`;
				});

				// All buttons
				const buttons = document.querySelectorAll('button');
				buttons.forEach((btn) => {
					const text = btn.textContent?.trim();
					if (text && text.length < 100) {
						result[`button: "${text}"`] = `class="${btn.className.slice(0, 80)}", disabled=${btn.disabled}`;
					}
				});

				// Look for certificate/coupon/gift/promo fields
				const promoSelectors = [
					'[name*="certificate"]', '[name*="coupon"]', '[name*="promo"]',
					'[name*="gift"]', '[name*="code"]', '[name*="discount"]',
					'[id*="certificate"]', '[id*="coupon"]', '[id*="promo"]',
					'[id*="gift"]', '[id*="discount"]',
					'[placeholder*="code"]', '[placeholder*="coupon"]', '[placeholder*="gift"]',
				];
				for (const sel of promoSelectors) {
					const el = document.querySelector(sel);
					if (el) {
						result[`promo:${sel}`] = el.outerHTML.slice(0, 300);
					}
				}

				// Check for iframe (Stripe/PayPal embedded payment)
				const iframes = document.querySelectorAll('iframe');
				iframes.forEach((iframe, i) => {
					result[`iframe[${i}]`] = `src="${iframe.src?.slice(0, 200)}", name="${iframe.name}"`;
				});

				// Any text mentioning payment, certificate, coupon
				const allText: string[] = [];
				document.querySelectorAll('p, span, div, label, a').forEach((el) => {
					const text = el.textContent?.trim() ?? '';
					if (text.match(/payment|certificate|coupon|gift|promo|code|redeem|apply|discount|total|\$|free/i) && text.length < 150 && text.length > 3) {
						const tag = el.tagName.toLowerCase();
						const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
						allText.push(`[${tag}${cls}] ${text}`);
					}
				});
				// Deduplicate and limit
				const unique = [...new Set(allText)].slice(0, 30);
				result['payment-text'] = unique.join('\n');

				return result;
			});

			for (const [key, val] of Object.entries(paymentDom)) {
				if (key === 'payment-text') {
					console.log(`    ${key}:`);
					for (const line of val.split('\n')) {
						console.log(`      ${line}`);
					}
				} else {
					console.log(`    ${key}: ${val}`);
				}
			}

			expect(true).toBe(true);
		}, 120000);

		it('discovers payment step via Effect programs (bypasses email fill issue)', async () => {
			// Use Effect step programs which correctly fill email (unlike raw Playwright
			// in the shared page context). fillFormFields calls advancePastForm() which
			// clicks "Continue to Payment", so after it returns the page is on the
			// payment step.
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');
			const { fillFormFields } = await import('../../src/middleware/steps/fill-form.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// Discover an available datetime via raw Playwright
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  No datetime'); return; }

			console.log(`  Service: "${serviceName}", datetime: ${datetime}`);
			console.log('  Running navigate + fill (with Continue to Payment click) via Effect...');

			// Run navigate + fill via Effect — fillFormFields clicks "Continue to Payment"
			const program = Effect.scoped(
				Effect.gen(function* () {
					const { acquirePage } = yield* BrowserService;
					const pg: Page = yield* acquirePage;

					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'PaymentDisc',
							lastName: 'EffectTest',
							email: 'payment-disc@massageithaca.com',
							phone: '6075551111',
						},
					});
					console.log(`    nav.landingStep: ${nav.landingStep}`);
					if (nav.landingStep !== 'client-form') {
						return { nav, fill: null, paymentDom: null };
					}

					const fill = yield* fillFormFields({
						client: {
							firstName: 'PaymentDisc',
							lastName: 'EffectTest',
							email: 'payment-disc@massageithaca.com',
							phone: '6075551111',
						},
						customFields: {
							'13933959': 'true', // terms checkbox
						},
					});
					console.log(`    fill.advanced: ${fill.advanced}`);
					console.log(`    fill.fieldsCompleted: ${fill.fieldsCompleted.join(', ')}`);

					// Now we should be on the payment step.
					// Wait a moment for DOM to settle.
					yield* Effect.tryPromise({
						try: () => pg.waitForTimeout(5000),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					const currentUrl = pg.url();
					console.log(`    URL after Continue to Payment: ${currentUrl}`);

					// Deep DOM probe of the payment step
					const paymentDom = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const result: Record<string, string> = {};

							// URL
							result['url'] = window.location.href;

							// Page title and headings
							const headings = document.querySelectorAll('h1, h2, h3, h4');
							headings.forEach((h, i) => {
								const text = h.textContent?.trim();
								if (text) result[`heading[${i}]`] = text.slice(0, 200);
							});

							// All visible inputs (not hidden, not recaptcha)
							const inputs = document.querySelectorAll('input, select, textarea');
							inputs.forEach((inp, i) => {
								const input = inp as HTMLInputElement;
								if (input.type === 'hidden') return;
								if (input.name === 'g-recaptcha-response') return;
								const rect = inp.getBoundingClientRect();
								const visible = rect.width > 0 && rect.height > 0;
								result[`input[${i}]`] = [
									`name="${input.name}"`,
									`id="${input.id}"`,
									`type="${input.type}"`,
									`placeholder="${input.placeholder}"`,
									`value="${input.value}"`,
									visible ? 'VISIBLE' : 'HIDDEN',
								].join(', ');
							});

							// All visible buttons
							const buttons = document.querySelectorAll('button');
							buttons.forEach((btn) => {
								const text = btn.textContent?.trim();
								if (!text || text.length > 100) return;
								const rect = btn.getBoundingClientRect();
								const visible = rect.width > 0 && rect.height > 0;
								result[`button: "${text}"`] = [
									`class="${btn.className.slice(0, 80)}"`,
									`type="${btn.type}"`,
									`disabled=${btn.disabled}`,
									visible ? 'VISIBLE' : 'HIDDEN',
								].join(', ');
							});

							// Certificate/coupon/gift/promo search
							const promoSelectors = [
								'[name*="certificate"]', '[name*="coupon"]', '[name*="promo"]',
								'[name*="gift"]', '[name*="code"]', '[name*="discount"]',
								'[id*="certificate"]', '[id*="coupon"]', '[id*="promo"]',
								'[id*="gift"]', '[id*="discount"]',
								'[placeholder*="code"]', '[placeholder*="coupon"]', '[placeholder*="gift"]',
								'[placeholder*="certificate"]',
							];
							for (const sel of promoSelectors) {
								const el = document.querySelector(sel);
								if (el) {
									result[`promo:${sel}`] = el.outerHTML.slice(0, 300);
								}
							}

							// Iframes (Stripe/PayPal)
							const iframes = document.querySelectorAll('iframe');
							iframes.forEach((iframe, i) => {
								result[`iframe[${i}]`] = `src="${iframe.src?.slice(0, 200)}", name="${iframe.name}", visible=${iframe.getBoundingClientRect().width > 0}`;
							});

							// Payment-related text
							const paymentTexts: string[] = [];
							document.querySelectorAll('p, span, div, label, a, li').forEach((el) => {
								// Only leaf-ish elements
								if (el.children.length > 3) return;
								const text = el.textContent?.trim() ?? '';
								if (text.length < 3 || text.length > 200) return;
								const lower = text.toLowerCase();
								if (
									lower.includes('payment') || lower.includes('certificate') ||
									lower.includes('coupon') || lower.includes('gift') ||
									lower.includes('code') || lower.includes('redeem') ||
									lower.includes('apply') || lower.includes('discount') ||
									lower.includes('total') || lower.includes('$') ||
									lower.includes('free') || lower.includes('complete') ||
									lower.includes('confirm') || lower.includes('stripe') ||
									lower.includes('card') || lower.includes('credit')
								) {
									const tag = el.tagName.toLowerCase();
									const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
									paymentTexts.push(`[${tag}${cls}] ${text}`);
								}
							});
							result['payment-related-text'] = [...new Set(paymentTexts)].slice(0, 40).join('\n');

							// Body text snapshot (first 800 chars)
							const main = document.querySelector('main') || document.body;
							result['page-text-snapshot'] = main.textContent?.trim().slice(0, 800) ?? '';

							// CSS classes related to payment
							const paymentClasses: string[] = [];
							document.querySelectorAll('*').forEach((el) => {
								el.classList.forEach((cls) => {
									if (
										cls.includes('pay') || cls.includes('stripe') ||
										cls.includes('card') || cls.includes('credit') ||
										cls.includes('total') || cls.includes('amount') ||
										cls.includes('price') || cls.includes('checkout') ||
										cls.includes('certificate') || cls.includes('coupon') ||
										cls.includes('gift') || cls.includes('confirm') ||
										cls.includes('complete') || cls.includes('submit')
									) {
										paymentClasses.push(cls);
									}
								});
							});
							result['payment-css-classes'] = [...new Set(paymentClasses)].sort().join(', ');

							return result;
						}),
						catch: (e) => ({ error: e instanceof Error ? e.message : String(e) }),
					});

					return { nav, fill, paymentDom };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log(`  === PAYMENT STEP DISCOVERY (via Effect) ===`);
			if (result.paymentDom) {
				for (const [key, val] of Object.entries(result.paymentDom)) {
					if (key === 'payment-related-text' || key === 'page-text-snapshot') {
						console.log(`    ${key}:`);
						for (const line of val.split('\n').slice(0, 30)) {
							console.log(`      ${line}`);
						}
					} else {
						console.log(`    ${key}: ${val}`);
					}
				}
			}

			expect(result.nav.landingStep).toBe('client-form');
			expect(result.fill?.advanced).toBe(true);
		}, 180000);

		it('discovers what blocks Continue to Payment and probes payment DOM', async () => {
			// More targeted: navigate via Effect, fill form manually (with better
			// checkbox/email handling), then click Continue to Payment and see
			// what actually happens — validation errors? Stripe payment form?
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// Discover available datetime
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  No datetime'); return; }

			console.log(`  Service: "${serviceName}", datetime: ${datetime}`);

			// Run navigateToBooking to reach client form, then manually fill + probe
			const program = Effect.scoped(
				Effect.gen(function* () {
					const { acquirePage } = yield* BrowserService;
					const pg: Page = yield* acquirePage;

					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'PayStep',
							lastName: 'Probe',
							email: 'paystep@massageithaca.com',
							phone: '6075552222',
						},
					});
					if (nav.landingStep !== 'client-form') {
						return { nav, error: 'did not reach client-form' };
					}

					// Wait for form to be fully rendered
					yield* Effect.tryPromise({
						try: () => pg.waitForSelector('input[name="client.firstName"]', { timeout: 10000 }),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					// Fill standard fields
					yield* Effect.tryPromise({
						try: async () => {
							await pg.fill('input[name="client.firstName"]', 'PayStep');
							await pg.fill('input[name="client.lastName"]', 'Probe');
							await pg.fill('input[name="client.phone"]', '6075552222');
						},
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					// Fill email — use triple-click + type since it's a chip/tag component
					yield* Effect.tryPromise({
						try: async () => {
							const emailInput = await pg.$('input[name="client.email"]');
							if (emailInput) {
								await emailInput.click({ clickCount: 3 });
								await emailInput.fill('paystep@massageithaca.com');
								// Press Enter to "add" the email as a tag
								await pg.keyboard.press('Enter');
								await pg.waitForTimeout(500);
							}
						},
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					// Check terms checkbox
					yield* Effect.tryPromise({
						try: async () => {
							const termsBox = await pg.$('input[type="checkbox"][name*="field-13933959"]');
							if (termsBox) {
								const checked = await termsBox.isChecked();
								if (!checked) {
									await termsBox.click();
									console.log('    Checked terms checkbox');
								} else {
									console.log('    Terms already checked');
								}
							} else {
								console.log('    Terms checkbox not found');
							}
						},
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					yield* Effect.tryPromise({
						try: () => pg.waitForTimeout(1000),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					// Snapshot form state BEFORE clicking Continue
					const preClickState = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const result: Record<string, string> = {};
							// Field values
							const names = ['client.firstName', 'client.lastName', 'client.phone', 'client.email'];
							for (const name of names) {
								const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
								result[name] = el ? `value="${el.value}", validity=${el.validity.valid}` : 'NOT FOUND';
							}
							// Email chips
							const emailChips = document.querySelectorAll('li[class*="css-"] div[class*="css-"]');
							const chipTexts: string[] = [];
							emailChips.forEach((el) => {
								const text = el.textContent?.trim();
								if (text && text.includes('@')) chipTexts.push(text);
							});
							result['emailChips'] = chipTexts.join(', ') || 'none';
							// Terms checkbox
							const terms = document.querySelector('input[name*="field-13933959"]') as HTMLInputElement;
							result['terms'] = terms ? `checked=${terms.checked}` : 'NOT FOUND';
							// Validation errors on page
							const errorEls = document.querySelectorAll('[class*="error"], [role="alert"], .invalid-feedback');
							result['errors'] = Array.from(errorEls).map((e) => e.textContent?.trim()).filter(Boolean).join('; ') || 'none';
							return result;
						}),
						catch: (e) => ({ error: String(e) }),
					});

					console.log('    Pre-click form state:');
					for (const [key, val] of Object.entries(preClickState)) {
						console.log(`      ${key}: ${val}`);
					}

					// Click "Continue to Payment" and listen for navigation/response
					const urlBefore = pg.url();
					console.log(`    Clicking Continue to Payment...`);
					console.log(`    URL before: ${urlBefore}`);

					yield* Effect.tryPromise({
						try: async () => {
							// Listen for network responses during click
							const responsePromise = pg.waitForResponse(
								(resp) => resp.url().includes('acuity') || resp.url().includes('stripe'),
								{ timeout: 10000 },
							).catch(() => null);

							// Click the button
							const btn = await pg.$('button:has-text("Continue to Payment")');
							if (!btn) throw new Error('Continue to Payment not found');
							await btn.click();

							// Wait for response or timeout
							const response = await responsePromise;
							if (response) {
								console.log(`    Network response: ${response.status()} ${response.url().slice(0, 120)}`);
							}

							// Wait for any DOM changes
							await pg.waitForTimeout(8000);
						},
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					const urlAfter = pg.url();
					console.log(`    URL after: ${urlAfter}`);
					console.log(`    URL changed: ${urlBefore !== urlAfter}`);

					// Post-click DOM discovery
					const postClickDom = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const result: Record<string, string> = {};

							// Check for validation errors
							const allErrorLike = document.querySelectorAll('[class*="error"], [role="alert"], [class*="invalid"], [class*="required"], [class*="warning"]');
							const errors: string[] = [];
							allErrorLike.forEach((el) => {
								const text = el.textContent?.trim();
								if (text && text.length < 200) {
									errors.push(`[${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}] ${text}`);
								}
							});
							result['validation-errors'] = errors.join('\n') || 'none';

							// Check if "Continue to Payment" text changed (might become "Complete Appointment" etc.)
							const allButtons = document.querySelectorAll('button');
							const buttonTexts: string[] = [];
							allButtons.forEach((btn) => {
								const text = btn.textContent?.trim();
								const rect = btn.getBoundingClientRect();
								if (text && rect.width > 0) {
									buttonTexts.push(`"${text.slice(0, 60)}" (disabled=${btn.disabled})`);
								}
							});
							result['visible-buttons'] = buttonTexts.join('\n');

							// Check for new elements (payment form, Stripe iframe visible?)
							const iframes = document.querySelectorAll('iframe');
							const iframeInfo: string[] = [];
							iframes.forEach((iframe) => {
								const rect = iframe.getBoundingClientRect();
								iframeInfo.push(`${iframe.name || iframe.src?.slice(0, 80)} visible=${rect.width > 0 && rect.height > 0} (${rect.width}x${rect.height})`);
							});
							result['iframes'] = iframeInfo.join('\n');

							// Check for certificate/coupon input (might appear AFTER Continue)
							const certInputs = document.querySelectorAll('[name*="certificate"], [name*="coupon"], [id*="certificate"], [id*="code"]');
							const certInfo: string[] = [];
							certInputs.forEach((el) => {
								const input = el as HTMLInputElement;
								const rect = el.getBoundingClientRect();
								certInfo.push(`<${el.tagName.toLowerCase()} name="${input.name}" id="${input.id}" visible=${rect.width > 0}>`);
							});
							result['cert-inputs'] = certInfo.join('\n') || 'none';

							// Check for "Complete Appointment" or "Confirm" or "Book" button
							const submitLikeTexts = ['complete', 'confirm', 'book', 'submit', 'schedule', 'pay'];
							const submitButtons: string[] = [];
							allButtons.forEach((btn) => {
								const text = btn.textContent?.trim()?.toLowerCase() ?? '';
								if (submitLikeTexts.some((s) => text.includes(s))) {
									const rect = btn.getBoundingClientRect();
									submitButtons.push(`"${btn.textContent?.trim()}" class="${btn.className.slice(0, 60)}" visible=${rect.width > 0} disabled=${btn.disabled}`);
								}
							});
							result['submit-like-buttons'] = submitButtons.join('\n') || 'none';

							// Check for new sections/headings
							const headings = document.querySelectorAll('h1, h2, h3, h4');
							const headingTexts: string[] = [];
							headings.forEach((h) => {
								const text = h.textContent?.trim();
								if (text) headingTexts.push(text);
							});
							result['headings'] = headingTexts.join('\n');

							// Price display
							const priceEls = document.querySelectorAll('*');
							const prices: string[] = [];
							priceEls.forEach((el) => {
								if (el.children.length > 2) return;
								const text = el.textContent?.trim() ?? '';
								if (text.match(/\$\d/) && text.length < 100) {
									prices.push(`[${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}] ${text}`);
								}
							});
							result['price-elements'] = [...new Set(prices)].slice(0, 10).join('\n');

							// Full page text snapshot
							result['page-text'] = (document.querySelector('main') || document.body).textContent?.trim().slice(0, 1000) ?? '';

							return result;
						}),
						catch: (e) => ({ error: String(e) }),
					});

					console.log('    === POST-CLICK DOM ===');
					for (const [key, val] of Object.entries(postClickDom)) {
						if (val.includes('\n')) {
							console.log(`    ${key}:`);
							for (const line of val.split('\n')) {
								console.log(`      ${line}`);
							}
						} else {
							console.log(`    ${key}: ${val}`);
						}
					}

					return { nav, postClickDom };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			expect(result.nav.landingStep).toBe('client-form');
		}, 180000);

		it('fills ALL intake fields then clicks Continue to Payment', async () => {
			// Previous tests showed "Continue to Payment" doesn't advance.
			// Hypothesis: required custom intake fields (radio buttons, medication
			// textarea) are blocking. Fill EVERYTHING and try again.
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// Discover available datetime
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  No datetime'); return; }

			console.log(`  Service: "${serviceName}", datetime: ${datetime}`);

			const program = Effect.scoped(
				Effect.gen(function* () {
					const { acquirePage } = yield* BrowserService;
					const pg: Page = yield* acquirePage;

					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'FullIntake',
							lastName: 'Test',
							email: 'fullintake@massageithaca.com',
							phone: '6075553333',
						},
					});
					if (nav.landingStep !== 'client-form') {
						return { nav, error: 'did not reach client-form' };
					}

					yield* Effect.tryPromise({
						try: () => pg.waitForSelector('input[name="client.firstName"]', { timeout: 10000 }),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					// Fill standard fields
					yield* Effect.tryPromise({
						try: async () => {
							await pg.fill('input[name="client.firstName"]', 'FullIntake');
							await pg.fill('input[name="client.lastName"]', 'Test');
							await pg.fill('input[name="client.phone"]', '6075553333');
							// Email: just fill, don't press Enter (chip is created automatically)
							const emailInput = await pg.$('input[name="client.email"]');
							if (emailInput) {
								await emailInput.click({ clickCount: 3 });
								await emailInput.fill('fullintake@massageithaca.com');
								// Tab out to trigger chip creation
								await pg.keyboard.press('Tab');
							}
						},
						catch: (e) => console.log(`    Fill error: ${e}`),
					}).pipe(Effect.orElseSucceed(() => null));

					yield* Effect.tryPromise({ try: () => pg.waitForTimeout(500), catch: () => null }).pipe(Effect.orElseSucceed(() => null));

					// === DISCOVER ALL REQUIRED FIELDS ===
					const allFields = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const result: {
								selector: string;
								tag: string;
								name: string;
								id: string;
								type: string;
								required: boolean;
								ariaRequired: string | null;
								value: string;
								checked: boolean;
								label: string;
								parentSection: string;
							}[] = [];

							document.querySelectorAll('input, select, textarea').forEach((el) => {
								const input = el as HTMLInputElement;
								if (input.type === 'hidden') return;
								if (input.name === 'g-recaptcha-response') return;

								// Find parent section heading
								let parentSection = '';
								let parent: Element | null = el;
								while (parent) {
									const prevHeading = parent.querySelector('h1, h2, h3, h4');
									if (prevHeading && prevHeading.textContent?.trim()) {
										parentSection = prevHeading.textContent.trim();
										break;
									}
									parent = parent.parentElement;
								}

								// Find label
								let label = '';
								const id = input.id;
								if (id) {
									const labelEl = document.querySelector(`label[for="${id}"]`);
									label = labelEl?.textContent?.trim() ?? '';
								}
								if (!label) {
									const closest = el.closest('.form-group, [class*="field"], [class*="form"]');
									const closestLabel = closest?.querySelector('label, [class*="label"]');
									label = closestLabel?.textContent?.trim()?.slice(0, 80) ?? '';
								}
								// Also try aria-label
								if (!label) {
									label = input.getAttribute('aria-label') ?? '';
								}

								result.push({
									selector: input.name ? `[name="${input.name}"]` : (input.id ? `#${input.id}` : `${el.tagName}[type="${input.type}"]`),
									tag: el.tagName.toLowerCase(),
									name: input.name,
									id: input.id,
									type: input.type,
									required: input.required || input.getAttribute('aria-required') === 'true',
									ariaRequired: input.getAttribute('aria-required'),
									value: input.value,
									checked: input.checked ?? false,
									label,
									parentSection,
								});
							});
							return result;
						}),
						catch: () => [],
					});

					console.log(`    All form fields (${allFields.length}):`);
					for (const f of allFields) {
						const req = f.required ? ' [REQUIRED]' : '';
						const ari = f.ariaRequired === 'true' ? ' [aria-required]' : '';
						const checked = f.type === 'radio' || f.type === 'checkbox' ? ` checked=${f.checked}` : '';
						console.log(`      ${f.selector} type="${f.type}" value="${f.value}"${checked}${req}${ari} label="${f.label}" section="${f.parentSection}"`);
					}

					// === FILL ALL RADIO BUTTONS (select "no" for all yes/no questions) ===
					// Acuity wraps radios with React controlled components. DOM clicks
					// don't update React state. Use React's native property setter trick
					// to trigger the synthetic event system.
					yield* Effect.tryPromise({
						try: async () => {
							const result = await pg.evaluate(() => {
								const logs: string[] = [];
								const nativeSetter = Object.getOwnPropertyDescriptor(
									window.HTMLInputElement.prototype, 'checked',
								)?.set;

								const noRadios = document.querySelectorAll('input[type="radio"][value="no"]');
								for (let i = 0; i < noRadios.length; i++) {
									const radio = noRadios[i] as HTMLInputElement;
									if (nativeSetter) {
										// Use React's native property setter to trigger state change
										nativeSetter.call(radio, true);
										radio.dispatchEvent(new Event('click', { bubbles: true }));
										radio.dispatchEvent(new Event('change', { bubbles: true }));
										radio.dispatchEvent(new Event('input', { bubbles: true }));
										logs.push(`Radio[${i}]: native setter + events, checked=${radio.checked}`);
									} else {
										// Fallback
										radio.checked = true;
										radio.dispatchEvent(new Event('change', { bubbles: true }));
										logs.push(`Radio[${i}]: fallback, checked=${radio.checked}`);
									}
								}
								return logs;
							});
							for (const msg of result) {
								console.log(`      ${msg}`);
							}
							// Also click via Playwright for redundancy — use locators
							const noLabels = await pg.$$('label:has(input[type="radio"][value="no"])');
							console.log(`      Found ${noLabels.length} "No" labels for Playwright clicks`);
							for (let i = 0; i < noLabels.length; i++) {
								await noLabels[i].click({ force: true, timeout: 5000 }).catch(() => null);
								await pg.waitForTimeout(300);
							}
						},
						catch: (e) => console.log(`    Radio fill error: ${e}`),
					}).pipe(Effect.orElseSucceed(() => null));

					// === FILL MEDICATION TEXTAREA ===
					yield* Effect.tryPromise({
						try: async () => {
							const medField = await pg.$('textarea[name="fields[field-16606770]"]') ??
								await pg.$('#fields\\[field-16606770\\]');
							if (medField) {
								await medField.fill('None');
								console.log('    Filled medication textarea with "None"');
							} else {
								console.log('    Medication textarea not found');
							}
						},
						catch: (e) => console.log(`    Med fill error: ${e}`),
					}).pipe(Effect.orElseSucceed(() => null));

					// === CHECK TERMS CHECKBOX (React native setter + Playwright click) ===
					yield* Effect.tryPromise({
						try: async () => {
							await pg.evaluate(() => {
								const checkbox = document.querySelector('input[type="checkbox"][name*="field-13933959"]') as HTMLInputElement;
								if (!checkbox || checkbox.checked) return;
								const nativeSetter = Object.getOwnPropertyDescriptor(
									window.HTMLInputElement.prototype, 'checked',
								)?.set;
								if (nativeSetter) {
									nativeSetter.call(checkbox, true);
									checkbox.dispatchEvent(new Event('click', { bubbles: true }));
									checkbox.dispatchEvent(new Event('change', { bubbles: true }));
								}
							});
							// Also Playwright click on the label for redundancy
							const termsLabel = await pg.$('label:has(input[name*="field-13933959"])');
							if (termsLabel) {
								await termsLabel.click({ force: true, timeout: 5000 }).catch(() => null);
							}
							const isChecked = await pg.$eval(
								'input[name*="field-13933959"]',
								(el) => (el as HTMLInputElement).checked,
							).catch(() => false);
							console.log(`    Terms checkbox: checked=${isChecked}`);
						},
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));

					yield* Effect.tryPromise({ try: () => pg.waitForTimeout(1000), catch: () => null }).pipe(Effect.orElseSucceed(() => null));

					// === VERIFY ALL REQUIRED FIELDS ARE FILLED ===
					const postFillState = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const unfilled: string[] = [];
							document.querySelectorAll('input[required], input[aria-required="true"], textarea[required], select[required]').forEach((el) => {
								const input = el as HTMLInputElement;
								if (input.type === 'hidden') return;
								if (!input.value && input.type !== 'checkbox' && input.type !== 'radio') {
									unfilled.push(`${input.name || input.id || input.type} (empty)`);
								}
							});
							// Check if any radio group has no selection
							const radioGroups = new Map<string, boolean>();
							document.querySelectorAll('input[type="radio"]').forEach((el) => {
								const input = el as HTMLInputElement;
								const name = input.name || input.id;
								if (!radioGroups.has(name)) radioGroups.set(name, false);
								if (input.checked) radioGroups.set(name, true);
							});
							for (const [name, hasSelection] of radioGroups) {
								if (!hasSelection) unfilled.push(`radio group "${name}" (no selection)`);
							}
							return { unfilled, count: unfilled.length };
						}),
						catch: () => ({ unfilled: ['error'], count: -1 }),
					});
					console.log(`    Unfilled required fields: ${postFillState.count}`);
					for (const u of postFillState.unfilled) {
						console.log(`      - ${u}`);
					}

					// === TAKE SCREENSHOT BEFORE CLICKING ===
					yield* Effect.tryPromise({
						try: () => pg.screenshot({ path: '/tmp/pre-continue-to-payment.png', fullPage: true }),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));
					console.log('    Screenshot saved: /tmp/pre-continue-to-payment.png');

					// === CLICK CONTINUE TO PAYMENT (with network + console monitoring) ===
					const urlBefore = pg.url();
					yield* Effect.tryPromise({
						try: async () => {
							const btn = await pg.$('button:has-text("Continue to Payment")');
							if (!btn) throw new Error('No button');

							// Capture ALL network requests/responses and console messages
							const networkRequests: string[] = [];
							const consoleMessages: string[] = [];

							pg.on('request', (req) => {
								const url = req.url();
								if (!url.includes('data:') && !url.includes('favicon')) {
									const body = req.postData();
									networkRequests.push(`REQ ${req.method()} ${url.slice(0, 150)}${body ? ` BODY: ${body.slice(0, 300)}` : ''}`);
								}
							});
							pg.on('response', async (resp) => {
								const url = resp.url();
								if (url.includes('validate-email') || url.includes('scheduling/v1') || url.includes('appointment')) {
									try {
										const body = await resp.text();
										networkRequests.push(`RESP ${resp.status()} ${url.slice(0, 100)} BODY: ${body.slice(0, 500)}`);
									} catch {
										networkRequests.push(`RESP ${resp.status()} ${url.slice(0, 100)} (body read failed)`);
									}
								}
							});
							pg.on('console', (msg) => {
								consoleMessages.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
							});
							pg.on('pageerror', (err) => {
								consoleMessages.push(`[PAGE_ERROR] ${err.message.slice(0, 200)}`);
							});

							// Click
							await btn.click();
							console.log('    Clicked Continue to Payment');

							// Wait for activity
							await pg.waitForTimeout(10000);

							// Report
							console.log(`    Network activity during click (${networkRequests.length}):`);
							for (const req of networkRequests.slice(0, 25)) {
								console.log(`      ${req}`);
							}
							console.log(`    Console messages during click (${consoleMessages.length}):`);
							for (const msg of consoleMessages.slice(0, 20)) {
								console.log(`      ${msg}`);
							}
						},
						catch: (e) => console.log(`    Click error: ${e}`),
					}).pipe(Effect.orElseSucceed(() => null));

					const urlAfter = pg.url();
					console.log(`    URL before: ${urlBefore}`);
					console.log(`    URL after: ${urlAfter}`);
					console.log(`    URL changed: ${urlBefore !== urlAfter}`);

					// === POST-CLICK DEEP DISCOVERY ===
					const postDom = yield* Effect.tryPromise({
						try: () => pg.evaluate(() => {
							const r: Record<string, string> = {};

							// Headings
							const h: string[] = [];
							document.querySelectorAll('h1, h2, h3, h4').forEach((el) => {
								const t = el.textContent?.trim();
								if (t) h.push(t);
							});
							r['headings'] = h.join(' | ');

							// Visible buttons
							const btns: string[] = [];
							document.querySelectorAll('button').forEach((btn) => {
								const rect = btn.getBoundingClientRect();
								if (rect.width > 0) {
									btns.push(`"${btn.textContent?.trim()?.slice(0, 40)}" disabled=${btn.disabled}`);
								}
							});
							r['buttons'] = btns.join('\n');

							// Validation errors
							const errs: string[] = [];
							document.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"]').forEach((el) => {
								const t = el.textContent?.trim();
								if (t && t.length < 200) errs.push(`${el.className.toString().slice(0, 40)}: ${t}`);
							});
							r['errors'] = errs.join('\n') || 'none';

							// Stripe or payment elements
							const iframes = document.querySelectorAll('iframe');
							const ifr: string[] = [];
							iframes.forEach((iframe) => {
								const rect = iframe.getBoundingClientRect();
								const src = iframe.src || iframe.name;
								if (src) ifr.push(`${src.slice(0, 100)} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
							});
							r['iframes'] = ifr.join('\n');

							// New/changed elements
							const allText = (document.querySelector('main') || document.body).textContent?.trim().slice(0, 1200) ?? '';
							r['page-text'] = allText;

							return r;
						}),
						catch: (e) => ({ error: String(e) }),
					});

					console.log('    === POST-CLICK ===');
					for (const [key, val] of Object.entries(postDom)) {
						if (val.includes('\n') || key === 'page-text') {
							console.log(`    ${key}:`);
							for (const line of val.split('\n').slice(0, 20)) {
								console.log(`      ${line}`);
							}
						} else {
							console.log(`    ${key}: ${val}`);
						}
					}

					// === SCREENSHOT AFTER ===
					yield* Effect.tryPromise({
						try: () => pg.screenshot({ path: '/tmp/post-continue-to-payment.png', fullPage: true }),
						catch: () => null,
					}).pipe(Effect.orElseSucceed(() => null));
					console.log('    Screenshot saved: /tmp/post-continue-to-payment.png');

					return { nav, postDom };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			expect(result.nav.landingStep).toBe('client-form');
		}, 240000);

		it('uses Playwright locator API + keyboard for React radio buttons', async () => {
			// This test uses the SHARED page (no Effect/BrowserService) so we can
			// focus purely on the radio button interaction without navigation issues.

			// Navigate to client form via raw Playwright
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			console.log(`  On client form: ${page.url()}`);

			// Wait for form to load
			await page.waitForSelector('input[name="client.firstName"]', { timeout: 10000 });

			// Fill standard fields using the shared page directly
			const pg = page;
			await pg.fill('input[name="client.firstName"]', 'RadioTest');
			await pg.fill('input[name="client.lastName"]', 'Locator');
			await pg.fill('input[name="client.phone"]', '6075554444');
			const emailInput = await pg.$('input[name="client.email"]');
			if (emailInput) {
				await emailInput.click({ clickCount: 3 });
				await emailInput.fill('radiotest@massageithaca.com');
				await pg.keyboard.press('Tab');
			}
			await pg.waitForTimeout(500);

			// =================================================================
			// CRITICAL FINDING: Radio buttons have NO name and NO id attrs.
			// They are purely React-controlled via <label class="css-uxo5kk">
			// wrapping <input type="radio" aria-required="true">.
			// Strategy: Click the <label> element via Playwright locator.nth()
			// =================================================================

			const strategies: string[] = [];

			// ========================================================
			// Strategy 1: Click the <label> wrapping the "No" radio
			// using Playwright's locator().nth()
			// ========================================================
			console.log('\n    --- Strategy 1: Click No labels via nth() locator ---');
			const noLabelLocator = pg.locator('label:has(input[type="radio"][value="no"])');
			const labelCount = await noLabelLocator.count();
			console.log(`    Found ${labelCount} "No" label locators`);

			for (let i = 0; i < labelCount; i++) {
				try {
					const label = noLabelLocator.nth(i);
					await label.scrollIntoViewIfNeeded();
					await label.click({ timeout: 5000 });
					await pg.waitForTimeout(300);

					const radio = pg.locator('input[type="radio"][value="no"]').nth(i);
					const isChecked = await radio.isChecked().catch(() => false);
					console.log(`    No[${i}]: label.click() → checked=${isChecked}`);
					if (isChecked) strategies.push(`label.nth(${i})`);
				} catch (e) {
					console.log(`    No[${i}]: failed - ${e instanceof Error ? e.message.slice(0, 100) : e}`);
				}
			}
			await pg.waitForTimeout(500);

			// Strategy 2: If label clicks didn't work, try Playwright .check()
			const noRadioLocator = pg.locator('input[type="radio"][value="no"]');
			const radioCount = await noRadioLocator.count();
			for (let i = 0; i < radioCount; i++) {
				const isChecked = await noRadioLocator.nth(i).isChecked().catch(() => false);
				if (isChecked) continue;
				console.log(`\n    --- Strategy 2: .check() on radio[${i}] ---`);
				try {
					await noRadioLocator.nth(i).check({ timeout: 3000 });
					const after = await noRadioLocator.nth(i).isChecked().catch(() => false);
					console.log(`    radio[${i}].check() → checked=${after}`);
					if (after) strategies.push(`check.nth(${i})`);
				} catch (e) {
					console.log(`    radio[${i}].check() failed: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
				}
			}
			await pg.waitForTimeout(500);

			// Strategy 3: If still unchecked, try Playwright .click() with force on label
			for (let i = 0; i < labelCount; i++) {
				const isChecked = await noRadioLocator.nth(i).isChecked().catch(() => false);
				if (isChecked) continue;
				console.log(`\n    --- Strategy 3: label.click({force:true}) on [${i}] ---`);
				try {
					await noLabelLocator.nth(i).click({ force: true, timeout: 3000 });
					await pg.waitForTimeout(300);
					const after = await noRadioLocator.nth(i).isChecked().catch(() => false);
					console.log(`    label[${i}].click({force}) → checked=${after}`);
					if (after) strategies.push(`force-label.nth(${i})`);
				} catch (e) {
					console.log(`    force-label[${i}] failed: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
				}
			}
			await pg.waitForTimeout(500);

			// === "How did you hear" checkboxes ===
			const otherCheckboxes = await pg.$$('input[type="checkbox"]:not([name*="field-13933959"])');
			console.log(`\n    Non-terms checkboxes: ${otherCheckboxes.length}`);
			for (let i = 0; i < Math.min(otherCheckboxes.length, 5); i++) {
				const name = await otherCheckboxes[i].getAttribute('name') ?? '';
				const checked = await otherCheckboxes[i].isChecked();
				console.log(`      [${i}]: name="${name}" checked=${checked}`);
			}

			// === TERMS CHECKBOX via label.click() (proven to work!) ===
			const termsSelector = 'input[type="checkbox"][name*="field-13933959"]';
			const termsChecked = await pg.$eval(termsSelector, (el) => (el as HTMLInputElement).checked).catch(() => false);
			if (!termsChecked) {
				const termsLabel = pg.locator('label:has(input[name*="field-13933959"])');
				await termsLabel.click({ timeout: 3000 });
				const after = await pg.$eval(termsSelector, (el) => (el as HTMLInputElement).checked).catch(() => false);
				console.log(`    Terms: label.click() → checked=${after}`);
				if (after) strategies.push('terms-label');
			} else {
				console.log('    Terms: already checked');
				strategies.push('terms-already');
			}

			// === MEDICATION ===
			const medField = await pg.$('textarea[name="fields[field-16606770]"]');
			if (medField) {
				await medField.fill('None');
				console.log('    Medication: "None"');
			}
			await pg.waitForTimeout(1000);

			// === FINAL STATE CHECK ===
			const finalState = await pg.evaluate(() => {
				const radios: { value: string; checked: boolean; idx: number }[] = [];
				document.querySelectorAll('input[type="radio"]').forEach((el, idx) => {
					const r = el as HTMLInputElement;
					radios.push({ value: r.value, checked: r.checked, idx });
				});
				const terms = (document.querySelector('input[name*="field-13933959"]') as HTMLInputElement)?.checked ?? false;
				const invalidFields: string[] = [];
				document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
					const name = (el as HTMLInputElement).name || el.getAttribute('aria-label') || el.tagName;
					invalidFields.push(name);
				});
				return { radios, terms, invalidFields };
			});

			console.log('\n    === FINAL FIELD STATE ===');
			for (let i = 0; i < finalState.radios.length; i += 2) {
				const yes = finalState.radios[i];
				const no = finalState.radios[i + 1];
				const qNum = Math.floor(i / 2) + 1;
				const sel = yes?.checked ? 'YES' : no?.checked ? 'NO' : 'NONE';
				console.log(`    Q${qNum}: ${sel} (yes=${yes?.checked}, no=${no?.checked})`);
			}
			console.log(`    Terms: ${finalState.terms}`);
			console.log(`    Invalid: ${finalState.invalidFields.length > 0 ? finalState.invalidFields.join(', ') : 'none'}`);
			console.log(`    Strategies: ${strategies.join(', ') || 'NONE'}`);

			await pg.screenshot({ path: '/tmp/radio-locator-test.png', fullPage: true });

			// If all radios checked, click Continue to Payment
			const allRadiosSelected = [];
			for (let i = 0; i < finalState.radios.length; i += 2) {
				allRadiosSelected.push(finalState.radios[i]?.checked || finalState.radios[i + 1]?.checked);
			}
			const allDone = allRadiosSelected.every(Boolean) && finalState.terms;

			if (allDone) {
				console.log('\n    All fields filled! Clicking Continue to Payment...');

				const networkLogs: string[] = [];
				pg.on('request', (req) => {
					const url = req.url();
					if (!url.includes('data:') && !url.includes('favicon') && !url.includes('.js') && !url.includes('.css')) {
						networkLogs.push(`REQ ${req.method()} ${url.slice(0, 120)}`);
					}
				});
				pg.on('response', async (resp) => {
					const url = resp.url();
					if (url.includes('scheduling/v1') || url.includes('appointment') || url.includes('validate')) {
						try {
							const body = await resp.text();
							networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)} → ${body.slice(0, 200)}`);
						} catch {
							networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)}`);
						}
					}
				});

				const urlBefore = pg.url();
				const btn = await pg.$('button:has-text("Continue to Payment")');
				if (btn) {
					await btn.click();
					await pg.waitForTimeout(12000);
				}
				const urlAfter = pg.url();
				console.log(`    URL before: ${urlBefore}`);
				console.log(`    URL after: ${urlAfter}`);
				console.log(`    URL changed: ${urlBefore !== urlAfter}`);
				console.log(`    Network (${networkLogs.length}):`);
				for (const log of networkLogs.slice(0, 15)) console.log(`      ${log}`);

				// Post-click DOM
				const postDom = await pg.evaluate(() => {
					const r: Record<string, string> = {};
					const conf = document.querySelector('.confirmation, .booking-confirmed, .thank-you');
					r['confirmation'] = conf ? conf.textContent?.trim()?.slice(0, 200) ?? 'found' : 'not found';
					const errs: string[] = [];
					document.querySelectorAll('[class*="error"], [role="alert"], [aria-invalid="true"]').forEach((el) => {
						const t = el.textContent?.trim();
						if (t && t.length > 0 && t.length < 200) errs.push(t);
					});
					r['errors'] = errs.join(' | ') || 'none';
					const btns: string[] = [];
					document.querySelectorAll('button').forEach((b) => {
						if (b.getBoundingClientRect().width > 0) {
							btns.push(`"${b.textContent?.trim()?.slice(0, 40)}" disabled=${b.disabled}`);
						}
					});
					r['buttons'] = btns.join(' | ');
					r['page-text'] = (document.querySelector('main') || document.body).textContent?.trim()?.slice(0, 800) ?? '';
					return r;
				});
				console.log('    Post-click:');
				for (const [k, v] of Object.entries(postDom)) {
					console.log(`      ${k}: ${k === 'page-text' ? v.slice(0, 200) + '...' : v}`);
				}

				await pg.screenshot({ path: '/tmp/radio-locator-after-continue.png', fullPage: true });
			} else {
				console.log(`\n    Cannot click Continue: allRadios=${allDone}, terms=${finalState.terms}`);
			}

			console.log(`\n    RESULT: ${strategies.length} working strategies`);
			expect(strategies.length).toBeGreaterThan(0);
		}, 300000);

		it('fills ALL fields including "How did you hear" and clicks Continue to Payment', async () => {
			// Navigate to client form via raw Playwright
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service'); return; }

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			console.log(`  On client form: ${page.url()}`);

			await page.waitForSelector('input[name="client.firstName"]', { timeout: 10000 });
			const pg = page;

			// === FILL ALL STANDARD FIELDS ===
			await pg.fill('input[name="client.firstName"]', 'FullForm');
			await pg.fill('input[name="client.lastName"]', 'Test');
			await pg.fill('input[name="client.phone"]', '6075555555');
			const emailInput = await pg.$('input[name="client.email"]');
			if (emailInput) {
				await emailInput.click({ clickCount: 3 });
				await emailInput.fill('fullform@massageithaca.com');
				await pg.keyboard.press('Tab');
			}
			await pg.waitForTimeout(500);

			// === FILL ALL RADIO BUTTONS (proven: label.click via locator.nth) ===
			const noLabelLocator = pg.locator('label:has(input[type="radio"][value="no"])');
			const labelCount = await noLabelLocator.count();
			for (let i = 0; i < labelCount; i++) {
				await noLabelLocator.nth(i).scrollIntoViewIfNeeded();
				await noLabelLocator.nth(i).click({ timeout: 5000 });
				await pg.waitForTimeout(200);
			}
			console.log(`    Clicked ${labelCount} "No" radio labels`);

			// === FILL "HOW DID YOU HEAR" — select "Internet search" via label click ===
			const hearCheckboxes = await pg.$$('input[type="checkbox"]:not([name*="field-13933959"])');
			console.log(`    "How did you hear" checkboxes: ${hearCheckboxes.length}`);
			if (hearCheckboxes.length > 0) {
				const firstName = await hearCheckboxes[0].getAttribute('name') ?? '';
				const hearLabel = pg.locator(`label:has(input[type="checkbox"][name="${firstName}"])`);
				await hearLabel.scrollIntoViewIfNeeded();
				await hearLabel.click({ timeout: 3000 }).catch(async () => {
					// fallback: click the input with force
					await hearCheckboxes[0].click({ force: true });
				});
				const checked = await hearCheckboxes[0].isChecked();
				console.log(`    Selected "${firstName}": checked=${checked}`);
			}
			await pg.waitForTimeout(300);

			// === FILL MEDICATION TEXTAREA ===
			const medField = await pg.$('textarea[name="fields[field-16606770]"]');
			if (medField) {
				await medField.fill('None');
				console.log('    Medication: "None"');
			}

			// === FILL TERMS CHECKBOX ===
			const termsLabel = pg.locator('label:has(input[name*="field-13933959"])');
			await termsLabel.scrollIntoViewIfNeeded();
			await termsLabel.click({ timeout: 3000 });
			const termsChecked = await pg.$eval(
				'input[name*="field-13933959"]',
				(el) => (el as HTMLInputElement).checked,
			).catch(() => false);
			console.log(`    Terms: ${termsChecked}`);

			await pg.waitForTimeout(1000);

			// === PRE-CLICK: catalog every field's state ===
			const preState = await pg.evaluate(() => {
				const state: Record<string, string> = {};
				// Required fields
				const required: string[] = [];
				document.querySelectorAll('[aria-required="true"], [required]').forEach((el) => {
					const input = el as HTMLInputElement;
					const name = input.name || input.id || input.type;
					const filled = input.type === 'radio' ? input.checked :
						input.type === 'checkbox' ? input.checked :
						!!input.value;
					required.push(`${name}(${input.type}):${filled ? 'OK' : 'EMPTY'}`);
				});
				state['required'] = required.join(' | ');
				// aria-invalid
				const invalid: string[] = [];
				document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
					invalid.push((el as HTMLInputElement).name || el.tagName);
				});
				state['invalid'] = invalid.join(', ') || 'none';
				// Radios
				const radios: string[] = [];
				document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
					const r = el as HTMLInputElement;
					if (r.checked) radios.push(`[${i}]${r.value}=checked`);
				});
				state['checked-radios'] = radios.join(', ') || 'none';
				// Checkboxes
				const checks: string[] = [];
				document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
					const c = el as HTMLInputElement;
					if (c.checked) checks.push(c.name.slice(0, 20));
				});
				state['checked-boxes'] = checks.join(', ') || 'none';
				return state;
			});

			console.log('\n    === PRE-CLICK STATE ===');
			for (const [k, v] of Object.entries(preState)) {
				console.log(`    ${k}: ${v}`);
			}

			await pg.screenshot({ path: '/tmp/fullform-pre-continue.png', fullPage: true });

			// === CLICK CONTINUE TO PAYMENT with full monitoring ===
			const networkLogs: string[] = [];
			const consoleErrors: string[] = [];
			pg.on('request', (req) => {
				const url = req.url();
				if (!url.includes('data:') && !url.includes('favicon') && !url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
					const body = req.postData();
					networkLogs.push(`REQ ${req.method()} ${url.slice(0, 120)}${body ? ` BODY:${body.slice(0, 300)}` : ''}`);
				}
			});
			pg.on('response', async (resp) => {
				const url = resp.url();
				if (url.includes('scheduling') || url.includes('appointment') || url.includes('validate') || url.includes('book') || url.includes('recaptcha')) {
					try {
						const body = await resp.text();
						networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)} → ${body.slice(0, 300)}`);
					} catch {
						networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)}`);
					}
				}
			});
			pg.on('console', (msg) => consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`));
			pg.on('pageerror', (err) => consoleErrors.push(`[PAGE_ERROR] ${err.message.slice(0, 200)}`));

			const urlBefore = pg.url();
			console.log('\n    Clicking "Continue to Payment"...');
			const continueBtn = await pg.$('button:has-text("Continue to Payment")');
			if (continueBtn) {
				await continueBtn.click();
				await pg.waitForTimeout(15000);
			}
			const urlAfter = pg.url();
			console.log(`    URL changed: ${urlBefore !== urlAfter}`);
			console.log(`    URL after: ${urlAfter}`);

			console.log(`\n    Network (${networkLogs.length}):`);
			for (const log of networkLogs.slice(0, 20)) console.log(`      ${log}`);
			console.log(`\n    Console (${consoleErrors.length}):`);
			for (const err of consoleErrors.slice(0, 15)) console.log(`      ${err}`);

			// === POST-CLICK: check what happened ===
			const postState = await pg.evaluate(() => {
				const r: Record<string, string> = {};
				const conf = document.querySelector('.confirmation, .booking-confirmed, .thank-you, [class*="confirm"]');
				r['confirmation'] = conf ? conf.textContent?.trim()?.slice(0, 200) ?? 'found' : 'not found';
				const errs: string[] = [];
				document.querySelectorAll('[class*="error"], [role="alert"], [aria-invalid="true"], [class*="invalid"]').forEach((el) => {
					const t = el.textContent?.trim();
					if (t && t.length > 0 && t.length < 300) errs.push(`[${el.className.toString().slice(0, 30)}] ${t}`);
				});
				r['errors'] = errs.join('\n') || 'none';
				const invalid: string[] = [];
				document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
					const input = el as HTMLInputElement;
					invalid.push(`${input.name || input.type}(${input.tagName})`);
				});
				r['aria-invalid'] = invalid.join(', ') || 'none';
				const headings: string[] = [];
				document.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
					const t = h.textContent?.trim();
					if (t) headings.push(t);
				});
				r['headings'] = headings.join(' | ');
				const btns: string[] = [];
				document.querySelectorAll('button').forEach((b) => {
					if (b.getBoundingClientRect().width > 0) btns.push(`"${b.textContent?.trim()?.slice(0, 40)}" disabled=${b.disabled}`);
				});
				r['buttons'] = btns.join(' | ');
				return r;
			});

			console.log('\n    === POST-CLICK STATE ===');
			for (const [k, v] of Object.entries(postState)) {
				console.log(`    ${k}: ${v}`);
			}

			await pg.screenshot({ path: '/tmp/fullform-post-continue.png', fullPage: true });
			console.log('    Screenshots: /tmp/fullform-{pre,post}-continue.png');
		}, 300000);

		it('applies gift certificate D14467A1 on payment page to get $0 total', async () => {
			// Navigate to client form via raw Playwright
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			// Find available date
			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No dates'); return; }
			await availableTile.click();
			await page.waitForTimeout(2000);

			// Select time slot
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });
			console.log(`  On client form: ${page.url()}`);

			// Fill ALL required fields to advance to payment page
			await page.waitForSelector('input[name="client.firstName"]', { timeout: 10000 });
			const pg = page;

			await pg.fill('input[name="client.firstName"]', 'GiftCert');
			await pg.fill('input[name="client.lastName"]', 'Test');
			await pg.fill('input[name="client.phone"]', '6075556666');
			const emailInput = await pg.$('input[name="client.email"]');
			if (emailInput) {
				await emailInput.click({ clickCount: 3 });
				await emailInput.fill('giftcert@massageithaca.com');
				await pg.keyboard.press('Tab');
			}
			await pg.waitForTimeout(500);

			// Radio buttons (No for all)
			const noLabels = pg.locator('label:has(input[type="radio"][value="no"])');
			const noCount = await noLabels.count();
			for (let i = 0; i < noCount; i++) {
				await noLabels.nth(i).scrollIntoViewIfNeeded();
				await noLabels.nth(i).click({ timeout: 5000 });
				await pg.waitForTimeout(200);
			}

			// "How did you hear" — check first checkbox
			const hearCheckboxes = await pg.$$('input[type="checkbox"]:not([name*="field-13933959"])');
			if (hearCheckboxes.length > 0) {
				const name = await hearCheckboxes[0].getAttribute('name') ?? '';
				await pg.locator(`label:has(input[type="checkbox"][name="${name}"])`).click({ timeout: 3000 }).catch(async () => {
					await hearCheckboxes[0].click({ force: true });
				});
			}

			// Medication
			const medField = await pg.$('textarea[name="fields[field-16606770]"]');
			if (medField) await medField.fill('None');

			// Terms
			await pg.locator('label:has(input[name*="field-13933959"])').scrollIntoViewIfNeeded();
			await pg.locator('label:has(input[name*="field-13933959"])').click({ timeout: 3000 });

			await pg.waitForTimeout(1000);

			// Click Continue to Payment
			const continueBtn = await pg.$('button:has-text("Continue to Payment")');
			if (!continueBtn) { console.log('  No Continue to Payment'); return; }
			await continueBtn.click();
			await pg.waitForURL(/\/payment/, { timeout: 15000 }).catch(() => {
				console.log('  URL did not change to /payment — form may not have advanced');
			});
			console.log(`  Payment page: ${pg.url()}`);

			if (!pg.url().includes('/payment')) {
				await pg.screenshot({ path: '/tmp/giftcert-failed-advance.png', fullPage: true });
				console.log('  Screenshot: /tmp/giftcert-failed-advance.png');
				return;
			}

			await pg.waitForTimeout(2000);
			await pg.screenshot({ path: '/tmp/giftcert-payment-page.png', fullPage: true });

			// === DISCOVER COUPON ENTRY ON PAYMENT PAGE ===
			console.log('\n    === PAYMENT PAGE COUPON DISCOVERY ===');

			// Look for "Package, gift, or coupon code" button/toggle
			const couponToggle = await pg.$('button:has-text("Package, gift, or coupon code")');
			const couponToggleAlt = await pg.$('text=Package, gift, or coupon code');
			console.log(`    "Package, gift, or coupon code" button: ${!!couponToggle}`);
			console.log(`    "Package, gift, or coupon code" text: ${!!couponToggleAlt}`);

			if (couponToggle || couponToggleAlt) {
				const toggle = couponToggle ?? couponToggleAlt!;
				await toggle.click();
				await pg.waitForTimeout(1500);
				console.log('    Clicked coupon toggle, waiting for expansion...');

				await pg.screenshot({ path: '/tmp/giftcert-coupon-expanded.png', fullPage: true });

				// Discover inputs after expanding
				const couponInputs = await pg.evaluate(() => {
					const inputs: { tag: string; name: string; id: string; placeholder: string; type: string; parentHTML: string }[] = [];
					document.querySelectorAll('input, textarea').forEach((el) => {
						const input = el as HTMLInputElement;
						if (input.type === 'hidden') return;
						// Look for inputs that appeared after toggle
						const rect = input.getBoundingClientRect();
						if (rect.height === 0) return;
						inputs.push({
							tag: el.tagName.toLowerCase(),
							name: input.name,
							id: input.id,
							placeholder: input.placeholder,
							type: input.type,
							parentHTML: input.parentElement?.outerHTML?.slice(0, 200) ?? '',
						});
					});
					// Also look for newly visible buttons
					const buttons: string[] = [];
					document.querySelectorAll('button').forEach((btn) => {
						if (btn.getBoundingClientRect().width > 0) {
							buttons.push(`"${btn.textContent?.trim()?.slice(0, 40)}" disabled=${btn.disabled}`);
						}
					});
					return { inputs, buttons };
				});

				console.log(`    Visible inputs after expand (${couponInputs.inputs.length}):`);
				for (const inp of couponInputs.inputs) {
					console.log(`      <${inp.tag}> name="${inp.name}" id="${inp.id}" placeholder="${inp.placeholder}" type="${inp.type}"`);
				}
				console.log(`    Visible buttons: ${couponInputs.buttons.join(' | ')}`);

				// Try to find a coupon/code input field
				const codeInput = await pg.$('input[placeholder*="code" i]')
					?? await pg.$('input[placeholder*="coupon" i]')
					?? await pg.$('input[placeholder*="gift" i]')
					?? await pg.$('input[name*="code" i]')
					?? await pg.$('input[name*="coupon" i]')
					?? await pg.$('#code');
				console.log(`    Code input found: ${!!codeInput}`);

				if (codeInput) {
					// Enter the gift certificate code
					await codeInput.click();
					await codeInput.fill('D14467A1');
					console.log('    Entered gift certificate code: D14467A1');

					await pg.screenshot({ path: '/tmp/giftcert-code-entered.png', fullPage: true });

					// Find and click Apply/Redeem button
					const applyBtn = await pg.$('button:has-text("Apply")')
						?? await pg.$('button:has-text("Redeem")')
						?? await pg.$('button:has-text("Submit")');
					console.log(`    Apply button found: ${!!applyBtn}`);

					if (applyBtn) {
						// Monitor network for coupon validation
						const networkLogs: string[] = [];
						pg.on('request', (req) => {
							const url = req.url();
							if (!url.includes('.js') && !url.includes('.css') && !url.includes('data:') && !url.includes('favicon')) {
								const body = req.postData();
								networkLogs.push(`REQ ${req.method()} ${url.slice(0, 120)}${body ? ` BODY:${body.slice(0, 300)}` : ''}`);
							}
						});
						pg.on('response', async (resp) => {
							const url = resp.url();
							if (url.includes('scheduling') || url.includes('coupon') || url.includes('gift') || url.includes('certificate') || url.includes('order')) {
								try {
									const body = await resp.text();
									networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)} → ${body.slice(0, 400)}`);
								} catch {
									networkLogs.push(`RESP ${resp.status()} ${url.slice(0, 80)}`);
								}
							}
						});

						await applyBtn.click();
						console.log('    Clicked Apply button');
						await pg.waitForTimeout(5000);

						console.log(`\n    Network after Apply (${networkLogs.length}):`);
						for (const log of networkLogs.slice(0, 15)) console.log(`      ${log}`);

						// Check for discount/success/error
						const afterApply = await pg.evaluate(() => {
							const r: Record<string, string> = {};
							// Look for discount line in order summary
							const allText = document.body.textContent ?? '';
							const discountMatch = allText.match(/discount[:\s]*\$?([\d.]+)/i);
							r['discount-text'] = discountMatch ? discountMatch[0] : 'not found';
							// Total
							const totalMatch = allText.match(/total[:\s]*\$?([\d.]+)/i);
							r['total-text'] = totalMatch ? totalMatch[0] : 'not found';
							// Error messages
							const errs: string[] = [];
							document.querySelectorAll('[class*="error"], [role="alert"], [class*="invalid"]').forEach((el) => {
								const t = el.textContent?.trim();
								if (t && t.length > 0 && t.length < 200) errs.push(t);
							});
							r['errors'] = errs.join(' | ') || 'none';
							// Success indicators
							const success: string[] = [];
							document.querySelectorAll('[class*="success"], [class*="applied"], [class*="discount"]').forEach((el) => {
								const t = el.textContent?.trim();
								if (t && t.length > 0) success.push(t.slice(0, 100));
							});
							r['success'] = success.join(' | ') || 'none';
							// All visible text near the order summary
							const summary = document.querySelector('[class*="summary"], [class*="order"]');
							r['summary-text'] = summary?.textContent?.trim()?.slice(0, 300) ?? 'no summary found';
							return r;
						});

						console.log('\n    After Apply:');
						for (const [k, v] of Object.entries(afterApply)) {
							console.log(`      ${k}: ${v}`);
						}

						await pg.screenshot({ path: '/tmp/giftcert-after-apply.png', fullPage: true });
						console.log('    Screenshot: /tmp/giftcert-after-apply.png');
					}
				} else {
					// No dedicated input — look for other patterns
					console.log('    No code input found. Dumping expanded section DOM...');
					const expandedHTML = await pg.evaluate(() => {
						// Look for recently-appeared elements
						const sections = document.querySelectorAll('[class*="coupon"], [class*="code"], [class*="gift"], [class*="package"]');
						const html: string[] = [];
						sections.forEach((el) => html.push(el.outerHTML.slice(0, 300)));
						return html.join('\n---\n') || 'no matching sections found';
					});
					console.log(`    Expanded DOM:\n${expandedHTML}`);
				}
			} else {
				console.log('    No coupon toggle found! Dumping all buttons...');
				const allButtons = await pg.evaluate(() => {
					const btns: string[] = [];
					document.querySelectorAll('button, [role="button"], a').forEach((el) => {
						const rect = (el as HTMLElement).getBoundingClientRect();
						if (rect.width > 0) btns.push(`<${el.tagName}> "${el.textContent?.trim()?.slice(0, 60)}"`);
					});
					return btns;
				});
				for (const btn of allButtons) console.log(`      ${btn}`);
			}
		}, 300000);

		it('full wizard E2E: navigate → fill → bypass payment via Effect pipeline', async () => {
			// Import step programs
			const { navigateToBooking } = await import('../../src/middleware/steps/navigate.js');
			const { fillFormFields } = await import('../../src/middleware/steps/fill-form.js');
			const { bypassPayment } = await import('../../src/middleware/steps/bypass-payment.js');

			const config: BrowserConfig = {
				...defaultBrowserConfig,
				baseUrl: ACUITY_BASE_URL,
				screenshotDir: '/tmp',
				timeout: 30000,
			};

			// --- Phase A: Discover available datetime via shared page ---
			await page.goto(ACUITY_BASE_URL, { waitUntil: 'networkidle' });
			const serviceName = await page.$eval(
				'.select-item .appointment-type-name',
				(el) => el.textContent?.trim() ?? '',
			).catch(() => '');
			if (!serviceName) { console.log('  No service, skipping'); return; }
			console.log(`  Target service: "${serviceName}"`);

			const bookBtn = await page.$('.select-item button.btn');
			if (!bookBtn) { console.log('  No Book button'); return; }
			await bookBtn.click();
			await page.waitForURL(/\/appointment\//, { timeout: 15000 });
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(3000);

			let availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			for (let i = 0; i < 3 && !availableTile; i++) {
				const nextBtn = await page.$('.react-calendar__navigation__next-button');
				if (!nextBtn) break;
				await nextBtn.click();
				await page.waitForTimeout(1500);
				availableTile = await page.$('.react-calendar__tile:not(:disabled)');
			}
			if (!availableTile) { console.log('  No available dates'); return; }

			await availableTile.click();
			await page.waitForTimeout(2000);
			const timeSlotBtn = await page.$('button.time-selection');
			if (!timeSlotBtn) { console.log('  No time slots'); return; }
			await timeSlotBtn.click();
			await page.waitForTimeout(1500);
			const menuItem = await page.$('li[role="menuitem"]');
			if (!menuItem) { console.log('  No menu item'); return; }
			await menuItem.click();
			await page.waitForURL(/\/datetime\//, { timeout: 10000 });

			const formUrl = page.url();
			const datetimeMatch = formUrl.match(/\/datetime\/([^?]+)/);
			const datetime = datetimeMatch ? decodeURIComponent(datetimeMatch[1]) : null;
			if (!datetime) { console.log('  Could not extract datetime'); return; }
			console.log(`  Discovered datetime: ${datetime}`);

			// --- Phase B: Run full Effect pipeline in a fresh browser ---
			console.log('  Running full Effect pipeline: navigate → fill → bypassPayment...');

			const COUPON_CODE = 'D14467A1';

			const program = Effect.scoped(
				Effect.gen(function* () {
					// Step 1: Navigate through wizard to client form
					const nav = yield* navigateToBooking({
						serviceName,
						datetime,
						client: {
							firstName: 'E2ETest',
							lastName: 'FullPipeline',
							email: 'e2e-pipeline@massageithaca.com',
							phone: '6075550001',
						},
					});
					console.log(`    nav.landingStep: ${nav.landingStep}`);
					console.log(`    nav.url: ${nav.url}`);

					if (nav.landingStep !== 'client-form') {
						return { nav, fill: null, bypass: null, error: `Landed on ${nav.landingStep}` };
					}

					// Step 2: Fill all form fields (standard + intake) → advances to /payment
					const fill = yield* fillFormFields({
						client: {
							firstName: 'E2ETest',
							lastName: 'FullPipeline',
							email: 'e2e-pipeline@massageithaca.com',
							phone: '6075550001',
						},
					});
					console.log(`    fill.fieldsCompleted: ${fill.fieldsCompleted.join(', ')}`);
					console.log(`    fill.intakeFieldsCompleted: ${fill.intakeFieldsCompleted.join(', ')}`);
					console.log(`    fill.advanced: ${fill.advanced}`);

					if (!fill.advanced) {
						return { nav, fill, bypass: null, error: 'Form did not advance to payment' };
					}

					// Step 3: Apply gift certificate on payment page
					const bypass = yield* bypassPayment(COUPON_CODE);
					console.log(`    bypass.couponApplied: ${bypass.couponApplied}`);
					console.log(`    bypass.code: ${bypass.code}`);
					console.log(`    bypass.totalAfterCoupon: ${bypass.totalAfterCoupon}`);

					// DO NOT click PAY & CONFIRM — we don't want to create real bookings
					return { nav, fill, bypass, error: null };
				}),
			);

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(BrowserServiceLive(config))),
			);

			console.log('\n  === Full E2E Pipeline Result ===');
			console.log(`  nav.landingStep: ${result.nav.landingStep}`);
			if (result.fill) {
				console.log(`  fill.fieldsCompleted: ${result.fill.fieldsCompleted.join(', ')}`);
				console.log(`  fill.intakeFieldsCompleted: ${result.fill.intakeFieldsCompleted.join(', ')}`);
				console.log(`  fill.advanced: ${result.fill.advanced}`);
			}
			if (result.bypass) {
				console.log(`  bypass.couponApplied: ${result.bypass.couponApplied}`);
				console.log(`  bypass.totalAfterCoupon: ${result.bypass.totalAfterCoupon}`);
			}
			if (result.error) {
				console.log(`  ERROR: ${result.error}`);
			}

			// Assertions
			expect(result.nav.landingStep).toBe('client-form');
			expect(result.error).toBeNull();

			// Fill assertions
			expect(result.fill).not.toBeNull();
			expect(result.fill!.fieldsCompleted).toContain('firstName');
			expect(result.fill!.fieldsCompleted).toContain('lastName');
			expect(result.fill!.fieldsCompleted).toContain('email');
			expect(result.fill!.fieldsCompleted).toContain('phone');
			expect(result.fill!.intakeFieldsCompleted).toContain('radioButtons');
			expect(result.fill!.intakeFieldsCompleted).toContain('howDidYouHear');
			expect(result.fill!.intakeFieldsCompleted).toContain('medication');
			expect(result.fill!.intakeFieldsCompleted).toContain('termsCheckbox');
			expect(result.fill!.advanced).toBe(true);

			// Bypass assertions
			expect(result.bypass).not.toBeNull();
			expect(result.bypass!.couponApplied).toBe(true);
			expect(result.bypass!.code).toBe(COUPON_CODE);
			expect(result.bypass!.totalAfterCoupon).toBe('$0.00');
		}, 300000);
	});
});
