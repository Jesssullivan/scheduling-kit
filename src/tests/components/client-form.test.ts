/**
 * Tests for ClientForm validation logic.
 *
 * The component lives in a .svelte file, so we re-implement the pure
 * functions here and test them in a Node environment.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Re-implemented pure logic from ClientForm.svelte
// ---------------------------------------------------------------------------

interface ClientFields {
  firstName: string;
  lastName: string;
  email: string;
}

const validateClientFields = (
  fields: Partial<ClientFields>,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  const trimmedFirstName = fields.firstName?.trim() ?? '';
  const trimmedLastName = fields.lastName?.trim() ?? '';
  const trimmedEmail = fields.email?.trim() ?? '';
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!trimmedFirstName) {
    errors.firstName = 'First name is required';
  }

  if (!trimmedLastName) {
    errors.lastName = 'Last name is required';
  }

  if (!trimmedEmail || !emailPattern.test(trimmedEmail)) {
    errors.email = 'Please enter a valid email address';
  }

  return errors;
};

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
  // validateClientFields
  // -----------------------------------------------------------------------
  describe('validateClientFields', () => {
    const validData = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    };

    it('accepts fully valid data', () => {
      expect(validateClientFields(validData)).toEqual({});
    });

    it('rejects missing firstName', () => {
      expect(validateClientFields({
        lastName: 'Doe',
        email: 'jane@example.com',
      })).toMatchObject({
        firstName: 'First name is required',
      });
    });

    it('rejects empty firstName', () => {
      expect(validateClientFields({
        firstName: '',
        lastName: 'Doe',
        email: 'jane@example.com',
      })).toMatchObject({
        firstName: 'First name is required',
      });
    });

    it('rejects missing lastName', () => {
      expect(validateClientFields({
        firstName: 'Jane',
        email: 'jane@example.com',
      })).toMatchObject({
        lastName: 'Last name is required',
      });
    });

    it('rejects empty lastName', () => {
      expect(validateClientFields({
        firstName: 'Jane',
        lastName: '',
        email: 'jane@example.com',
      })).toMatchObject({
        lastName: 'Last name is required',
      });
    });

    it('rejects invalid email', () => {
      expect(validateClientFields({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'not-an-email',
      })).toMatchObject({
        email: 'Please enter a valid email address',
      });
    });

    it('rejects missing email', () => {
      expect(validateClientFields({
        firstName: 'Jane',
        lastName: 'Doe',
      })).toMatchObject({
        email: 'Please enter a valid email address',
      });
    });

    it('rejects completely empty object with all required errors', () => {
      expect(validateClientFields({})).toEqual({
        firstName: 'First name is required',
        lastName: 'Last name is required',
        email: 'Please enter a valid email address',
      });
    });

    it('accepts surrounding whitespace when the trimmed values are valid', () => {
      expect(validateClientFields({
        firstName: ' Jane ',
        lastName: ' Doe ',
        email: ' jane@example.com ',
      })).toEqual({});
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

    it('constructs ClientInfo from valid component field state', () => {
      const info: ClientInfo = {
        firstName: ' Jane '.trim(),
        lastName: ' Doe '.trim(),
        email: ' Jane@Example.com '.trim().toLowerCase(),
        phone: '(607) 201-4926'.replace(/\D/g, '') || undefined,
        notes: ''.trim() || undefined,
      };

      expect(info.firstName).toBe('Jane');
      expect(info.lastName).toBe('Doe');
      expect(info.email).toBe('jane@example.com');
      expect(info.phone).toBe('6072014926');
      expect(info.notes).toBeUndefined();
    });
  });
});
