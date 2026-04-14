import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('HybridCheckoutDrawer Capabilities Contract', () => {
  const componentPath = resolve(import.meta.dirname, '../components/HybridCheckoutDrawer.svelte');
  const content = readFileSync(componentPath, 'utf8');

  it('should accept capabilities prop', () => {
    expect(content).toContain('capabilities');
  });

  it('should NOT accept legacy paypalClientId prop', () => {
    const propsMatch = content.match(/let\s*\{[^}]*\}\s*[=:]\s*\$props/s);
    if (propsMatch) {
      expect(propsMatch[0]).not.toContain('paypalClientId');
    }
  });

  it('should NOT accept legacy stripePublishableKey prop', () => {
    const propsMatch = content.match(/let\s*\{[^}]*\}\s*[=:]\s*\$props/s);
    if (propsMatch) {
      expect(propsMatch[0]).not.toContain('stripePublishableKey');
    }
  });

  it('should NOT have Cash at Visit in payment options', () => {
    expect(content).not.toMatch(/id:\s*['"]cash['"]/);
  });

  it('should import PaymentCapabilities type', () => {
    expect(content).toContain('PaymentCapabilities');
  });

  it('should derive payment options from capabilities.methods', () => {
    expect(content).toContain('capabilities.methods');
  });
});
