/**
 * Provider Fixtures
 * Static test data for calendars / providers
 */

import type { Provider } from '../../core/types.js';

// =============================================================================
// MASSAGE ITHACA PROVIDERS (Production-like)
// =============================================================================

/**
 * Primary provider - Jen Sullivan
 */
export const jenProvider: Provider = {
  id: '67890',
  name: 'Jen Sullivan',
  email: 'jen@massageithaca.com',
  description:
    'Licensed massage therapist specializing in TMD/TMJ treatment and therapeutic massage.',
  image: 'https://massageithaca.com/images/jen-sullivan.jpg',
  timezone: 'America/New_York',
};

/**
 * Secondary provider (for multi-provider testing)
 */
export const guestProvider: Provider = {
  id: '67891',
  name: 'Guest Therapist',
  email: 'guest@massageithaca.com',
  description: 'Guest therapist available for overflow appointments.',
  timezone: 'America/New_York',
};

/**
 * All providers
 */
export const allProviders: Provider[] = [jenProvider, guestProvider];

// =============================================================================
// EDGE CASE FIXTURES
// =============================================================================

/**
 * Provider with minimal info
 */
export const minimalProvider: Provider = {
  id: '10001',
  name: 'Min Provider',
  timezone: 'UTC',
};

/**
 * Provider with all optional fields
 */
export const fullProvider: Provider = {
  id: '10002',
  name: 'Full Provider',
  email: 'full@example.com',
  description: 'A provider with all optional fields populated for comprehensive testing.',
  image: 'https://example.com/image.jpg',
  timezone: 'America/Los_Angeles',
};

/**
 * Provider in different timezone
 */
export const pacificProvider: Provider = {
  id: '10003',
  name: 'Pacific Provider',
  email: 'pacific@example.com',
  timezone: 'America/Los_Angeles',
};

/**
 * Provider in European timezone
 */
export const londonProvider: Provider = {
  id: '10004',
  name: 'London Provider',
  email: 'london@example.co.uk',
  timezone: 'Europe/London',
};

/**
 * Provider with unicode name
 */
export const unicodeProvider: Provider = {
  id: '10005',
  name: 'María García-López',
  email: 'maria@ejemplo.es',
  description: 'Terapeuta especializada en masaje terapéutico.',
  timezone: 'Europe/Madrid',
};

// =============================================================================
// ACUITY RAW RESPONSE FIXTURES
// =============================================================================

/**
 * Raw Acuity calendar response
 */
export const acuityCalendarsRaw = [
  {
    id: 67890,
    name: 'Jen Sullivan',
    email: 'jen@massageithaca.com',
    description:
      'Licensed massage therapist specializing in TMD/TMJ treatment and therapeutic massage.',
    image: 'https://massageithaca.com/images/jen-sullivan.jpg',
    timezone: 'America/New_York',
  },
  {
    id: 67891,
    name: 'Guest Therapist',
    email: 'guest@massageithaca.com',
    description: 'Guest therapist available for overflow appointments.',
    image: '',
    timezone: 'America/New_York',
  },
];

/**
 * Acuity calendar with edge cases
 */
export const acuityCalendarsEdgeCasesRaw = [
  {
    id: 99990,
    name: '', // Empty name
    email: null,
    description: null,
    image: null,
    timezone: 'UTC',
  },
  {
    id: 99991,
    name: 'Unicode: áéíóú 中文 日本語',
    email: 'test@test.com',
    description: 'Testing unicode handling',
    image: 'https://example.com/unicode-image.jpg',
    timezone: 'Asia/Tokyo',
  },
];
