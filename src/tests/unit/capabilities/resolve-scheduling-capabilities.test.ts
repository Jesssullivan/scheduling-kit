/**
 * Tests for the generic scheduling capability resolver.
 *
 * Precedence under test: explicit site row > explicit lane row > dynamic
 * synthesis. Row tables are adopter-supplied; the kit only owns the contract
 * shape and the resolution order. Tables here are deliberately generic —
 * no application site or lane names.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSchedulingCapabilities,
  type DynamicCapabilityInput,
  type SchedulingCapabilityRow,
  type SchedulingCapabilityRowTable,
} from '../../../capabilities/index.js';

type Backend = 'homegrown' | 'acuity';
type BookingMode = 'hosted' | 'self-service';
type Owner = 'app' | 'bridge' | 'provider';

type Row = SchedulingCapabilityRow<Backend, BookingMode, Owner>;
type Table = SchedulingCapabilityRowTable<Backend, BookingMode, Owner>;

const SITE_ROWS: Table = {
  'public-prod': {
    environment: 'public-prod',
    backend: 'acuity',
    publicBookingMode: 'hosted',
    remoteBridge: 'skipped',
    postgres: 'optional',
    cache: 'optional',
    localAutomation: 'forbidden',
    owner: 'provider',
  },
  'public-staging': {
    environment: 'public-staging',
    backend: 'homegrown',
    publicBookingMode: 'self-service',
    remoteBridge: 'skipped',
    postgres: 'required',
    cache: 'optional',
    localAutomation: 'forbidden',
    owner: 'app',
  },
};

const LANE_ROWS: Table = {
  'bridge-lane': {
    environment: 'bridge-lane',
    backend: 'acuity',
    publicBookingMode: 'self-service',
    remoteBridge: 'required',
    postgres: 'optional',
    cache: 'required',
    localAutomation: 'forbidden',
    owner: 'bridge',
  },
  'native-lane': {
    environment: 'native-lane',
    backend: 'homegrown',
    publicBookingMode: 'self-service',
    remoteBridge: 'skipped',
    postgres: 'required',
    cache: 'required',
    localAutomation: 'forbidden',
    owner: 'app',
  },
};

const synthesizeDynamic = ({ backend, environment }: DynamicCapabilityInput<Backend>): Row => ({
  environment,
  backend,
  publicBookingMode: backend === 'homegrown' ? 'self-service' : 'hosted',
  remoteBridge: backend === 'homegrown' ? 'skipped' : 'optional',
  postgres: backend === 'homegrown' ? 'required' : 'optional',
  cache: 'optional',
  localAutomation: backend === 'homegrown' ? 'forbidden' : 'allowed',
  owner: backend === 'homegrown' ? 'app' : 'bridge',
});

const TABLES = { siteRows: SITE_ROWS, laneRows: LANE_ROWS, synthesizeDynamic };

describe('resolveSchedulingCapabilities', () => {
  describe('precedence', () => {
    it('resolves an explicit site row first and stamps source=site', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'public-prod', lane: 'bridge-lane', backend: 'homegrown' },
        TABLES,
      );
      expect(caps.source).toBe('site');
      expect(caps.environment).toBe('public-prod');
      expect(caps.backend).toBe('acuity');
      expect(caps.owner).toBe('provider');
    });

    it('site row wins even when the query backend disagrees (no env-var drift)', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'public-prod', lane: null, backend: 'homegrown' },
        TABLES,
      );
      // The shared backend value must not flip a stable site's policy.
      expect(caps.backend).toBe('acuity');
      expect(caps.publicBookingMode).toBe('hosted');
    });

    it('falls back to the lane row when no site matches and stamps source=lane', () => {
      const caps = resolveSchedulingCapabilities(
        { site: null, lane: 'bridge-lane', backend: 'homegrown' },
        TABLES,
      );
      expect(caps.source).toBe('lane');
      expect(caps.environment).toBe('bridge-lane');
      expect(caps.remoteBridge).toBe('required');
      expect(caps.owner).toBe('bridge');
    });

    it('synthesizes dynamically when neither site nor lane matches', () => {
      const caps = resolveSchedulingCapabilities(
        { site: null, lane: null, backend: 'homegrown' },
        TABLES,
      );
      expect(caps.source).toBe('dynamic');
      expect(caps.backend).toBe('homegrown');
      expect(caps.publicBookingMode).toBe('self-service');
      expect(caps.postgres).toBe('required');
      expect(caps.localAutomation).toBe('forbidden');
    });

    it('synthesizes provider-backed capabilities for non-homegrown dynamic hosts', () => {
      const caps = resolveSchedulingCapabilities(
        { site: null, lane: null, backend: 'acuity' },
        TABLES,
      );
      expect(caps.source).toBe('dynamic');
      expect(caps.remoteBridge).toBe('optional');
      expect(caps.localAutomation).toBe('allowed');
      expect(caps.owner).toBe('bridge');
    });
  });

  describe('dynamic environment label', () => {
    it('defaults the dynamic environment to "unknown"', () => {
      const caps = resolveSchedulingCapabilities(
        { site: null, lane: null, backend: 'acuity' },
        TABLES,
      );
      expect(caps.environment).toBe('unknown');
    });

    it('passes dynamicEnvironment through to the synthesizer', () => {
      const caps = resolveSchedulingCapabilities(
        { site: null, lane: null, backend: 'acuity', dynamicEnvironment: 'preview-42' },
        TABLES,
      );
      expect(caps.environment).toBe('preview-42');
    });
  });

  describe('fail-closed behavior', () => {
    it('unknown site and lane identifiers never match a row', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'no-such-site', lane: 'no-such-lane', backend: 'acuity' },
        TABLES,
      );
      expect(caps.source).toBe('dynamic');
    });

    it('empty row tables fall through to dynamic synthesis', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'public-prod', lane: 'bridge-lane', backend: 'homegrown' },
        { siteRows: {}, laneRows: {}, synthesizeDynamic },
      );
      expect(caps.source).toBe('dynamic');
      expect(caps.backend).toBe('homegrown');
    });

    it('omitted row tables fall through to dynamic synthesis', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'public-prod', lane: 'bridge-lane', backend: 'acuity' },
        { synthesizeDynamic },
      );
      expect(caps.source).toBe('dynamic');
    });

    it('inherited object keys do not leak rows (own-property lookup only)', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'toString', lane: 'constructor', backend: 'acuity' },
        TABLES,
      );
      expect(caps.source).toBe('dynamic');
    });

    it('empty-string identifiers do not match rows', () => {
      const caps = resolveSchedulingCapabilities(
        { site: '', lane: '', backend: 'acuity' },
        TABLES,
      );
      expect(caps.source).toBe('dynamic');
    });
  });

  describe('source stamping', () => {
    it('stamps source from the resolver, returning a new object', () => {
      const caps = resolveSchedulingCapabilities(
        { site: 'public-staging', lane: null, backend: 'acuity' },
        TABLES,
      );
      expect(caps.source).toBe('site');
      // Resolution must not mutate the adopter's row table.
      expect(SITE_ROWS['public-staging']).not.toHaveProperty('source');
      expect(caps).not.toBe(SITE_ROWS['public-staging']);
    });
  });
});
