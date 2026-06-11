/**
 * AcuityEmbedHandoff Component Tests
 *
 * Focus: the component ships with NO branded support-contact defaults — the
 * help text renders only when the consumer passes supportPhone and/or
 * supportEmail (TIN-1995 de-branding).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AcuityEmbedHandoff from '../../src/components/AcuityEmbedHandoff.svelte';

const baseUrl = 'https://examplestudio.as.me';

describe('AcuityEmbedHandoff Component', () => {
  it('renders the booking iframe against the configured base URL', () => {
    const { container } = render(AcuityEmbedHandoff, { props: { baseUrl } });

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toContain('examplestudio.as.me');
  });

  describe('de-branding (no support-contact defaults)', () => {
    it('renders no help text when no support contact props are provided', () => {
      const { container } = render(AcuityEmbedHandoff, { props: { baseUrl } });

      expect(container.querySelector('.help-text')).toBeNull();
      expect(screen.queryByText(/Having trouble\?/)).not.toBeInTheDocument();
    });

    it('contains no branded contact details when props are omitted', () => {
      const { container } = render(AcuityEmbedHandoff, { props: { baseUrl } });

      expect(container.innerHTML).not.toContain('massageithaca');
      expect(container.innerHTML).not.toContain('6072014926');
    });
  });

  describe('consumer-provided support contacts', () => {
    it('renders phone and email links when both are provided', () => {
      render(AcuityEmbedHandoff, {
        props: {
          baseUrl,
          supportPhone: '+15555550123',
          supportEmail: 'support@example.com',
        },
      });

      expect(screen.getByText('Call us').closest('a')).toHaveAttribute(
        'href',
        'tel:+15555550123',
      );
      expect(screen.getByText('send an email').closest('a')).toHaveAttribute(
        'href',
        'mailto:support@example.com',
      );
    });

    it('renders only the phone link when just supportPhone is provided', () => {
      render(AcuityEmbedHandoff, {
        props: { baseUrl, supportPhone: '+15555550123' },
      });

      expect(screen.getByText('Call us')).toBeInTheDocument();
      expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
    });

    it('renders only the email link when just supportEmail is provided', () => {
      render(AcuityEmbedHandoff, {
        props: { baseUrl, supportEmail: 'support@example.com' },
      });

      expect(screen.getByText('Send an email').closest('a')).toHaveAttribute(
        'href',
        'mailto:support@example.com',
      );
      expect(screen.queryByText('Call us')).not.toBeInTheDocument();
    });
  });
});
