/**
 * Sensitive Data Masking
 * Auto-detect and mask PII, credentials, and sensitive data
 */

// =============================================================================
// MASKING CONFIGURATION
// =============================================================================

/**
 * Masking configuration
 */
export interface MaskingConfig {
  /** Fields to always mask (by key name) */
  sensitiveFields: string[];
  /** Regex patterns for auto-detection */
  patterns: Array<{
    name: string;
    pattern: RegExp;
    replacement: string;
  }>;
  /** Headers to mask */
  sensitiveHeaders: string[];
  /** Query params to mask */
  sensitiveParams: string[];
  /** Preserve structure (mask value, keep key) */
  preserveStructure: boolean;
  /** Mask function for custom handling */
  customMasker?: (value: string, fieldName: string) => string;
}

/**
 * Default masking configuration
 */
export const defaultMaskingConfig: MaskingConfig = {
  sensitiveFields: [
    // Authentication
    'password',
    'apiKey',
    'api_key',
    'apikey',
    'secret',
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'bearer',
    'authorization',
    // Personal info
    'email',
    'phone',
    'ssn',
    'socialSecurityNumber',
    'social_security_number',
    'dob',
    'dateOfBirth',
    'date_of_birth',
    'birthDate',
    'birth_date',
    // Financial
    'creditCard',
    'credit_card',
    'cardNumber',
    'card_number',
    'cvv',
    'cvc',
    'expiryDate',
    'expiry_date',
    'accountNumber',
    'account_number',
    'routingNumber',
    'routing_number',
    // Acuity-specific
    'userId',
    'user_id',
    'calendarID',
    // PayPal-specific
    'payer_id',
    'client_id',
    'client_secret',
  ],
  patterns: [
    // Email
    {
      name: 'email',
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      replacement: '[MASKED_EMAIL]',
    },
    // Phone numbers (various formats)
    {
      name: 'phone',
      pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      replacement: '[MASKED_PHONE]',
    },
    // Credit card numbers (basic)
    {
      name: 'credit_card',
      pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      replacement: '[MASKED_CARD]',
    },
    // SSN
    {
      name: 'ssn',
      pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
      replacement: '[MASKED_SSN]',
    },
    // API keys (common formats)
    {
      name: 'api_key',
      pattern: /(?:sk_|pk_|api_|key_)[a-zA-Z0-9]{20,}/g,
      replacement: '[MASKED_API_KEY]',
    },
    // Bearer tokens
    {
      name: 'bearer',
      pattern: /Bearer\s+[a-zA-Z0-9._-]+/gi,
      replacement: 'Bearer [MASKED_TOKEN]',
    },
    // Basic auth
    {
      name: 'basic_auth',
      pattern: /Basic\s+[a-zA-Z0-9+/=]+/gi,
      replacement: 'Basic [MASKED_CREDENTIALS]',
    },
    // UUID (might be sensitive IDs)
    {
      name: 'uuid',
      pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      replacement: '[MASKED_UUID]',
    },
    // IPv4 addresses
    {
      name: 'ip',
      pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      replacement: '[MASKED_IP]',
    },
  ],
  sensitiveHeaders: [
    'authorization',
    'x-api-key',
    'x-auth-token',
    'cookie',
    'set-cookie',
    'x-acuity-signature',
    'x-paypal-security-context',
  ],
  sensitiveParams: ['apiKey', 'api_key', 'token', 'access_token', 'secret'],
  preserveStructure: true,
};

// =============================================================================
// MASKING FUNCTIONS
// =============================================================================

/**
 * Mask a string value based on patterns
 */
export const maskString = (
  value: string,
  config: MaskingConfig = defaultMaskingConfig
): string => {
  let masked = value;

  // Apply pattern-based masking
  for (const { pattern, replacement } of config.patterns) {
    masked = masked.replace(pattern, replacement);
  }

  return masked;
};

/**
 * Mask object values recursively
 */
export const maskObject = <T extends Record<string, unknown>>(
  obj: T,
  config: MaskingConfig = defaultMaskingConfig
): T => {
  const masked = {} as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    const isSensitiveField = config.sensitiveFields.some(
      (f) => keyLower === f.toLowerCase() || keyLower.includes(f.toLowerCase())
    );

    if (isSensitiveField) {
      // Mask sensitive field
      if (config.preserveStructure) {
        if (typeof value === 'string') {
          masked[key] = `[MASKED_${key.toUpperCase()}]`;
        } else if (typeof value === 'number') {
          masked[key] = 0;
        } else if (typeof value === 'boolean') {
          masked[key] = false;
        } else {
          masked[key] = '[MASKED]';
        }
      } else {
        masked[key] = '[MASKED]';
      }
    } else if (typeof value === 'string') {
      // Apply pattern masking to string values
      masked[key] = maskString(value, config);
    } else if (Array.isArray(value)) {
      // Recurse into arrays
      masked[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? maskObject(item as Record<string, unknown>, config)
          : typeof item === 'string'
            ? maskString(item, config)
            : item
      );
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into nested objects
      masked[key] = maskObject(value as Record<string, unknown>, config);
    } else {
      // Keep non-string primitives as-is
      masked[key] = value;
    }
  }

  return masked as T;
};

/**
 * Mask HTTP headers
 */
export const maskHeaders = (
  headers: Record<string, string>,
  config: MaskingConfig = defaultMaskingConfig
): Record<string, string> => {
  const masked: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const keyLower = key.toLowerCase();
    if (config.sensitiveHeaders.includes(keyLower)) {
      masked[key] = `[MASKED_${key.toUpperCase().replace(/-/g, '_')}]`;
    } else {
      masked[key] = maskString(value, config);
    }
  }

  return masked;
};

/**
 * Mask query parameters in a URL
 */
export const maskUrl = (
  url: string,
  config: MaskingConfig = defaultMaskingConfig
): string => {
  try {
    const parsed = new URL(url);

    for (const param of config.sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, `[MASKED_${param.toUpperCase()}]`);
      }
    }

    // Also mask any patterns in the path
    let maskedPath = parsed.pathname;
    for (const { pattern, replacement } of config.patterns) {
      maskedPath = maskedPath.replace(pattern, replacement);
    }
    parsed.pathname = maskedPath;

    return parsed.toString();
  } catch {
    // If URL parsing fails, apply pattern masking to the whole string
    return maskString(url, config);
  }
};

/**
 * Mask JSON body (parse, mask, stringify)
 */
export const maskJsonBody = (
  body: string,
  config: MaskingConfig = defaultMaskingConfig
): string => {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const masked = maskObject(parsed, config);
      return JSON.stringify(masked);
    }
    return body;
  } catch {
    // Not valid JSON, apply string masking
    return maskString(body, config);
  }
};

// =============================================================================
// CASSETTE-SPECIFIC MASKING
// =============================================================================

import type { CassetteEntry, CassetteRequest, CassetteResponse } from './cassette.js';

/**
 * Mask a cassette request
 */
export const maskRequest = (
  request: CassetteRequest,
  config: MaskingConfig = defaultMaskingConfig
): CassetteRequest => ({
  method: request.method,
  url: maskUrl(request.url, config),
  headers: maskHeaders(request.headers, config),
  body: request.body ? maskJsonBody(request.body, config) : undefined,
  queryParams: request.queryParams
    ? maskObject(request.queryParams as Record<string, unknown>, config) as Record<string, string>
    : undefined,
});

/**
 * Mask a cassette response
 */
export const maskResponse = (
  response: CassetteResponse,
  config: MaskingConfig = defaultMaskingConfig
): CassetteResponse => ({
  status: response.status,
  statusText: response.statusText,
  headers: maskHeaders(response.headers, config),
  body: response.body ? maskJsonBody(response.body, config) : undefined,
  json: response.json
    ? maskObject(response.json as Record<string, unknown>, config)
    : undefined,
});

/**
 * Mask a full cassette entry
 */
export const maskEntry = (
  entry: CassetteEntry,
  config: MaskingConfig = defaultMaskingConfig
): CassetteEntry => ({
  ...entry,
  request: maskRequest(entry.request, config),
  response: maskResponse(entry.response, config),
});

// =============================================================================
// CONFIGURATION HELPERS
// =============================================================================

/**
 * Create a custom masking config
 */
export const createMaskingConfig = (
  overrides: Partial<MaskingConfig>
): MaskingConfig => ({
  ...defaultMaskingConfig,
  ...overrides,
  sensitiveFields: [
    ...defaultMaskingConfig.sensitiveFields,
    ...(overrides.sensitiveFields || []),
  ],
  patterns: [...defaultMaskingConfig.patterns, ...(overrides.patterns || [])],
  sensitiveHeaders: [
    ...defaultMaskingConfig.sensitiveHeaders,
    ...(overrides.sensitiveHeaders || []),
  ],
  sensitiveParams: [
    ...defaultMaskingConfig.sensitiveParams,
    ...(overrides.sensitiveParams || []),
  ],
});

/**
 * Add Acuity-specific masking rules
 */
export const acuityMaskingConfig = createMaskingConfig({
  sensitiveFields: [
    'firstName',
    'lastName',
    'notes', // May contain payment refs
  ],
  patterns: [
    // Acuity confirmation URLs
    {
      name: 'acuity_confirmation',
      pattern: /confirm\.php\?id=\d+/g,
      replacement: 'confirm.php?id=[MASKED_ID]',
    },
  ],
});

/**
 * Add PayPal-specific masking rules
 */
export const paypalMaskingConfig = createMaskingConfig({
  sensitiveFields: ['payer', 'payee', 'nonce', 'app_id'],
  patterns: [
    // PayPal transaction IDs
    {
      name: 'paypal_capture',
      pattern: /CAPTURE-[A-Z0-9-]+/g,
      replacement: 'CAPTURE-[MASKED]',
    },
    {
      name: 'paypal_refund',
      pattern: /REFUND-[A-Z0-9-]+/g,
      replacement: 'REFUND-[MASKED]',
    },
  ],
});
