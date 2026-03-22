/**
 * API Recorder
 * Records HTTP interactions for replay testing
 */

import type {
  Cassette,
  CassetteEntry,
  CassetteRequest,
  CassetteResponse,
} from './cassette.js';
import { createCassette, addEntry, createEntry } from './cassette.js';
import { maskEntry, type MaskingConfig, defaultMaskingConfig } from './masking.js';

// =============================================================================
// RECORDER TYPES
// =============================================================================

/**
 * Recording mode
 * - record: Capture real HTTP requests and save to cassette
 * - replay: Return cached responses from cassette
 * - passthrough: No recording/replay, pass through to real API
 */
export type RecorderMode = 'record' | 'replay' | 'passthrough';

/**
 * Recorder configuration
 */
export interface RecorderConfig {
  /** Recording mode */
  mode: RecorderMode;
  /** Cassette name/identifier */
  cassetteName: string;
  /** Services to record (e.g., ['acuity', 'paypal']) */
  services: string[];
  /** Masking configuration */
  masking?: MaskingConfig;
  /** Whether to mask recorded data */
  enableMasking?: boolean;
  /** Callback when recording completes */
  onComplete?: (cassette: Cassette) => void | Promise<void>;
  /** Callback for unmatched requests in replay mode */
  onUnmatchedRequest?: (request: CassetteRequest) => CassetteResponse | undefined;
}

/**
 * API Recorder class
 */
export class APIRecorder {
  private config: RecorderConfig;
  private cassette: Cassette;
  private originalFetch: typeof fetch;
  private isActive = false;

  constructor(config: RecorderConfig) {
    this.config = {
      enableMasking: true,
      ...config,
    };
    this.cassette = createCassette(config.cassetteName, config.services);
    this.originalFetch = globalThis.fetch;
  }

  /**
   * Start recording/replaying
   */
  start(): void {
    if (this.isActive) {
      throw new Error('Recorder is already active');
    }

    this.isActive = true;

    // Intercept fetch
    globalThis.fetch = this.createInterceptedFetch();
  }

  /**
   * Stop recording and return cassette
   */
  async stop(): Promise<Cassette> {
    if (!this.isActive) {
      throw new Error('Recorder is not active');
    }

    this.isActive = false;

    // Restore original fetch
    globalThis.fetch = this.originalFetch;

    // Call completion callback
    if (this.config.onComplete) {
      await this.config.onComplete(this.cassette);
    }

    return this.cassette;
  }

  /**
   * Get current cassette (for inspection during recording)
   */
  getCassette(): Cassette {
    return this.cassette;
  }

  /**
   * Load cassette for replay mode
   */
  loadCassette(cassette: Cassette): void {
    this.cassette = {
      ...cassette,
      config: {
        ...cassette.config,
        mode: this.config.mode,
      },
    };
  }

  /**
   * Create intercepted fetch function
   */
  private createInterceptedFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = this.normalizeRequest(input, init);

      // Check if this request should be intercepted
      if (!this.shouldIntercept(request)) {
        return this.originalFetch(input, init);
      }

      switch (this.config.mode) {
        case 'record':
          return this.recordRequest(request, input, init);
        case 'replay':
          return this.replayRequest(request);
        case 'passthrough':
        default:
          return this.originalFetch(input, init);
      }
    };
  }

  /**
   * Normalize request info into CassetteRequest
   */
  private normalizeRequest(input: RequestInfo | URL, init?: RequestInit): CassetteRequest {
    let url: string;
    let method = 'GET';
    let headers: Record<string, string> = {};
    let body: string | undefined;

    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      // Request object
      url = input.url;
      method = input.method;
    }

    if (init) {
      method = init.method || method;
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key.toLowerCase()] = value;
          }
        } else {
          headers = Object.fromEntries(
            Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])
          );
        }
      }
      if (init.body) {
        body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
      }
    }

    // Extract query params
    const parsedUrl = new URL(url);
    const queryParams: Record<string, string> = {};
    parsedUrl.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    return {
      method,
      url,
      headers,
      body,
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    };
  }

  /**
   * Check if request should be intercepted based on service URL
   */
  private shouldIntercept(request: CassetteRequest): boolean {
    const url = request.url.toLowerCase();

    // Match against configured services
    const servicePatterns: Record<string, RegExp> = {
      acuity: /acuityscheduling\.com/i,
      paypal: /paypal\.com/i,
      stripe: /stripe\.com/i,
    };

    for (const service of this.config.services) {
      const pattern = servicePatterns[service];
      if (pattern && pattern.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Record mode: Make real request and save to cassette
   */
  private async recordRequest(
    cassetteRequest: CassetteRequest,
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const startTime = Date.now();

    try {
      const response = await this.originalFetch(input, init);
      const duration = Date.now() - startTime;

      // Clone response to read body
      const clonedResponse = response.clone();
      const responseBody = await clonedResponse.text();

      // Build cassette response
      const cassetteResponse: CassetteResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };

      // Try to parse JSON
      try {
        cassetteResponse.json = JSON.parse(responseBody);
      } catch {
        // Not JSON, leave json undefined
      }

      // Create entry
      let entry = createEntry(cassetteRequest, cassetteResponse, duration);

      // Apply masking if enabled
      if (this.config.enableMasking) {
        entry = maskEntry(entry, this.config.masking || defaultMaskingConfig);
      }

      // Add to cassette
      this.cassette = addEntry(this.cassette, entry);

      return response;
    } catch (error) {
      // Record failed requests too
      const duration = Date.now() - startTime;
      const cassetteResponse: CassetteResponse = {
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: error instanceof Error ? error.message : String(error),
      };

      let entry = createEntry(cassetteRequest, cassetteResponse, duration);
      if (this.config.enableMasking) {
        entry = maskEntry(entry, this.config.masking || defaultMaskingConfig);
      }
      this.cassette = addEntry(this.cassette, entry);

      throw error;
    }
  }

  /**
   * Replay mode: Return cached response from cassette
   */
  private replayRequest(request: CassetteRequest): Promise<Response> {
    // Find matching entry
    const entry = this.findMatchingEntry(request);

    if (!entry) {
      // Try unmatched callback
      if (this.config.onUnmatchedRequest) {
        const fallbackResponse = this.config.onUnmatchedRequest(request);
        if (fallbackResponse) {
          return Promise.resolve(this.createResponse(fallbackResponse));
        }
      }

      // No match found
      return Promise.reject(
        new Error(
          `No matching cassette entry for ${request.method} ${request.url}\n` +
            `Available entries: ${this.cassette.entries.map((e) => `${e.request.method} ${e.request.url}`).join(', ')}`
        )
      );
    }

    return Promise.resolve(this.createResponse(entry.response));
  }

  /**
   * Find matching entry in cassette
   */
  private findMatchingEntry(request: CassetteRequest): CassetteEntry | undefined {
    return this.cassette.entries.find((entry) => {
      // Method must match
      if (entry.request.method !== request.method) {
        return false;
      }

      // URL path must match (ignore host differences for portability)
      const entryPath = new URL(entry.request.url).pathname;
      const requestPath = new URL(request.url).pathname;
      if (entryPath !== requestPath) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create Response object from cassette response
   */
  private createResponse(cassetteResponse: CassetteResponse): Response {
    const headers = new Headers(cassetteResponse.headers);

    return new Response(cassetteResponse.body, {
      status: cassetteResponse.status,
      statusText: cassetteResponse.statusText,
      headers,
    });
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a recorder for Acuity API
 */
export const createAcuityRecorder = (
  cassetteName: string,
  mode: RecorderMode = 'record'
): APIRecorder =>
  new APIRecorder({
    mode,
    cassetteName,
    services: ['acuity'],
  });

/**
 * Create a recorder for PayPal API
 */
export const createPayPalRecorder = (
  cassetteName: string,
  mode: RecorderMode = 'record'
): APIRecorder =>
  new APIRecorder({
    mode,
    cassetteName,
    services: ['paypal'],
  });

/**
 * Create a recorder for all scheduling-related APIs
 */
export const createSchedulingRecorder = (
  cassetteName: string,
  mode: RecorderMode = 'record'
): APIRecorder =>
  new APIRecorder({
    mode,
    cassetteName,
    services: ['acuity', 'paypal'],
  });

/**
 * Run a function with recording and return both result and cassette
 */
export const withRecording = async <T>(
  cassetteName: string,
  services: string[],
  fn: () => Promise<T>
): Promise<{ result: T; cassette: Cassette }> => {
  const recorder = new APIRecorder({
    mode: 'record',
    cassetteName,
    services,
  });

  recorder.start();

  try {
    const result = await fn();
    const cassette = await recorder.stop();
    return { result, cassette };
  } catch (error) {
    await recorder.stop();
    throw error;
  }
};

/**
 * Run a function with cassette replay
 */
export const withReplay = async <T>(
  cassette: Cassette,
  fn: () => Promise<T>
): Promise<T> => {
  const recorder = new APIRecorder({
    mode: 'replay',
    cassetteName: cassette.name,
    services: cassette.config.services,
  });

  recorder.loadCassette(cassette);
  recorder.start();

  try {
    return await fn();
  } finally {
    await recorder.stop();
  }
};
