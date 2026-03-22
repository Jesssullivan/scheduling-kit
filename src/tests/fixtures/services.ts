/**
 * Service Fixtures
 * Static test data for appointment types / services
 */

import type { Service } from '../../core/types.js';

// =============================================================================
// MASSAGE ITHACA SERVICES (Production-like)
// =============================================================================

/**
 * TMD 60min - Main TMD service
 */
export const tmd60Service: Service = {
  id: '12345',
  name: 'TMD 60 min (including intraoral)',
  description:
    'Comprehensive 60-minute session for TMD/TMJ treatment including intraoral massage techniques.',
  duration: 60,
  price: 20000, // $200
  currency: 'USD',
  category: 'TMD',
  color: '#4A90D9',
  active: true,
};

/**
 * TMD 30min - Shorter TMD service
 */
export const tmd30Service: Service = {
  id: '12346',
  name: 'TMD 30 min (including intraoral)',
  description: 'Focused 30-minute TMD/TMJ treatment session.',
  duration: 30,
  price: 10000, // $100
  currency: 'USD',
  category: 'TMD',
  color: '#4A90D9',
  active: true,
};

/**
 * TMD Consultation
 */
export const tmdConsultService: Service = {
  id: '12347',
  name: 'TMD 1st Visit/Consultation',
  description: 'Initial consultation and assessment for TMD/TMJ conditions.',
  duration: 60,
  price: 15000, // $150
  currency: 'USD',
  category: 'TMD',
  color: '#4A90D9',
  active: true,
};

/**
 * Neck/Cervical Medical Massage 60min
 */
export const neckMassage60Service: Service = {
  id: '12348',
  name: 'Neck/Cervical Medical Massage 60 min',
  description: 'Therapeutic massage focused on neck and cervical spine.',
  duration: 60,
  price: 15000, // $150
  currency: 'USD',
  category: 'Massage',
  color: '#7B68EE',
  active: true,
};

/**
 * Neck/Cervical Medical Massage 30min
 */
export const neckMassage30Service: Service = {
  id: '12349',
  name: 'Neck/Cervical Medical Massage 30 min',
  description: 'Focused 30-minute neck and cervical massage.',
  duration: 30,
  price: 7500, // $75
  currency: 'USD',
  category: 'Massage',
  color: '#7B68EE',
  active: true,
};

/**
 * All active services
 */
export const allServices: Service[] = [
  tmd60Service,
  tmd30Service,
  tmdConsultService,
  neckMassage60Service,
  neckMassage30Service,
];

/**
 * TMD category services only
 */
export const tmdServices: Service[] = [tmd60Service, tmd30Service, tmdConsultService];

/**
 * Massage category services only
 */
export const massageServices: Service[] = [neckMassage60Service, neckMassage30Service];

// =============================================================================
// EDGE CASE FIXTURES
// =============================================================================

/**
 * Service with minimum valid values
 */
export const minimalService: Service = {
  id: '1',
  name: 'A',
  duration: 5,
  price: 0,
  currency: 'USD',
  active: true,
};

/**
 * Service with all optional fields populated
 */
export const fullyPopulatedService: Service = {
  id: '99999',
  name: 'Full Service',
  description: 'A service with all fields populated for testing.',
  duration: 120,
  price: 50000, // $500
  currency: 'USD',
  category: 'Premium',
  color: '#FF5733',
  active: true,
};

/**
 * Inactive service (should be filtered in most queries)
 */
export const inactiveService: Service = {
  id: '00001',
  name: 'Discontinued Service',
  description: 'This service is no longer offered.',
  duration: 60,
  price: 10000,
  currency: 'USD',
  category: 'Legacy',
  active: false,
};

/**
 * Service with very long name (edge case)
 */
export const longNameService: Service = {
  id: '88888',
  name: 'This Is A Very Long Service Name That Tests The Display And Truncation Logic Of The UI Components And API Responses',
  description: 'Testing long names.',
  duration: 45,
  price: 12500,
  currency: 'USD',
  active: true,
};

/**
 * Service with unicode characters
 */
export const unicodeService: Service = {
  id: '77777',
  name: 'Massage thérapeutique 60min',
  description: 'Service avec caractères spéciaux: é, ü, ñ, 中文, 日本語',
  duration: 60,
  price: 18000,
  currency: 'EUR',
  active: true,
};

/**
 * Free service (price = 0)
 */
export const freeService: Service = {
  id: '00002',
  name: 'Free Consultation',
  description: 'Complimentary initial consultation.',
  duration: 15,
  price: 0,
  currency: 'USD',
  active: true,
};

/**
 * Service with different currency
 */
export const euroService: Service = {
  id: '66666',
  name: 'European Massage',
  duration: 60,
  price: 10000, // €100
  currency: 'EUR',
  active: true,
};

// =============================================================================
// ACUITY RAW RESPONSE FIXTURES
// =============================================================================

/**
 * Raw Acuity API response for appointment types
 * Used for testing transformer functions
 */
export const acuityAppointmentTypesRaw = [
  {
    id: 12345,
    name: 'TMD 60 min (including intraoral)',
    description:
      'Comprehensive 60-minute session for TMD/TMJ treatment including intraoral massage techniques.',
    duration: 60,
    price: '200.00',
    category: 'TMD',
    color: '#4A90D9',
    active: true,
    calendarIDs: [67890],
  },
  {
    id: 12346,
    name: 'TMD 30 min (including intraoral)',
    description: 'Focused 30-minute TMD/TMJ treatment session.',
    duration: 30,
    price: '100.00',
    category: 'TMD',
    color: '#4A90D9',
    active: true,
    calendarIDs: [67890],
  },
  {
    id: 12347,
    name: 'TMD 1st Visit/Consultation',
    description: 'Initial consultation and assessment for TMD/TMJ conditions.',
    duration: 60,
    price: '150.00',
    category: 'TMD',
    color: '#4A90D9',
    active: true,
    calendarIDs: [67890],
  },
  {
    id: 12348,
    name: 'Neck/Cervical Medical Massage 60 min',
    description: 'Therapeutic massage focused on neck and cervical spine.',
    duration: 60,
    price: '150.00',
    category: 'Massage',
    color: '#7B68EE',
    active: true,
    calendarIDs: [67890],
  },
  {
    id: 12349,
    name: 'Neck/Cervical Medical Massage 30 min',
    description: 'Focused 30-minute neck and cervical massage.',
    duration: 30,
    price: '75.00',
    category: 'Massage',
    color: '#7B68EE',
    active: true,
    calendarIDs: [67890],
  },
  {
    // Inactive service - should be filtered
    id: 99999,
    name: 'Old Service',
    description: 'No longer offered',
    duration: 45,
    price: '50.00',
    category: 'Legacy',
    color: '#CCCCCC',
    active: false,
    calendarIDs: [],
  },
];

/**
 * Acuity appointment type with edge cases
 */
export const acuityEdgeCaseTypes = [
  {
    id: 11111,
    name: '', // Empty name
    description: null,
    duration: 0,
    price: '',
    category: null,
    color: null,
    active: true,
    calendarIDs: [],
  },
  {
    id: 22222,
    name: 'Price with cents',
    description: 'Testing decimal price',
    duration: 45,
    price: '99.99',
    category: 'Test',
    color: '#000000',
    active: true,
    calendarIDs: [67890],
  },
  {
    id: 33333,
    name: 'No calendar assigned',
    description: 'Service without provider',
    duration: 30,
    price: '50.00',
    category: 'Test',
    color: '#FFFFFF',
    active: true,
    calendarIDs: [], // Empty - no provider can offer this
  },
];
