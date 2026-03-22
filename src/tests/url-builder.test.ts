/**
 * URL Builder Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildAcuityUrl,
  buildCategoryUrl,
  buildTMDUrl,
  buildBookingUrl,
  parseAcuityUrl,
  generateIframeHtml,
} from '../lib/url-builder.js';

describe('buildAcuityUrl', () => {
  const baseUrl = 'https://MassageIthaca.as.me';

  describe('client pre-fill', () => {
    it('adds client information to URL', () => {
      const url = buildAcuityUrl({
        baseUrl,
        client: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          phone: '6072014926',
        },
      });

      expect(url).toContain('firstName=Jane');
      expect(url).toContain('lastName=Doe');
      expect(url).toContain('email=jane%40example.com');
      expect(url).toContain('phone=6072014926');
    });

    it('handles partial client info', () => {
      const url = buildAcuityUrl({
        baseUrl,
        client: {
          firstName: 'Jane',
        },
      });

      expect(url).toContain('firstName=Jane');
      expect(url).not.toContain('lastName=');
      expect(url).not.toContain('email=');
    });
  });

  describe('service selection', () => {
    it('adds single service ID', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          serviceId: '12345',
        },
      });

      expect(url).toContain('appointmentType=12345');
    });

    it('adds category filter', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          category: 'TMD Massage',
        },
      });

      expect(url).toContain('appointmentType=category%3ATMD+Massage');
    });

    it('adds multiple service IDs', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          serviceIds: ['123', '456', '789'],
        },
      });

      expect(url).toContain('appointmentType%5B%5D=123');
      expect(url).toContain('appointmentType%5B%5D=456');
      expect(url).toContain('appointmentType%5B%5D=789');
    });

    it('prefers serviceIds over category over serviceId', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          serviceId: '111',
          category: 'Massage',
          serviceIds: ['222', '333'],
        },
      });

      // serviceIds should win
      expect(url).toContain('appointmentType%5B%5D=222');
      expect(url).not.toContain('appointmentType=111');
      expect(url).not.toContain('category');
    });
  });

  describe('booking parameters', () => {
    it('adds provider ID', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          providerId: '67890',
        },
      });

      expect(url).toContain('calendarID=67890');
    });

    it('adds datetime', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          datetime: '2026-02-15T14:00-05:00',
        },
      });

      expect(url).toContain('datetime=2026-02-15T14%3A00-05%3A00');
    });

    it('adds certificate code', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          certificate: 'DISCOUNT20',
        },
      });

      expect(url).toContain('certificate=DISCOUNT20');
    });

    it('adds template preference', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          template: 'monthly',
        },
      });

      expect(url).toContain('template=monthly');
    });
  });

  describe('custom fields', () => {
    it('adds text field', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          customFields: {
            '12345': 'Custom Value',
          },
        },
      });

      expect(url).toContain('field%3A12345=Custom+Value');
    });

    it('adds checkbox/multi-select fields', () => {
      const url = buildAcuityUrl({
        baseUrl,
        booking: {
          customFields: {
            '67890': ['Option1', 'Option2'],
          },
        },
      });

      expect(url).toContain('field%3A67890%5B%5D=Option1');
      expect(url).toContain('field%3A67890%5B%5D=Option2');
    });
  });

  describe('extra parameters', () => {
    it('adds arbitrary extra params', () => {
      const url = buildAcuityUrl({
        baseUrl,
        extra: {
          ref: 'homepage',
          utm_source: 'google',
        },
      });

      expect(url).toContain('ref=homepage');
      expect(url).toContain('utm_source=google');
    });
  });

  describe('combined URL', () => {
    it('builds complete booking URL', () => {
      const url = buildAcuityUrl({
        baseUrl,
        client: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          phone: '6072014926',
        },
        booking: {
          serviceId: '52957336',
          datetime: '2026-02-15T14:00-05:00',
          providerId: '100',
        },
      });

      expect(url).toContain('firstName=Jane');
      expect(url).toContain('lastName=Doe');
      expect(url).toContain('email=jane%40example.com');
      expect(url).toContain('appointmentType=52957336');
      expect(url).toContain('datetime=');
      expect(url).toContain('calendarID=100');
    });
  });
});

describe('convenience functions', () => {
  const baseUrl = 'https://MassageIthaca.as.me';

  it('buildCategoryUrl creates category URL', () => {
    const url = buildCategoryUrl(baseUrl, 'TMD Massage', { firstName: 'Jane' });

    expect(url).toContain('appointmentType=category%3ATMD+Massage');
    expect(url).toContain('firstName=Jane');
  });

  it('buildTMDUrl creates TMD-specific URL', () => {
    const url = buildTMDUrl(baseUrl);

    expect(url).toContain('appointmentType=category%3ATMD+Massage');
  });

  it('buildBookingUrl creates full booking URL', () => {
    const url = buildBookingUrl(baseUrl, '12345', '2026-02-15T14:00-05:00', {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });

    expect(url).toContain('appointmentType=12345');
    expect(url).toContain('datetime=');
    expect(url).toContain('firstName=Jane');
  });
});

describe('parseAcuityUrl', () => {
  it('parses client info', () => {
    const url =
      'https://MassageIthaca.as.me?firstName=Jane&lastName=Doe&email=jane%40example.com&phone=6072014926';
    const parsed = parseAcuityUrl(url);

    expect(parsed.client.firstName).toBe('Jane');
    expect(parsed.client.lastName).toBe('Doe');
    expect(parsed.client.email).toBe('jane@example.com');
    expect(parsed.client.phone).toBe('6072014926');
  });

  it('parses single service ID', () => {
    const url = 'https://MassageIthaca.as.me?appointmentType=12345';
    const parsed = parseAcuityUrl(url);

    expect(parsed.booking.serviceId).toBe('12345');
  });

  it('parses category', () => {
    const url = 'https://MassageIthaca.as.me?appointmentType=category%3ATMD+Massage';
    const parsed = parseAcuityUrl(url);

    expect(parsed.booking.category).toBe('TMD Massage');
    expect(parsed.booking.serviceId).toBeUndefined();
  });

  it('parses datetime', () => {
    const url = 'https://MassageIthaca.as.me?datetime=2026-02-15T14%3A00-05%3A00';
    const parsed = parseAcuityUrl(url);

    expect(parsed.booking.datetime).toBe('2026-02-15T14:00-05:00');
  });

  it('parses custom fields', () => {
    const url = 'https://MassageIthaca.as.me?field%3A12345=Value&field%3A67890%5B%5D=A&field%3A67890%5B%5D=B';
    const parsed = parseAcuityUrl(url);

    expect(parsed.booking.customFields?.['12345']).toBe('Value');
    expect(parsed.booking.customFields?.['67890']).toEqual(['A', 'B']);
  });

  it('extracts base URL', () => {
    const url = 'https://MassageIthaca.as.me/schedule?appointmentType=12345';
    const parsed = parseAcuityUrl(url);

    expect(parsed.baseUrl).toBe('https://massageithaca.as.me/schedule');
  });
});

describe('generateIframeHtml', () => {
  it('generates basic iframe', () => {
    const html = generateIframeHtml('https://MassageIthaca.as.me');

    expect(html).toContain('src="https://MassageIthaca.as.me"');
    expect(html).toContain('title="Schedule Appointment"');
    expect(html).toContain('width="100%"');
    expect(html).toContain('height="800"');
    expect(html).toContain('frameborder="0"');
  });

  it('accepts custom options', () => {
    const html = generateIframeHtml('https://MassageIthaca.as.me', {
      width: 600,
      height: 400,
      title: 'Book Now',
      className: 'acuity-embed',
      id: 'booking-iframe',
    });

    expect(html).toContain('width="600"');
    expect(html).toContain('height="400"');
    expect(html).toContain('title="Book Now"');
    expect(html).toContain('class="acuity-embed"');
    expect(html).toContain('id="booking-iframe"');
  });
});
