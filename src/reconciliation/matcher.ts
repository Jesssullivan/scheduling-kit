/**
 * Booking Reconciliation Matcher
 * Match local (alt-payment) bookings with Acuity appointments
 */

import type {
  LocalBooking,
  AcuityAppointment,
  ReconciliationResult,
  ReconciliationDiscrepancy,
  MatchingCriteria,
} from './types.js';
import { DEFAULT_MATCHING_CRITERIA } from './types.js';

// =============================================================================
// MATCHING UTILITIES
// =============================================================================

/**
 * Normalize email for comparison
 */
const normalizeEmail = (email: string): string =>
  email.toLowerCase().trim();

/**
 * Normalize phone for comparison (digits only)
 */
const normalizePhone = (phone: string): string =>
  phone.replace(/\D/g, '');

/**
 * Normalize name for comparison
 */
const normalizeName = (name: string): string =>
  name.toLowerCase().trim();

/**
 * Parse Acuity datetime to Date object
 */
const parseAcuityDatetime = (datetime: string): Date => {
  // Acuity uses ISO 8601 format
  return new Date(datetime);
};

/**
 * Calculate datetime difference in minutes
 */
const datetimeDifferenceMinutes = (d1: Date, d2: Date): number => {
  return Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60);
};

// =============================================================================
// MATCHING LOGIC
// =============================================================================

export interface MatchScore {
  total: number;
  emailMatch: boolean;
  datetimeMatch: boolean;
  serviceMatch: boolean;
  phoneMatch: boolean;
  nameMatch: boolean;
  details: Record<string, { matched: boolean; weight: number }>;
}

/**
 * Calculate match score between a local booking and Acuity appointment
 */
export const calculateMatchScore = (
  local: LocalBooking,
  acuity: AcuityAppointment,
  criteria: MatchingCriteria = DEFAULT_MATCHING_CRITERIA
): MatchScore => {
  const details: Record<string, { matched: boolean; weight: number }> = {};

  // Email match (highest weight)
  const emailMatch =
    normalizeEmail(local.client.email) === normalizeEmail(acuity.email);
  details.email = { matched: emailMatch, weight: 0.35 };

  // Datetime match
  const localDatetime = new Date(local.datetime);
  const acuityDatetime = parseAcuityDatetime(acuity.datetime);
  const timeDiff = datetimeDifferenceMinutes(localDatetime, acuityDatetime);
  const datetimeMatch = timeDiff <= criteria.datetimeTolerance;
  details.datetime = { matched: datetimeMatch, weight: 0.30 };

  // Service match (compare names)
  const serviceMatch =
    normalizeName(local.serviceName).includes(normalizeName(acuity.type)) ||
    normalizeName(acuity.type).includes(normalizeName(local.serviceName));
  details.service = { matched: serviceMatch, weight: 0.20 };

  // Phone match (optional)
  const localPhone = normalizePhone(local.client.phone ?? '');
  const acuityPhone = normalizePhone(acuity.phone);
  const phoneMatch = localPhone.length > 0 && localPhone === acuityPhone;
  details.phone = { matched: phoneMatch, weight: 0.10 };

  // Name match
  const fullNameLocal = normalizeName(`${local.client.firstName} ${local.client.lastName}`);
  const fullNameAcuity = normalizeName(`${acuity.firstName} ${acuity.lastName}`);
  const nameMatch = fullNameLocal === fullNameAcuity;
  details.name = { matched: nameMatch, weight: 0.05 };

  // Calculate total score
  let total = 0;
  for (const [, detail] of Object.entries(details)) {
    if (detail.matched) {
      total += detail.weight;
    }
  }

  return {
    total,
    emailMatch,
    datetimeMatch,
    serviceMatch,
    phoneMatch,
    nameMatch,
    details,
  };
};

/**
 * Find discrepancies between local booking and Acuity appointment
 */
export const findDiscrepancies = (
  local: LocalBooking,
  acuity: AcuityAppointment
): ReconciliationDiscrepancy[] => {
  const discrepancies: ReconciliationDiscrepancy[] = [];

  // Price discrepancy
  const localPrice = (local.amount / 100).toFixed(2);
  const acuityPrice = acuity.price.replace(/[^0-9.]/g, '');
  if (localPrice !== acuityPrice) {
    discrepancies.push({
      field: 'price',
      localValue: `$${localPrice}`,
      acuityValue: acuity.price,
      severity: parseFloat(localPrice) !== parseFloat(acuityPrice) ? 'high' : 'low',
    });
  }

  // Duration discrepancy
  const acuityDuration = parseInt(acuity.duration, 10);
  if (local.duration !== acuityDuration) {
    discrepancies.push({
      field: 'duration',
      localValue: `${local.duration} min`,
      acuityValue: `${acuityDuration} min`,
      severity: Math.abs(local.duration - acuityDuration) > 15 ? 'high' : 'medium',
    });
  }

  // Name discrepancy
  const localName = `${local.client.firstName} ${local.client.lastName}`;
  const acuityName = `${acuity.firstName} ${acuity.lastName}`;
  if (normalizeName(localName) !== normalizeName(acuityName)) {
    discrepancies.push({
      field: 'name',
      localValue: localName,
      acuityValue: acuityName,
      severity: 'low',
    });
  }

  // Phone discrepancy
  const localPhone = normalizePhone(local.client.phone ?? '');
  const acuityPhone = normalizePhone(acuity.phone);
  if (localPhone && acuityPhone && localPhone !== acuityPhone) {
    discrepancies.push({
      field: 'phone',
      localValue: local.client.phone ?? '',
      acuityValue: acuity.phone,
      severity: 'low',
    });
  }

  return discrepancies;
};

// =============================================================================
// MATCHER SERVICE
// =============================================================================

/**
 * Try to match a local booking with an Acuity appointment
 */
export const tryMatch = (
  local: LocalBooking,
  acuity: AcuityAppointment,
  criteria: MatchingCriteria = DEFAULT_MATCHING_CRITERIA
): ReconciliationResult => {
  const score = calculateMatchScore(local, acuity, criteria);

  // Check required criteria
  if (criteria.requireEmail && !score.emailMatch) {
    return {
      success: false,
      localBookingId: local.id,
      matchType: 'none',
      reason: 'Email does not match',
    };
  }

  if (criteria.requireDatetime && !score.datetimeMatch) {
    return {
      success: false,
      localBookingId: local.id,
      matchType: 'none',
      reason: `Datetime mismatch exceeds ${criteria.datetimeTolerance} minute tolerance`,
    };
  }

  if (criteria.requireService && !score.serviceMatch) {
    return {
      success: false,
      localBookingId: local.id,
      matchType: 'none',
      reason: 'Service name does not match',
    };
  }

  if (criteria.requirePhone && !score.phoneMatch) {
    return {
      success: false,
      localBookingId: local.id,
      matchType: 'none',
      reason: 'Phone does not match',
    };
  }

  // Check confidence threshold
  if (score.total < criteria.minConfidence) {
    return {
      success: false,
      localBookingId: local.id,
      acuityAppointmentId: acuity.id,
      confidence: score.total,
      matchType: 'none',
      reason: `Match confidence ${(score.total * 100).toFixed(0)}% below ${(criteria.minConfidence * 100).toFixed(0)}% threshold`,
    };
  }

  // Match successful
  const discrepancies = findDiscrepancies(local, acuity);

  return {
    success: true,
    localBookingId: local.id,
    acuityAppointmentId: acuity.id,
    confidence: score.total,
    matchType: 'automatic',
    reason: `Matched with ${(score.total * 100).toFixed(0)}% confidence`,
    discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
  };
};

/**
 * Find the best match for a local booking from a list of Acuity appointments
 */
export const findBestMatch = (
  local: LocalBooking,
  appointments: AcuityAppointment[],
  criteria: MatchingCriteria = DEFAULT_MATCHING_CRITERIA
): ReconciliationResult | null => {
  let bestMatch: ReconciliationResult | null = null;
  let bestScore = 0;

  for (const appointment of appointments) {
    const result = tryMatch(local, appointment, criteria);

    if (result.success && (result.confidence ?? 0) > bestScore) {
      bestMatch = result;
      bestScore = result.confidence ?? 0;
    }
  }

  return bestMatch;
};

/**
 * Find all potential matches for a local booking (for manual review)
 */
export const findAllPotentialMatches = (
  local: LocalBooking,
  appointments: AcuityAppointment[],
  minConfidence: number = 0.5
): Array<{ appointment: AcuityAppointment; score: MatchScore }> => {
  const matches: Array<{ appointment: AcuityAppointment; score: MatchScore }> = [];

  for (const appointment of appointments) {
    const score = calculateMatchScore(local, appointment);

    if (score.total >= minConfidence) {
      matches.push({ appointment, score });
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score.total - a.score.total);
};
