/**
 * E2E/Component Test Setup
 * Configures jsdom environment for @testing-library/svelte tests
 */

import { vi, beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia for responsive tests
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver
  const mockIntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: mockIntersectionObserver,
  });

  // Mock ResizeObserver
  const mockResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: mockResizeObserver,
  });

  // Mock scrollTo
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
  });

  // Mock CSS custom properties (for Skeleton theming)
  Object.defineProperty(document.documentElement.style, 'setProperty', {
    writable: true,
    value: vi.fn(),
  });
});

// Helper to create mock services
export const createMockServices = () => [
  {
    id: 'service-1',
    name: 'TMD 60 min',
    description: 'Full TMD/TMJ therapy session with intraoral work',
    duration: 60,
    price: 20000, // $200.00 in cents
    currency: 'USD',
    category: 'TMD/TMJ Therapy',
    color: '#4A90A4',
  },
  {
    id: 'service-2',
    name: 'TMD 30 min',
    description: 'Shorter TMD session',
    duration: 30,
    price: 10000,
    currency: 'USD',
    category: 'TMD/TMJ Therapy',
    color: '#4A90A4',
  },
  {
    id: 'service-3',
    name: 'Therapeutic Massage 60 min',
    description: 'General therapeutic massage',
    duration: 60,
    price: 15000,
    currency: 'USD',
    category: 'Massage',
    color: '#7B68EE',
  },
];

// Helper to create mock providers
export const createMockProviders = () => [
  {
    id: 'provider-1',
    name: 'Jennifer Sullivan',
    email: 'jen@massageithaca.com',
    color: '#4A90A4',
  },
];

// Helper to create mock client info
export const createMockClient = (overrides = {}) => ({
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  phone: '6075551234',
  ...overrides,
});

// Helper to wait for component updates
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Helper for async component events
export const waitForEvent = <T>(
  element: HTMLElement,
  eventName: string,
  timeout = 1000
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    element.addEventListener(
      eventName,
      ((e: CustomEvent<T>) => {
        clearTimeout(timer);
        resolve(e.detail);
      }) as EventListener,
      { once: true }
    );
  });
};
