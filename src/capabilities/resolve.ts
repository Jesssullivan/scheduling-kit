/**
 * Scheduling capability resolution.
 *
 * Precedence (proven in production booking surfaces):
 *
 *   1. explicit site row    (`siteRows[site]`)
 *   2. explicit lane row    (`laneRows[lane]`)
 *   3. dynamic synthesis    (`synthesizeDynamic({ backend, environment })`)
 *
 * The resolver fails closed: unknown or missing site/lane identifiers never
 * match a row (lookups are own-property only, so inherited keys such as
 * `toString` cannot leak a row), and empty tables always fall through to the
 * adopter's explicit dynamic synthesis instead of guessing.
 */
import type {
  SchedulingCapabilityRow,
  SchedulingCapabilityRowTable,
  SchedulingRuntimeCapabilities,
  SchedulingCapabilitySource,
} from './types.js';

/** Input to the adopter-supplied dynamic synthesizer. */
export interface DynamicCapabilityInput<TBackend extends string = string> {
  /** Backend selected for the dynamic host (e.g. from an env var). */
  readonly backend: TBackend;
  /** Environment label to stamp on the synthesized row. */
  readonly environment: string;
}

/**
 * Adopter-supplied capability tables and dynamic synthesis policy.
 */
export interface SchedulingCapabilityTables<
  TBackend extends string = string,
  TBookingMode extends string = string,
  TOwner extends string = string,
> {
  /**
   * Explicit rows for stable public sites, keyed by the adopter's resolved
   * site identifier. Highest precedence.
   */
  readonly siteRows?: SchedulingCapabilityRowTable<TBackend, TBookingMode, TOwner>;
  /**
   * Explicit rows for fixed deployment lanes (e.g. k8s environments), keyed
   * by lane identifier. Checked after site rows.
   */
  readonly laneRows?: SchedulingCapabilityRowTable<TBackend, TBookingMode, TOwner>;
  /**
   * Synthesizes a row for dynamic hosts (previews, localhost) when no
   * explicit row matches. Required so that fallback policy is always a
   * deliberate adopter decision.
   */
  readonly synthesizeDynamic: (
    input: DynamicCapabilityInput<TBackend>,
  ) => SchedulingCapabilityRow<TBackend, TBookingMode, TOwner>;
}

/** Query describing the surface whose capabilities should be resolved. */
export interface SchedulingCapabilityQuery<TBackend extends string = string> {
  /** Resolved stable-site identifier, if any. */
  readonly site?: string | null;
  /** Resolved deployment-lane identifier, if any. */
  readonly lane?: string | null;
  /** Backend value used for dynamic synthesis when no explicit row matches. */
  readonly backend: TBackend;
  /** Environment label for dynamically synthesized rows. Defaults to `'unknown'`. */
  readonly dynamicEnvironment?: string;
}

const lookupRow = <
  TBackend extends string,
  TBookingMode extends string,
  TOwner extends string,
>(
  table: SchedulingCapabilityRowTable<TBackend, TBookingMode, TOwner> | undefined,
  key: string | null | undefined,
): SchedulingCapabilityRow<TBackend, TBookingMode, TOwner> | null => {
  if (!table || !key) return null;
  // Own-property lookup only: inherited keys (`toString`, `constructor`, …)
  // and absent keys fail closed to null.
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
};

const stampSource = <
  TBackend extends string,
  TBookingMode extends string,
  TOwner extends string,
>(
  row: SchedulingCapabilityRow<TBackend, TBookingMode, TOwner>,
  source: SchedulingCapabilitySource,
): SchedulingRuntimeCapabilities<TBackend, TBookingMode, TOwner> => ({
  ...row,
  source,
});

/**
 * Resolve runtime scheduling capabilities for a surface.
 *
 * Precedence: explicit site row > explicit lane row > dynamic synthesis from
 * the query's backend value. The resolver stamps `source` on the returned
 * row according to which step matched.
 *
 * @example
 * ```typescript
 * import {
 *   resolveSchedulingCapabilities,
 *   type SchedulingCapabilityRowTable,
 *   type SchedulingCapabilityRow,
 * } from '@tummycrypt/scheduling-kit/capabilities';
 *
 * type Backend = 'homegrown' | 'acuity';
 * type BookingMode = 'acuity' | 'self-service';
 * type Owner = 'homegrown' | 'scheduling-bridge' | 'acuity';
 *
 * // Adopter-owned: stable public sites.
 * const SITE_ROWS: SchedulingCapabilityRowTable<Backend, BookingMode, Owner> = {
 *   production: {
 *     environment: 'production',
 *     backend: 'acuity',
 *     publicBookingMode: 'acuity',
 *     remoteBridge: 'skipped',
 *     postgres: 'optional',
 *     cache: 'optional',
 *     localAutomation: 'forbidden',
 *     owner: 'acuity',
 *   },
 * };
 *
 * // Adopter-owned: fixed deployment lanes.
 * const LANE_ROWS: SchedulingCapabilityRowTable<Backend, BookingMode, Owner> = {
 *   'bridge-lane': {
 *     environment: 'bridge-lane',
 *     backend: 'acuity',
 *     publicBookingMode: 'self-service',
 *     remoteBridge: 'required',
 *     postgres: 'optional',
 *     cache: 'required',
 *     localAutomation: 'forbidden',
 *     owner: 'scheduling-bridge',
 *   },
 *   'native-lane': {
 *     environment: 'native-lane',
 *     backend: 'homegrown',
 *     publicBookingMode: 'self-service',
 *     remoteBridge: 'skipped',
 *     postgres: 'required',
 *     cache: 'required',
 *     localAutomation: 'forbidden',
 *     owner: 'homegrown',
 *   },
 * };
 *
 * // Adopter-owned: dynamic policy for previews/localhost.
 * const synthesizeDynamic = ({
 *   backend,
 *   environment,
 * }: {
 *   backend: Backend;
 *   environment: string;
 * }): SchedulingCapabilityRow<Backend, BookingMode, Owner> => ({
 *   environment,
 *   backend,
 *   publicBookingMode: backend === 'homegrown' ? 'self-service' : 'acuity',
 *   remoteBridge: backend === 'homegrown' ? 'skipped' : 'optional',
 *   postgres: backend === 'homegrown' ? 'required' : 'optional',
 *   cache: 'optional',
 *   localAutomation: backend === 'homegrown' ? 'forbidden' : 'allowed',
 *   owner: backend === 'homegrown' ? 'homegrown' : 'scheduling-bridge',
 * });
 *
 * const capabilities = resolveSchedulingCapabilities(
 *   { site: resolvedSite, lane: resolvedLane, backend: 'acuity' },
 *   { siteRows: SITE_ROWS, laneRows: LANE_ROWS, synthesizeDynamic },
 * );
 * ```
 */
export const resolveSchedulingCapabilities = <
  TBackend extends string = string,
  TBookingMode extends string = string,
  TOwner extends string = string,
>(
  query: SchedulingCapabilityQuery<TBackend>,
  tables: SchedulingCapabilityTables<TBackend, TBookingMode, TOwner>,
): SchedulingRuntimeCapabilities<TBackend, TBookingMode, TOwner> => {
  const siteRow = lookupRow(tables.siteRows, query.site);
  if (siteRow) return stampSource(siteRow, 'site');

  const laneRow = lookupRow(tables.laneRows, query.lane);
  if (laneRow) return stampSource(laneRow, 'lane');

  return stampSource(
    tables.synthesizeDynamic({
      backend: query.backend,
      environment: query.dynamicEnvironment ?? 'unknown',
    }),
    'dynamic',
  );
};
