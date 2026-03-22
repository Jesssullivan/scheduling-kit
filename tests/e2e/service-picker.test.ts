/**
 * ServicePicker Component Tests
 * Tests service selection functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ServicePicker from '../../src/components/ServicePicker.svelte';
import { createMockServices, tick } from './setup.js';

describe('ServicePicker Component', () => {
  const mockServices = createMockServices();

  it('renders all services', async () => {
    render(ServicePicker, { props: { services: mockServices } });
    await tick();

    await waitFor(() => {
      expect(screen.getByText('TMD 60 min')).toBeInTheDocument();
    });
    expect(screen.getByText('TMD 30 min')).toBeInTheDocument();
    expect(screen.getByText('Therapeutic Massage 60 min')).toBeInTheDocument();
  });

  it('displays loading state', () => {
    render(ServicePicker, { props: { services: [], loading: true } });

    // Should show skeleton cards
    const skeletons = document.querySelectorAll('.skeleton-card');
    expect(skeletons.length).toBe(3);
  });

  it('displays error state', () => {
    const errorMessage = 'Failed to load services';
    render(ServicePicker, { props: { services: [], error: errorMessage } });

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('displays empty state when no services', () => {
    render(ServicePicker, { props: { services: [] } });

    expect(screen.getByText('No services available')).toBeInTheDocument();
  });

  it('formats price correctly', () => {
    render(ServicePicker, { props: { services: mockServices } });

    // TMD 60 min is $200.00
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    // TMD 30 min is $100.00
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('formats duration correctly', () => {
    render(ServicePicker, { props: { services: mockServices } });

    // 60 min should show as "60 min" or "1h"
    const hourTexts = screen.getAllByText(/60 min|1h/);
    expect(hourTexts.length).toBeGreaterThan(0);
  });

  it('groups services by category by default', () => {
    render(ServicePicker, { props: { services: mockServices } });

    // Should show category headers
    expect(screen.getByText('TMD/TMJ Therapy')).toBeInTheDocument();
    expect(screen.getByText('Massage')).toBeInTheDocument();
  });

  it('can disable category grouping', () => {
    render(ServicePicker, { props: { services: mockServices, groupByCategory: false } });

    // Should show "All Services" instead
    expect(screen.queryByText('TMD/TMJ Therapy')).not.toBeInTheDocument();
  });

  it('calls onSelect when service is clicked', async () => {
    const onSelect = vi.fn();
    render(ServicePicker, { props: { services: mockServices, onSelect } });

    const serviceCard = screen.getByText('TMD 60 min').closest('button');
    expect(serviceCard).toBeInTheDocument();

    await fireEvent.click(serviceCard!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockServices[0]);
  });

  it('marks selected service with aria-pressed', async () => {
    render(ServicePicker, {
      props: { services: mockServices, selectedService: mockServices[0] },
    });

    const serviceCard = screen.getByText('TMD 60 min').closest('button');
    expect(serviceCard).toHaveAttribute('aria-pressed', 'true');

    const otherCard = screen.getByText('TMD 30 min').closest('button');
    expect(otherCard).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies selected styling to active service', async () => {
    render(ServicePicker, {
      props: { services: mockServices, selectedService: mockServices[0] },
    });

    const serviceCard = screen.getByText('TMD 60 min').closest('button');
    expect(serviceCard).toHaveClass('ring-2');
  });

  it('displays service color indicator', () => {
    render(ServicePicker, { props: { services: mockServices } });

    // Services with colors should have color indicator
    const colorIndicators = document.querySelectorAll('[style*="background-color"]');
    expect(colorIndicators.length).toBeGreaterThan(0);
  });

  it('displays service description', () => {
    render(ServicePicker, { props: { services: mockServices } });

    expect(
      screen.getByText('Full TMD/TMJ therapy session with intraoral work')
    ).toBeInTheDocument();
  });
});
