<script lang="ts">
  /**
   * ClientForm Component
   * Client information form with Zod validation
   */
  import { z } from 'zod';
  import type { ClientInfo } from '../core/types.js';

  // Props
  let {
    initialData = undefined as ClientInfo | undefined,
    onSubmit,
    loading = false,
    showIntakeFields = false,
  }: {
    initialData?: ClientInfo;
    onSubmit?: (client: ClientInfo) => void;
    loading?: boolean;
    /** Show Acuity-specific intake fields (radios, how did you hear, medication, terms) */
    showIntakeFields?: boolean;
  } = $props();

  // Form state
  let firstName = $state(initialData?.firstName ?? '');
  let lastName = $state(initialData?.lastName ?? '');
  let email = $state(initialData?.email ?? '');
  let phone = $state(initialData?.phone ?? '');
  let notes = $state(initialData?.notes ?? '');

  // Intake fields
  let painRadio = $state<'yes' | 'no' | ''>(initialData?.customFields?.painRadio as 'yes' | 'no' || '');
  let clenching = $state<'yes' | 'no' | ''>(initialData?.customFields?.clenching as 'yes' | 'no' || '');
  let headaches = $state<'yes' | 'no' | ''>(initialData?.customFields?.headaches as 'yes' | 'no' || '');
  let howDidYouHear = $state<string[]>(
    initialData?.customFields?.howDidYouHear?.split(',').filter(Boolean) ?? []
  );
  let medication = $state(initialData?.customFields?.medication ?? '');
  let termsAccepted = $state(initialData?.customFields?.termsAccepted === 'true');

  const hearOptions = [
    'Internet search',
    'Google Maps',
    'Referral from Noha Acupuncture',
    'Referral from dentist',
    'Referral from PT or other practitioner',
  ];

  // Validation errors
  let errors = $state<Record<string, string>>({});

  // Validation schema
  const ClientSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Please enter a valid email address'),
    phone: z.string().optional().transform(val => val || undefined),
    notes: z.string().optional().transform(val => val || undefined),
  });

  // Format phone number as user types
  const formatPhone = (value: string): string => {
    // Remove non-digits
    const digits = value.replace(/\D/g, '');

    // Format as (XXX) XXX-XXXX
    if (digits.length <= 3) {
      return digits;
    } else if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
  };

  // Handle phone input
  const handlePhoneInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    phone = formatPhone(input.value);
  };

  // Validate form
  const validate = (): boolean => {
    const result = ClientSchema.safeParse({
      firstName,
      lastName,
      email,
      phone,
      notes,
    });

    const newErrors: Record<string, string> = {};

    if (!result.success) {
      for (const error of result.error.errors) {
        const field = error.path[0] as string;
        newErrors[field] = error.message;
      }
    }

    if (showIntakeFields) {
      if (!painRadio) newErrors.painRadio = 'Please answer this question';
      if (!clenching) newErrors.clenching = 'Please answer this question';
      if (!headaches) newErrors.headaches = 'Please answer this question';
      if (howDidYouHear.length === 0) newErrors.howDidYouHear = 'Please select at least one option';
      if (!medication.trim()) newErrors.medication = 'Please list medications or enter "None"';
      if (!termsAccepted) newErrors.termsAccepted = 'You must accept the terms to continue';
    }

    errors = newErrors;
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = (e: Event) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const clientInfo: ClientInfo = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.replace(/\D/g, '') || undefined,
      notes: notes.trim() || undefined,
      ...(showIntakeFields && {
        customFields: {
          painRadio,
          clenching,
          headaches,
          howDidYouHear: howDidYouHear.join(','),
          medication: medication.trim(),
          termsAccepted: String(termsAccepted),
        },
      }),
    };

    onSubmit?.(clientInfo);
  };

  // Check if field has error
  const hasError = (field: string): boolean => !!errors[field];
</script>

<form class="client-form" onsubmit={handleSubmit}>
  <div class="form-grid grid gap-4">
    <!-- First Name -->
    <div class="field">
      <label for="firstName" class="block text-sm font-medium mb-1">
        First Name <span class="text-error-500">*</span>
      </label>
      <input
        type="text"
        id="firstName"
        bind:value={firstName}
        class="input w-full {hasError('firstName') ? 'input-error' : ''}"
        placeholder="Jane"
        required
        disabled={loading}
      />
      {#if hasError('firstName')}
        <p class="text-sm text-error-500 mt-1">{errors.firstName}</p>
      {/if}
    </div>

    <!-- Last Name -->
    <div class="field">
      <label for="lastName" class="block text-sm font-medium mb-1">
        Last Name <span class="text-error-500">*</span>
      </label>
      <input
        type="text"
        id="lastName"
        bind:value={lastName}
        class="input w-full {hasError('lastName') ? 'input-error' : ''}"
        placeholder="Doe"
        required
        disabled={loading}
      />
      {#if hasError('lastName')}
        <p class="text-sm text-error-500 mt-1">{errors.lastName}</p>
      {/if}
    </div>

    <!-- Email -->
    <div class="field sm:col-span-2">
      <label for="email" class="block text-sm font-medium mb-1">
        Email <span class="text-error-500">*</span>
      </label>
      <input
        type="email"
        id="email"
        bind:value={email}
        class="input w-full {hasError('email') ? 'input-error' : ''}"
        placeholder="jane@example.com"
        required
        disabled={loading}
      />
      {#if hasError('email')}
        <p class="text-sm text-error-500 mt-1">{errors.email}</p>
      {/if}
    </div>

    <!-- Phone -->
    <div class="field sm:col-span-2">
      <label for="phone" class="block text-sm font-medium mb-1">
        Phone <span class="text-surface-400-600">(optional)</span>
      </label>
      <input
        type="tel"
        id="phone"
        value={phone}
        oninput={handlePhoneInput}
        class="input w-full"
        placeholder="(607) 555-1234"
        disabled={loading}
      />
    </div>

    <!-- Notes -->
    <div class="field sm:col-span-2">
      <label for="notes" class="block text-sm font-medium mb-1">
        Notes for your appointment <span class="text-surface-400-600">(optional)</span>
      </label>
      <textarea
        id="notes"
        bind:value={notes}
        class="textarea w-full"
        rows="3"
        placeholder="Any information you'd like us to know..."
        disabled={loading}
      ></textarea>
    </div>
  </div>

  <!-- Intake Fields (Acuity-specific) -->
  {#if showIntakeFields}
    <div class="intake-fields mt-6 space-y-5 border-t border-surface-200-800 pt-6">
      <h4 class="text-md font-semibold">Health Intake Questions</h4>

      <!-- Radio: Jaw pain -->
      <fieldset class="field">
        <legend class="block text-sm font-medium mb-2">
          Do you experience jaw pain or TMD symptoms? <span class="text-error-500">*</span>
        </legend>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={painRadio} value="yes" disabled={loading} class="radio" />
            <span class="text-sm">Yes</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={painRadio} value="no" disabled={loading} class="radio" />
            <span class="text-sm">No</span>
          </label>
        </div>
        {#if hasError('painRadio')}
          <p class="text-sm text-error-500 mt-1">{errors.painRadio}</p>
        {/if}
      </fieldset>

      <!-- Radio: Clenching -->
      <fieldset class="field">
        <legend class="block text-sm font-medium mb-2">
          Do you clench or grind your teeth? <span class="text-error-500">*</span>
        </legend>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={clenching} value="yes" disabled={loading} class="radio" />
            <span class="text-sm">Yes</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={clenching} value="no" disabled={loading} class="radio" />
            <span class="text-sm">No</span>
          </label>
        </div>
        {#if hasError('clenching')}
          <p class="text-sm text-error-500 mt-1">{errors.clenching}</p>
        {/if}
      </fieldset>

      <!-- Radio: Headaches -->
      <fieldset class="field">
        <legend class="block text-sm font-medium mb-2">
          Do you experience frequent headaches? <span class="text-error-500">*</span>
        </legend>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={headaches} value="yes" disabled={loading} class="radio" />
            <span class="text-sm">Yes</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" bind:group={headaches} value="no" disabled={loading} class="radio" />
            <span class="text-sm">No</span>
          </label>
        </div>
        {#if hasError('headaches')}
          <p class="text-sm text-error-500 mt-1">{errors.headaches}</p>
        {/if}
      </fieldset>

      <!-- How did you hear -->
      <fieldset class="field">
        <legend class="block text-sm font-medium mb-2">
          How did you hear about us? <span class="text-error-500">*</span>
          <span class="text-xs text-surface-400-600">(select all that apply)</span>
        </legend>
        <div class="space-y-2">
          {#each hearOptions as option}
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={howDidYouHear.includes(option)}
                onchange={() => {
                  if (howDidYouHear.includes(option)) {
                    howDidYouHear = howDidYouHear.filter(h => h !== option);
                  } else {
                    howDidYouHear = [...howDidYouHear, option];
                  }
                }}
                disabled={loading}
                class="checkbox"
              />
              <span class="text-sm">{option}</span>
            </label>
          {/each}
        </div>
        {#if hasError('howDidYouHear')}
          <p class="text-sm text-error-500 mt-1">{errors.howDidYouHear}</p>
        {/if}
      </fieldset>

      <!-- Medication -->
      <div class="field">
        <label for="medication" class="block text-sm font-medium mb-1">
          Current medications <span class="text-error-500">*</span>
        </label>
        <textarea
          id="medication"
          bind:value={medication}
          class="textarea w-full"
          rows="2"
          placeholder='List current medications, or type "None"'
          disabled={loading}
        ></textarea>
        {#if hasError('medication')}
          <p class="text-sm text-error-500 mt-1">{errors.medication}</p>
        {/if}
      </div>

      <!-- Terms -->
      <div class="field">
        <label class="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={termsAccepted}
            disabled={loading}
            class="checkbox mt-0.5"
          />
          <span class="text-sm">
            I acknowledge that the information provided is accurate and I consent to treatment.
            <span class="text-error-500">*</span>
          </span>
        </label>
        {#if hasError('termsAccepted')}
          <p class="text-sm text-error-500 mt-1">{errors.termsAccepted}</p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Submit Button -->
  <div class="mt-6">
    <button
      type="submit"
      class="btn w-full preset-filled-primary-500 py-3"
      disabled={loading}
    >
      {#if loading}
        <span class="spinner mr-2"></span>
        Processing...
      {:else}
        Continue to Payment
      {/if}
    </button>
  </div>

  <p class="text-xs text-surface-500 mt-4 text-center">
    Your information is secure and will only be used to manage your appointment.
  </p>
</form>

<style>
  .client-form {
    width: 100%;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  @media (min-width: 640px) {
    .form-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .input,
  .textarea {
    padding: 0.75rem 1rem;
    border: 1px solid var(--color-surface-300);
    border-radius: var(--radius-container);
    background: var(--color-surface-50);
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .input:focus,
  .textarea:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 3px rgba(var(--color-primary-500-rgb), 0.1);
  }

  .input-error {
    border-color: var(--color-error-500);
  }

  .input:disabled,
  .textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Dark mode adjustments */
  :global(.dark) .input,
  :global(.dark) .textarea {
    background: var(--color-surface-800);
    border-color: var(--color-surface-600);
  }
</style>
