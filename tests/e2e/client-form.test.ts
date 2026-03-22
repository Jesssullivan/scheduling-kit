/**
 * ClientForm Component Tests
 * Tests client information form with validation
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ClientForm from '../../src/components/ClientForm.svelte';
import { createMockClient, tick } from './setup.js';

describe('ClientForm Component', () => {
  it('renders all form fields', () => {
    render(ClientForm, { props: {} });

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('populates initial data', () => {
    const client = createMockClient();
    render(ClientForm, { props: { initialData: client } });

    expect(screen.getByLabelText(/first name/i)).toHaveValue('Test');
    expect(screen.getByLabelText(/last name/i)).toHaveValue('User');
    expect(screen.getByLabelText(/email/i)).toHaveValue('test@example.com');
  });

  it('shows submit button', () => {
    render(ClientForm, { props: {} });

    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument();
  });

  it('shows loading state on submit button', () => {
    render(ClientForm, { props: { loading: true } });

    expect(screen.getByRole('button', { name: /processing/i })).toBeInTheDocument();
  });

  it('disables inputs when loading', () => {
    render(ClientForm, { props: { loading: true } });

    expect(screen.getByLabelText(/first name/i)).toBeDisabled();
    expect(screen.getByLabelText(/last name/i)).toBeDisabled();
    expect(screen.getByLabelText(/email/i)).toBeDisabled();
  });

  it('calls onSubmit with valid data', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    // Fill in required fields
    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });

    // Submit form
    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: undefined,
      notes: undefined,
    });
  });

  it('validates required first name', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    // Fill only email and last name
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });

    // Submit form
    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    // Should show error and not call onSubmit
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
  });

  it('validates required last name', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    // Fill only first name and email
    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });

    // Submit form
    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    // Should show error
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
  });

  it('validates email format', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    // Fill with invalid email
    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });

    // Submit form
    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    // Should show error
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
  });

  it('formats phone number as typed', async () => {
    render(ClientForm, { props: {} });

    const phoneInput = screen.getByLabelText(/phone/i);
    await fireEvent.input(phoneInput, { target: { value: '6075551234' } });

    // Should format as (607) 555-1234
    expect(phoneInput).toHaveValue('(607) 555-1234');
  });

  it('handles partial phone number formatting', async () => {
    render(ClientForm, { props: {} });

    const phoneInput = screen.getByLabelText(/phone/i);

    // 3 digits - no formatting yet
    await fireEvent.input(phoneInput, { target: { value: '607' } });
    expect(phoneInput).toHaveValue('607');

    // 6 digits - partial format
    await fireEvent.input(phoneInput, { target: { value: '607555' } });
    expect(phoneInput).toHaveValue('(607) 555');
  });

  it('includes phone in submission when provided', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    await fireEvent.input(screen.getByLabelText(/phone/i), {
      target: { value: '6075551234' },
    });

    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '6075551234',
      })
    );
  });

  it('includes notes in submission when provided', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    await fireEvent.input(screen.getByLabelText(/notes/i), {
      target: { value: 'I have TMJ issues' },
    });

    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'I have TMJ issues',
      })
    );
  });

  it('trims whitespace from inputs', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: '  Jane  ' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: '  Doe  ' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: '  jane@example.com  ' },
    });

    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      })
    );
  });

  it('lowercases email', async () => {
    const onSubmit = vi.fn();
    render(ClientForm, { props: { onSubmit } });

    await fireEvent.input(screen.getByLabelText(/first name/i), {
      target: { value: 'Jane' },
    });
    await fireEvent.input(screen.getByLabelText(/last name/i), {
      target: { value: 'Doe' },
    });
    await fireEvent.input(screen.getByLabelText(/email/i), {
      target: { value: 'JANE@EXAMPLE.COM' },
    });

    const form = document.querySelector('form');
    await fireEvent.submit(form!);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
      })
    );
  });

  it('shows required indicator for required fields', () => {
    render(ClientForm, { props: {} });

    // Required fields should have asterisks
    const firstNameLabel = screen.getByText(/first name/i).parentElement;
    expect(firstNameLabel?.textContent).toContain('*');

    const lastNameLabel = screen.getByText(/last name/i).parentElement;
    expect(lastNameLabel?.textContent).toContain('*');

    const emailLabel = screen.getByText(/^email/i).parentElement;
    expect(emailLabel?.textContent).toContain('*');
  });

  it('marks optional fields appropriately', () => {
    render(ClientForm, { props: {} });

    // Text is split across elements - check for "(optional)" text in span
    const optionalSpans = screen.getAllByText('(optional)');
    expect(optionalSpans.length).toBe(2); // Phone and Notes are optional
  });

  it('shows privacy notice', () => {
    render(ClientForm, { props: {} });

    expect(screen.getByText(/information is secure/i)).toBeInTheDocument();
  });
});
