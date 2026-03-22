/**
 * Reconciliation Types
 * Types for matching alternative payments with Acuity bookings
 */

import type { ClientInfo, PaymentStatus } from '../core/types.js';

// =============================================================================
// LOCAL BOOKING RECORD
// =============================================================================

/**
 * A booking record stored locally (before reconciliation with Acuity)
 */
export interface LocalBooking {
  /** Local unique identifier */
  readonly id: string;
  /** Service booked */
  readonly serviceId: string;
  readonly serviceName: string;
  /** Provider (optional) */
  readonly providerId?: string;
  readonly providerName?: string;
  /** Scheduled datetime (ISO 8601) */
  readonly datetime: string;
  /** Duration in minutes */
  readonly duration: number;
  /** Client information */
  readonly client: ClientInfo;
  /** Payment method used */
  readonly paymentMethod: 'venmo' | 'cash' | 'zelle' | 'check' | 'card';
  /** Payment transaction ID (if electronic) */
  readonly paymentTransactionId?: string;
  /** Amount in cents */
  readonly amount: number;
  /** Payment status */
  readonly paymentStatus: PaymentStatus;
  /** Acuity appointment ID (set after reconciliation) */
  readonly acuityAppointmentId?: string;
  /** Reconciliation status */
  readonly reconciliationStatus: ReconciliationStatus;
  /** When the booking was created */
  readonly createdAt: string;
  /** When reconciliation was completed */
  readonly reconciledAt?: string;
  /** Notes */
  readonly notes?: string;
}

/**
 * Reconciliation status
 */
export type ReconciliationStatus =
  | 'pending'      // Awaiting Acuity booking creation
  | 'matched'      // Successfully matched with Acuity
  | 'manual'       // Manually matched by admin
  | 'unmatched'    // Could not be automatically matched
  | 'cancelled';   // Booking was cancelled

// =============================================================================
// ACUITY WEBHOOK EVENT
// =============================================================================

/**
 * Acuity webhook event types
 */
export type AcuityWebhookEventType =
  | 'appointment.scheduled'
  | 'appointment.rescheduled'
  | 'appointment.canceled'
  | 'appointment.changed'
  | 'order.completed';

/**
 * Acuity webhook payload
 */
export interface AcuityWebhookPayload {
  /** Webhook action/event type */
  action: AcuityWebhookEventType;
  /** Appointment ID */
  id: number;
  /** Calendar ID */
  calendarID: number;
  /** Appointment type ID */
  appointmentTypeID: number;
}

/**
 * Acuity appointment from API (webhook fetches full details)
 */
export interface AcuityAppointment {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  endTime: string;
  dateCreated: string;
  datetime: string;
  price: string;
  priceSold: string;
  paid: 'yes' | 'no';
  amountPaid: string;
  type: string;
  appointmentTypeID: number;
  calendar: string;
  calendarID: number;
  canClientCancel: boolean;
  canClientReschedule: boolean;
  duration: string;
  location: string;
  notes: string;
  timezone: string;
  forms: AcuityFormData[];
  labels?: AcuityLabel[];
}

export interface AcuityFormData {
  id: number;
  name: string;
  values: AcuityFormField[];
}

export interface AcuityFormField {
  id: number;
  name: string;
  value: string;
  fieldID: number;
}

export interface AcuityLabel {
  id: number;
  name: string;
  color: string;
}

// =============================================================================
// RECONCILIATION RESULT
// =============================================================================

/**
 * Result of a reconciliation attempt
 */
export interface ReconciliationResult {
  /** Whether reconciliation was successful */
  success: boolean;
  /** The local booking that was reconciled */
  localBookingId: string;
  /** The matched Acuity appointment ID */
  acuityAppointmentId?: number;
  /** Confidence score (0-1) for automatic matches */
  confidence?: number;
  /** Match type */
  matchType: 'automatic' | 'manual' | 'none';
  /** Reason for match/no-match */
  reason: string;
  /** Any discrepancies found */
  discrepancies?: ReconciliationDiscrepancy[];
}

/**
 * Discrepancy found during reconciliation
 */
export interface ReconciliationDiscrepancy {
  field: string;
  localValue: string;
  acuityValue: string;
  severity: 'low' | 'medium' | 'high';
}

// =============================================================================
// MATCHING CRITERIA
// =============================================================================

/**
 * Criteria for matching local bookings to Acuity appointments
 */
export interface MatchingCriteria {
  /** Require exact email match */
  requireEmail: boolean;
  /** Require exact datetime match (within tolerance) */
  requireDatetime: boolean;
  /** Datetime match tolerance in minutes */
  datetimeTolerance: number;
  /** Require service name match */
  requireService: boolean;
  /** Require phone match */
  requirePhone: boolean;
  /** Minimum confidence score for automatic match */
  minConfidence: number;
}

/**
 * Default matching criteria
 */
export const DEFAULT_MATCHING_CRITERIA: MatchingCriteria = {
  requireEmail: true,
  requireDatetime: true,
  datetimeTolerance: 5, // 5 minutes
  requireService: true,
  requirePhone: false,
  minConfidence: 0.8,
};
