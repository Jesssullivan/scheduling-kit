#!/usr/bin/env npx tsx
/**
 * Update Fixtures Script
 * Regenerates static test fixtures from current type definitions
 *
 * Usage:
 *   pnpm fixtures:update           # Update all fixtures
 *   pnpm fixtures:update --dry-run # Preview changes without writing
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../src/tests/fixtures');
const ACUITY_DIR = resolve(FIXTURES_DIR, 'acuity');

// =============================================================================
// FIXTURE GENERATORS
// =============================================================================

interface FixtureConfig {
  path: string;
  generate: () => unknown;
  description: string;
}

/**
 * Generate realistic Acuity appointment types fixture
 */
const generateAppointmentTypes = () => [
  {
    id: 12345,
    name: 'TMD 1st Visit/Consultation',
    description: 'Initial TMD assessment and treatment planning',
    duration: 60,
    price: '150.00',
    deposit: '0.00',
    category: 'TMD',
    color: '#4CAF50',
    private: false,
    type: 'service',
    active: true,
    schedulingUrl: 'https://example.acuityscheduling.com/schedule.php?appointmentType=12345',
    paddingBefore: 0,
    paddingAfter: 15,
    calendarIDs: [100],
    formIDs: [],
  },
  {
    id: 12346,
    name: 'TMD 30 min (including intraoral)',
    description: '30-minute TMD treatment session with intraoral work',
    duration: 30,
    price: '100.00',
    deposit: '0.00',
    category: 'TMD',
    color: '#4CAF50',
    private: false,
    type: 'service',
    active: true,
    schedulingUrl: 'https://example.acuityscheduling.com/schedule.php?appointmentType=12346',
    paddingBefore: 0,
    paddingAfter: 15,
    calendarIDs: [100],
    formIDs: [],
  },
  {
    id: 12347,
    name: 'TMD 60 min (including intraoral)',
    description: '60-minute TMD treatment session with intraoral work',
    duration: 60,
    price: '200.00',
    deposit: '0.00',
    category: 'TMD',
    color: '#4CAF50',
    private: false,
    type: 'service',
    active: true,
    schedulingUrl: 'https://example.acuityscheduling.com/schedule.php?appointmentType=12347',
    paddingBefore: 0,
    paddingAfter: 15,
    calendarIDs: [100],
    formIDs: [],
  },
  {
    id: 12348,
    name: 'Neck/Cervical Medical Massage 30 min',
    description: '30-minute therapeutic neck and cervical massage',
    duration: 30,
    price: '75.00',
    deposit: '0.00',
    category: 'Massage',
    color: '#2196F3',
    private: false,
    type: 'service',
    active: true,
    schedulingUrl: 'https://example.acuityscheduling.com/schedule.php?appointmentType=12348',
    paddingBefore: 0,
    paddingAfter: 10,
    calendarIDs: [100],
    formIDs: [],
  },
  {
    id: 12349,
    name: 'Neck/Cervical Medical Massage 60 min',
    description: '60-minute therapeutic neck and cervical massage',
    duration: 60,
    price: '150.00',
    deposit: '0.00',
    category: 'Massage',
    color: '#2196F3',
    private: false,
    type: 'service',
    active: true,
    schedulingUrl: 'https://example.acuityscheduling.com/schedule.php?appointmentType=12349',
    paddingBefore: 0,
    paddingAfter: 10,
    calendarIDs: [100],
    formIDs: [],
  },
];

/**
 * Generate realistic Acuity calendars (providers) fixture
 */
const generateCalendars = () => [
  {
    id: 100,
    name: 'Jennifer Sullivan, LMT',
    email: 'jen@massageithaca.com',
    thumbnail: null,
    image: null,
    description: 'Licensed Massage Therapist specializing in TMD and therapeutic massage',
    timezone: 'America/New_York',
    replyTo: 'jen@massageithaca.com',
    location: '950 Danby Rd (96B), South Hill Business Campus, Ithaca, NY 14850',
  },
];

/**
 * Generate availability dates fixture (next 30 days)
 */
const generateAvailabilityDates = () => {
  const dates: string[] = [];
  const now = new Date();

  // Generate dates for next 30 days (weekdays only)
  for (let i = 1; i <= 30; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);

    // Only include Mon, Fri, Sat (business hours)
    const day = date.getDay();
    if (day === 1 || day === 5 || day === 6) {
      dates.push(date.toISOString().split('T')[0]);
    }
  }

  return dates;
};

/**
 * Generate availability times fixture for a single day
 */
const generateAvailabilityTimes = () => {
  const baseDate = '2026-02-16'; // Example Monday

  return [
    { time: `${baseDate}T11:00:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T11:30:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T12:00:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T12:30:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T13:00:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T13:30:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T14:00:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T14:30:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T15:00:00-0500`, slotsAvailable: 1 },
    { time: `${baseDate}T15:30:00-0500`, slotsAvailable: 1 },
  ];
};

/**
 * Generate appointment fixture
 */
const generateAppointment = () => ({
  id: 999999999,
  firstName: 'Test',
  lastName: 'Client',
  phone: '555-123-4567',
  email: 'test@example.com',
  date: 'February 16, 2026',
  time: '11:00am',
  endTime: '12:00pm',
  dateCreated: 'February 1, 2026',
  datetime: '2026-02-16T11:00:00-0500',
  datetimeCreated: '2026-02-01T10:30:00-0500',
  price: '150.00',
  priceSold: '150.00',
  paid: 'no',
  amountPaid: '0.00',
  type: 'TMD 1st Visit/Consultation',
  appointmentTypeID: 12345,
  calendarID: 100,
  calendar: 'Jennifer Sullivan, LMT',
  duration: '60',
  canClientCancel: true,
  canClientReschedule: true,
  location: '950 Danby Rd (96B), South Hill Business Campus, Ithaca, NY 14850',
  timezone: 'America/New_York',
  confirmationPage: 'https://example.acuityscheduling.com/schedule.php?owner=test&id=999999999',
  canceled: false,
  labels: [],
  forms: [],
  notes: '',
});

// =============================================================================
// FIXTURE CONFIGURATION
// =============================================================================

const FIXTURES: FixtureConfig[] = [
  {
    path: resolve(ACUITY_DIR, 'appointment-types.json'),
    generate: generateAppointmentTypes,
    description: 'Acuity appointment types (services)',
  },
  {
    path: resolve(ACUITY_DIR, 'calendars.json'),
    generate: generateCalendars,
    description: 'Acuity calendars (providers)',
  },
  {
    path: resolve(ACUITY_DIR, 'availability-dates.json'),
    generate: generateAvailabilityDates,
    description: 'Available booking dates',
  },
  {
    path: resolve(ACUITY_DIR, 'availability-times.json'),
    generate: generateAvailabilityTimes,
    description: 'Available time slots',
  },
  {
    path: resolve(ACUITY_DIR, 'appointment.json'),
    generate: generateAppointment,
    description: 'Sample appointment booking',
  },
];

// =============================================================================
// SCRIPT EXECUTION
// =============================================================================

const isDryRun = process.argv.includes('--dry-run');
const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');

const log = (msg: string) => console.log(msg);
const verbose = (msg: string) => isVerbose && console.log(`  ${msg}`);

const run = () => {
  log('📦 Updating test fixtures...\n');

  // Ensure directories exist
  if (!isDryRun) {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    if (!existsSync(ACUITY_DIR)) mkdirSync(ACUITY_DIR, { recursive: true });
  }

  let updated = 0;
  let unchanged = 0;

  for (const fixture of FIXTURES) {
    const newContent = JSON.stringify(fixture.generate(), null, 2);
    const relativePath = fixture.path.replace(resolve(__dirname, '..'), '');

    // Check if file exists and compare
    let existingContent = '';
    if (existsSync(fixture.path)) {
      existingContent = readFileSync(fixture.path, 'utf-8');
    }

    if (existingContent === newContent) {
      verbose(`⏭️  ${relativePath} (unchanged)`);
      unchanged++;
      continue;
    }

    if (isDryRun) {
      log(`📝 Would update: ${relativePath}`);
      verbose(`   ${fixture.description}`);
    } else {
      writeFileSync(fixture.path, newContent + '\n');
      log(`✅ Updated: ${relativePath}`);
      verbose(`   ${fixture.description}`);
    }
    updated++;
  }

  log('');
  if (isDryRun) {
    log(`🔍 Dry run complete: ${updated} would be updated, ${unchanged} unchanged`);
  } else {
    log(`✨ Done: ${updated} updated, ${unchanged} unchanged`);
  }
};

run();
