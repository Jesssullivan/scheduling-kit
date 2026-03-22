/**
 * Tests for ClientForm validation logic.
 *
 * The component lives in a .svelte file, so we re-implement the pure
 * functions here and test them in a Node environment.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Re-implemented pure logic from ClientForm.svelte
// ---------------------------------------------------------------------------

const ClientSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional().transform((val) => val || undefined),
  notes: z.string().optional().transform((val) => val || undefined),
});

const formatPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  else if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  else return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

interface IntakeFields {
  painRadio: string;
  clenching: string;
  headaches: string;
  howDidYouHear: string[];
  medication: string;
  termsAccepted: boolean;
}

const validateIntake = (fields: IntakeFields): string[] => {
  const errors: string[] = [];
  if (fields.painRadio !== 'yes' && fields.painRadio !== 'no') {
    errors.push('Pain question is required');
  }
  if (fields.clenching !== 'yes' && fields.clenching !== 'no') {
    errors.push('Clenching question is required');
  }
  if (fields.headaches !== 'yes' && fields.headaches !== 'no') {
    errors.push('Headaches question is required');
  }
  if (fields.howDidYouHear.length === 0) {
    errors.push('Please select how you heard about us');
  }
  if (!fields.medication.trim()) {
    errors.push('Medication field is required');
  }
  if (!fields.termsAccepted) {
    errors.push('You must accept the terms');
  }
  return errors;
};

interface ClientInfo {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly notes?: string;
  readonly customFields?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientForm validation logic', () => {
  // -----------------------------------------------------------------------
  // ClientSchema
  // -----------------------------------------------------------------------
  describe('ClientSchema', () => {
    const validData = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '6071234567',
      notes: 'Jaw pain on left side',
    };

    it('accepts fully valid data', () => {
      const result = ClientSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Jane');
        expect(result.data.lastName).toBe('Doe');
        expect(result.data.email).toBe('jane@example.com');
      }
    });

    it('accepts data without optional phone and notes', () => {
      const result = ClientSchema.safeParse({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phone).toBeUndefined();
        expect(result.data.notes).toBeUndefined();
      }
    });

    it('transforms empty phone string to undefined', () => {
      const result = ClientSchema.safeParse({
        ...validData,
        phone: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phone).toBeUndefined();
      }
    });

    it('transforms empty notes string to undefined', () => {
      const result = ClientSchema.safeParse({
        ...validData,
        notes: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notes).toBeUndefined();
      }
    });

    it('rejects missing firstName', () => {
      const result = ClientSchema.safeParse({
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty firstName', () => {
      const result = ClientSchema.safeParse({
        firstName: '',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const firstNameIssue = result.error.issues.find(
          (i) => i.path[0] === 'firstName',
        );
        expect(firstNameIssue?.message).toBe('First name is required');
      }
    });

    it('rejects missing lastName', () => {
      const result = ClientSchema.safeParse({
        firstName: 'Jane',
        email: 'jane@example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty lastName', () => {
      const result = ClientSchema.safeParse({
        firstName: 'Jane',
        lastName: '',
        email: 'jane@example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const lastNameIssue = result.error.issues.find(
          (i) => i.path[0] === 'lastName',
        );
        expect(lastNameIssue?.message).toBe('Last name is required');
      }
    });

    it('rejects invalid email', () => {
      const result = ClientSchema.safeParse({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const emailIssue = result.error.issues.find(
          (i) => i.path[0] === 'email',
        );
        expect(emailIssue?.message).toBe('Please enter a valid email address');
      }
    });

    it('rejects missing email', () => {
      const result = ClientSchema.safeParse({
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(result.success).toBe(false);
    });

    it('rejects completely empty object', () => {
      const result = ClientSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // -----------------------------------------------------------------------
  // formatPhone
  // -----------------------------------------------------------------------
  describe('formatPhone', () => {
    it('returns empty string for empty input', () => {
      expect(formatPhone('')).toBe('');
    });

    it('returns raw digits for 1-3 digits', () => {
      expect(formatPhone('6')).toBe('6');
      expect(formatPhone('60')).toBe('60');
      expect(formatPhone('607')).toBe('607');
    });

    it('formats 4-6 digits with area code parens', () => {
      expect(formatPhone('6072')).toBe('(607) 2');
      expect(formatPhone('607201')).toBe('(607) 201');
    });

    it('formats 7+ digits with full US phone format', () => {
      expect(formatPhone('6072014')).toBe('(607) 201-4');
      expect(formatPhone('6072014926')).toBe('(607) 201-4926');
    });

    it('truncates digits beyond 10', () => {
      expect(formatPhone('60720149261')).toBe('(607) 201-4926');
    });

    it('strips non-digit characters before formatting', () => {
      expect(formatPhone('(607) 201-4926')).toBe('(607) 201-4926');
      expect(formatPhone('607.201.4926')).toBe('(607) 201-4926');
      expect(formatPhone('607-201-4926')).toBe('(607) 201-4926');
    });

    it('handles letters and symbols mixed with digits', () => {
      expect(formatPhone('abc607def201ghi4926')).toBe('(607) 201-4926');
    });

    it('handles all non-digit input', () => {
      expect(formatPhone('abc')).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Intake validation
  // -----------------------------------------------------------------------
  describe('intake validation', () => {
    const validIntake: IntakeFields = {
      painRadio: 'yes',
      clenching: 'no',
      headaches: 'yes',
      howDidYouHear: ['Internet search'],
      medication: 'None',
      termsAccepted: true,
    };

    it('returns no errors for valid intake', () => {
      expect(validateIntake(validIntake)).toEqual([]);
    });

    it('rejects empty painRadio', () => {
      const errors = validateIntake({ ...validIntake, painRadio: '' });
      expect(errors).toContain('Pain question is required');
    });

    it('rejects non-yes/no painRadio value', () => {
      const errors = validateIntake({ ...validIntake, painRadio: 'maybe' });
      expect(errors).toContain('Pain question is required');
    });

    it('rejects empty clenching', () => {
      const errors = validateIntake({ ...validIntake, clenching: '' });
      expect(errors).toContain('Clenching question is required');
    });

    it('rejects empty headaches', () => {
      const errors = validateIntake({ ...validIntake, headaches: '' });
      expect(errors).toContain('Headaches question is required');
    });

    it('rejects empty howDidYouHear array', () => {
      const errors = validateIntake({ ...validIntake, howDidYouHear: [] });
      expect(errors).toContain('Please select how you heard about us');
    });

    it('accepts multiple howDidYouHear selections', () => {
      const errors = validateIntake({
        ...validIntake,
        howDidYouHear: ['Internet search', 'google maps', 'referral from dentist'],
      });
      expect(errors).toEqual([]);
    });

    it('rejects empty medication string', () => {
      const errors = validateIntake({ ...validIntake, medication: '' });
      expect(errors).toContain('Medication field is required');
    });

    it('rejects whitespace-only medication string', () => {
      const errors = validateIntake({ ...validIntake, medication: '   ' });
      expect(errors).toContain('Medication field is required');
    });

    it('rejects termsAccepted = false', () => {
      const errors = validateIntake({ ...validIntake, termsAccepted: false });
      expect(errors).toContain('You must accept the terms');
    });

    it('collects multiple errors at once', () => {
      const errors = validateIntake({
        painRadio: '',
        clenching: '',
        headaches: '',
        howDidYouHear: [],
        medication: '',
        termsAccepted: false,
      });
      expect(errors).toHaveLength(6);
    });

    it('accepts "no" as valid for all radio fields', () => {
      const errors = validateIntake({
        ...validIntake,
        painRadio: 'no',
        clenching: 'no',
        headaches: 'no',
      });
      expect(errors).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // ClientInfo construction
  // -----------------------------------------------------------------------
  describe('ClientInfo construction', () => {
    it('creates minimal ClientInfo without optional fields', () => {
      const info: ClientInfo = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      };
      expect(info.phone).toBeUndefined();
      expect(info.notes).toBeUndefined();
      expect(info.customFields).toBeUndefined();
    });

    it('creates ClientInfo with all fields populated', () => {
      const info: ClientInfo = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '(607) 201-4926',
        notes: 'Left TMJ pain',
        customFields: {
          'field-13933959': 'true',
          'field-16606770': 'Ibuprofen 200mg',
        },
      };
      expect(info.customFields?.['field-13933959']).toBe('true');
      expect(info.customFields?.['field-16606770']).toBe('Ibuprofen 200mg');
    });

    it('constructs ClientInfo from validated schema output', () => {
      const parsed = ClientSchema.parse({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '6072014926',
        notes: '',
      });

      const info: ClientInfo = {
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        email: parsed.email,
        phone: parsed.phone,
        notes: parsed.notes,
      };

      expect(info.firstName).toBe('Jane');
      expect(info.phone).toBe('6072014926');
      // notes was empty string, transformed to undefined by schema
      expect(info.notes).toBeUndefined();
    });
  });
});
