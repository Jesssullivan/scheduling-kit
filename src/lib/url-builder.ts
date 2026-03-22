/**
 * Acuity URL Builder
 * Constructs pre-filled embed URLs for the hybrid checkout flow
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ClientInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface BookingParams {
  /** Service/appointment type ID */
  serviceId?: string;
  /** Service category filter */
  category?: string;
  /** Multiple service IDs */
  serviceIds?: string[];
  /** Calendar/provider ID */
  providerId?: string;
  /** Pre-selected datetime (ISO 8601) */
  datetime?: string;
  /** Certificate/coupon code */
  certificate?: string;
  /** Custom form field values */
  customFields?: Record<string, string | string[]>;
  /** Calendar template (monthly or weekly) */
  template?: 'monthly' | 'weekly';
}

export interface EmbedUrlOptions {
  /** Base Acuity scheduling URL */
  baseUrl: string;
  /** Client pre-fill information */
  client?: ClientInfo;
  /** Booking parameters */
  booking?: BookingParams;
  /** Additional query parameters */
  extra?: Record<string, string>;
}

// =============================================================================
// URL BUILDER
// =============================================================================

/**
 * Build a pre-filled Acuity embed URL
 *
 * @example
 * ```typescript
 * const url = buildAcuityUrl({
 *   baseUrl: 'https://YourBusiness.as.me',
 *   client: {
 *     firstName: 'Jane',
 *     lastName: 'Doe',
 *     email: 'jane@example.com',
 *     phone: '5551234567'
 *   },
 *   booking: {
 *     serviceId: '52957336',
 *     datetime: '2026-02-15T14:00-05:00'
 *   }
 * });
 * // Returns: https://YourBusiness.as.me?firstName=Jane&lastName=Doe&...
 * ```
 */
export const buildAcuityUrl = (options: EmbedUrlOptions): string => {
  const url = new URL(options.baseUrl);

  // Client pre-fill
  if (options.client) {
    const { firstName, lastName, email, phone } = options.client;
    if (firstName) url.searchParams.set('firstName', firstName);
    if (lastName) url.searchParams.set('lastName', lastName);
    if (email) url.searchParams.set('email', email);
    if (phone) url.searchParams.set('phone', phone);
  }

  // Booking parameters
  if (options.booking) {
    const { serviceId, serviceIds, category, providerId, datetime, certificate, template, customFields } =
      options.booking;

    // Service selection (mutually exclusive patterns)
    if (serviceIds && serviceIds.length > 0) {
      // Multiple services
      serviceIds.forEach((id) => {
        url.searchParams.append('appointmentType[]', id);
      });
    } else if (category) {
      // Category filter
      url.searchParams.set('appointmentType', `category:${category}`);
    } else if (serviceId) {
      // Single service
      url.searchParams.set('appointmentType', serviceId);
    }

    // Provider/calendar
    if (providerId) {
      url.searchParams.set('calendarID', providerId);
    }

    // Pre-selected datetime
    if (datetime) {
      url.searchParams.set('datetime', datetime);
    }

    // Certificate/coupon
    if (certificate) {
      url.searchParams.set('certificate', certificate);
    }

    // Calendar template
    if (template) {
      url.searchParams.set('template', template);
    }

    // Custom form fields
    if (customFields) {
      for (const [fieldId, value] of Object.entries(customFields)) {
        if (Array.isArray(value)) {
          // Checkbox/multi-select fields
          value.forEach((v) => {
            url.searchParams.append(`field:${fieldId}[]`, v);
          });
        } else {
          url.searchParams.set(`field:${fieldId}`, value);
        }
      }
    }
  }

  // Extra parameters
  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
};

/**
 * Build embed URL for a specific service category
 */
export const buildCategoryUrl = (baseUrl: string, category: string, client?: ClientInfo): string =>
  buildAcuityUrl({
    baseUrl,
    client,
    booking: { category },
  });

/**
 * Build embed URL for TMD services specifically
 */
export const buildTMDUrl = (baseUrl: string, client?: ClientInfo): string =>
  buildCategoryUrl(baseUrl, 'TMD Massage', client);

/**
 * Build embed URL with full booking details
 */
export const buildBookingUrl = (
  baseUrl: string,
  serviceId: string,
  datetime: string,
  client: ClientInfo
): string =>
  buildAcuityUrl({
    baseUrl,
    client,
    booking: {
      serviceId,
      datetime,
    },
  });

// =============================================================================
// URL PARSER
// =============================================================================

/**
 * Parse an Acuity URL to extract booking parameters
 * Useful for debugging or URL inspection
 */
export const parseAcuityUrl = (
  urlString: string
): {
  baseUrl: string;
  client: ClientInfo;
  booking: BookingParams;
} => {
  const url = new URL(urlString);

  const client: ClientInfo = {
    firstName: url.searchParams.get('firstName') || undefined,
    lastName: url.searchParams.get('lastName') || undefined,
    email: url.searchParams.get('email') || undefined,
    phone: url.searchParams.get('phone') || undefined,
  };

  const appointmentType = url.searchParams.get('appointmentType');
  const appointmentTypes = url.searchParams.getAll('appointmentType[]');

  const booking: BookingParams = {
    serviceId: appointmentType?.startsWith('category:') ? undefined : appointmentType || undefined,
    category: appointmentType?.startsWith('category:')
      ? appointmentType.replace('category:', '')
      : undefined,
    serviceIds: appointmentTypes.length > 0 ? appointmentTypes : undefined,
    providerId: url.searchParams.get('calendarID') || undefined,
    datetime: url.searchParams.get('datetime') || undefined,
    certificate: url.searchParams.get('certificate') || undefined,
    template: (url.searchParams.get('template') as 'monthly' | 'weekly') || undefined,
  };

  // Extract custom fields
  const customFields: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const fieldMatch = key.match(/^field:(\d+)(\[\])?$/);
    if (fieldMatch) {
      const fieldId = fieldMatch[1];
      const isArray = !!fieldMatch[2];

      if (isArray) {
        if (!customFields[fieldId]) {
          customFields[fieldId] = [];
        }
        (customFields[fieldId] as string[]).push(value);
      } else {
        customFields[fieldId] = value;
      }
    }
  }

  if (Object.keys(customFields).length > 0) {
    booking.customFields = customFields;
  }

  // Get base URL without query params
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  return { baseUrl, client, booking };
};

// =============================================================================
// IFRAME HTML GENERATOR
// =============================================================================

/**
 * Generate iframe HTML for embedding
 */
export const generateIframeHtml = (
  url: string,
  options: {
    width?: string | number;
    height?: string | number;
    title?: string;
    className?: string;
    id?: string;
  } = {}
): string => {
  const { width = '100%', height = 800, title = 'Schedule Appointment', className, id } = options;

  const attrs = [
    `src="${url}"`,
    `title="${title}"`,
    `width="${width}"`,
    `height="${height}"`,
    'frameborder="0"',
    'scrolling="auto"',
  ];

  if (className) attrs.push(`class="${className}"`);
  if (id) attrs.push(`id="${id}"`);

  return `<iframe ${attrs.join(' ')}></iframe>`;
};
