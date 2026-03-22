/**
 * PaymentSelector Component Tests
 * Tests payment method selection functionality
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PaymentSelector from '../../src/components/PaymentSelector.svelte';

// Mock payment methods
const createMockPaymentMethods = () => [
  {
    id: 'venmo',
    displayName: 'Venmo',
    description: 'Pay with Venmo',
    available: true,
    icon: 'venmo',
  },
  {
    id: 'cash',
    displayName: 'Cash',
    description: 'Pay cash at appointment',
    available: true,
    icon: 'cash',
  },
  {
    id: 'stripe',
    displayName: 'Credit Card',
    description: 'Pay with card',
    available: true,
    processingFeePercent: 2.9,
    icon: 'stripe',
  },
  {
    id: 'disabled',
    displayName: 'Unavailable Method',
    available: false,
  },
];

describe('PaymentSelector Component', () => {
  const mockMethods = createMockPaymentMethods();

  it('renders amount due', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 20000 },
    });

    expect(screen.getByText('Amount Due')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
  });

  it('renders all payment methods', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    expect(screen.getByText('Venmo')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Credit Card')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(PaymentSelector, {
      props: { methods: [], amount: 10000, loading: true },
    });

    const skeletons = document.querySelectorAll('.skeleton-method');
    expect(skeletons.length).toBe(3);
  });

  it('shows empty state when no methods', () => {
    render(PaymentSelector, {
      props: { methods: [], amount: 10000 },
    });

    expect(screen.getByText('No payment methods available.')).toBeInTheDocument();
  });

  it('displays method descriptions', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    expect(screen.getByText('Pay with Venmo')).toBeInTheDocument();
    expect(screen.getByText('Pay cash at appointment')).toBeInTheDocument();
  });

  it('displays processing fee percentage', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    expect(screen.getByText('+2.9%')).toBeInTheDocument();
  });

  it('calls onSelect when method is clicked', async () => {
    const onSelect = vi.fn();
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, onSelect },
    });

    const venmoButton = screen.getByText('Venmo').closest('button');
    await fireEvent.click(venmoButton!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('venmo');
  });

  it('marks selected method with aria-pressed', async () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, selectedMethod: 'venmo' },
    });

    const venmoButton = screen.getByText('Venmo').closest('button');
    expect(venmoButton).toHaveAttribute('aria-pressed', 'true');

    const cashButton = screen.getByText('Cash').closest('button');
    expect(cashButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables unavailable methods', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    const unavailableButton = screen.getByText('Unavailable Method').closest('button');
    expect(unavailableButton).toBeDisabled();
  });

  it('shows proceed button when method is selected', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, selectedMethod: 'venmo' },
    });

    expect(screen.getByRole('button', { name: /continue with venmo/i })).toBeInTheDocument();
  });

  it('hides proceed button when no method selected', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    expect(screen.queryByRole('button', { name: /continue with/i })).not.toBeInTheDocument();
  });

  it('calls onProceed when proceed button is clicked', async () => {
    const onProceed = vi.fn();
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, selectedMethod: 'cash', onProceed },
    });

    const proceedButton = screen.getByRole('button', { name: /continue with cash/i });
    await fireEvent.click(proceedButton);

    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledWith('cash');
  });

  it('applies selected styling', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, selectedMethod: 'venmo' },
    });

    const venmoButton = screen.getByText('Venmo').closest('button');
    expect(venmoButton).toHaveClass('ring-2');
  });

  it('shows checkmark on selected method', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000, selectedMethod: 'venmo' },
    });

    const venmoButton = screen.getByText('Venmo').closest('button');
    expect(venmoButton?.textContent).toContain('✓');
  });

  it('formats different currencies correctly', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 15000, currency: 'EUR' },
    });

    // EUR formatting depends on locale
    expect(screen.getByText(/150/)).toBeInTheDocument();
  });

  it('displays payment method icons', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    // Icons are emoji - should be in the DOM
    const venmoButton = screen.getByText('Venmo').closest('button');
    expect(venmoButton?.textContent).toContain('💙'); // Venmo icon

    const cashButton = screen.getByText('Cash').closest('button');
    expect(cashButton?.textContent).toContain('💵'); // Cash icon
  });

  it('displays fixed processing fee', () => {
    const methodsWithFee = [
      {
        id: 'card',
        displayName: 'Card',
        available: true,
        processingFee: 350, // $3.50
      },
    ];

    render(PaymentSelector, {
      props: { methods: methodsWithFee, amount: 10000 },
    });

    expect(screen.getByText('+$3.50')).toBeInTheDocument();
  });

  it('shows section heading', () => {
    render(PaymentSelector, {
      props: { methods: mockMethods, amount: 10000 },
    });

    expect(screen.getByText('Select Payment Method')).toBeInTheDocument();
  });
});
