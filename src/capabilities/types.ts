/**
 * Scheduling runtime capability contract.
 *
 * Generic types describing what a deployed scheduling surface is allowed and
 * required to do at runtime: which backend owns booking truth, how the public
 * booking flow is served, and which infrastructure dependencies are required,
 * optional, or skipped.
 *
 * The kit owns the *shape* of the contract and the resolution precedence.
 * Adopting applications own the row tables (their site names, lane names, and
 * environment policy) — no application constants live here.
 */

/**
 * How a capability row was resolved.
 *
 * - `site`: matched an explicit row for a stable public site
 * - `lane`: matched an explicit row for a fixed deployment lane (e.g. a k8s
 *   environment)
 * - `dynamic`: synthesized from a backend value for dynamic hosts (previews,
 *   localhost)
 */
export type SchedulingCapabilitySource = 'site' | 'lane' | 'dynamic';

/** Whether a runtime dependency must be present for the surface to be healthy. */
export type RuntimeRequirement = 'required' | 'optional' | 'skipped';

/** Whether the surface may run local booking-provider automation itself. */
export type LocalAutomationPolicy = 'allowed' | 'forbidden';

/**
 * Resolved runtime capabilities for a scheduling surface.
 *
 * Type parameters let adopters narrow the open string fields to their own
 * unions (e.g. `SchedulingRuntimeCapabilities<'homegrown' | 'acuity'>`)
 * without the kit hardcoding application vocabulary.
 *
 * @typeParam TBackend - scheduling backend identifiers used by the adopter
 * @typeParam TBookingMode - public booking mode identifiers (e.g. a hosted
 *   provider flow vs. `self-service`)
 * @typeParam TOwner - which component owns booking automation for the row
 */
export interface SchedulingRuntimeCapabilities<
  TBackend extends string = string,
  TBookingMode extends string = string,
  TOwner extends string = string,
> {
  /** How this row was resolved (stamped by the resolver, not by row tables). */
  readonly source: SchedulingCapabilitySource;
  /** Environment identifier the row describes (site name, lane name, or dynamic label). */
  readonly environment: string;
  /** Scheduling backend that owns booking truth for this surface. */
  readonly backend: TBackend;
  /** How the public booking flow is served. */
  readonly publicBookingMode: TBookingMode;
  /** Whether a remote scheduling bridge service is required at runtime. */
  readonly remoteBridge: RuntimeRequirement;
  /** Whether a direct PostgreSQL connection is required at runtime. */
  readonly postgres: RuntimeRequirement;
  /** Whether an app-side schedule cache (e.g. Redis) is required at runtime. */
  readonly cache: RuntimeRequirement;
  /** Whether this surface may run local booking-provider automation. */
  readonly localAutomation: LocalAutomationPolicy;
  /** Component that owns booking automation for this surface. */
  readonly owner: TOwner;
}

/**
 * A capability row as supplied by an adopter. Identical to
 * {@link SchedulingRuntimeCapabilities} minus `source`, which the resolver
 * stamps based on which table (or synthesis) produced the row. This prevents
 * a site row from claiming it was lane- or dynamically-resolved.
 */
export type SchedulingCapabilityRow<
  TBackend extends string = string,
  TBookingMode extends string = string,
  TOwner extends string = string,
> = Omit<SchedulingRuntimeCapabilities<TBackend, TBookingMode, TOwner>, 'source'>;

/**
 * Adopter-owned table of capability rows keyed by site or lane identifier.
 */
export type SchedulingCapabilityRowTable<
  TBackend extends string = string,
  TBookingMode extends string = string,
  TOwner extends string = string,
> = Readonly<Record<string, SchedulingCapabilityRow<TBackend, TBookingMode, TOwner>>>;
