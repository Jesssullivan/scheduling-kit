/**
 * @tummycrypt/scheduling-kit/fuzzy
 *
 * Backend-agnostic tolerant matching primitives for adapter implementations.
 * The scorer cascade is pure and journalable: every admitted fuzzy-in match
 * carries confidence, strategy, threshold, matched label, and runner-up data.
 */

export {
	FUZZY_THRESHOLD,
	FuzzyMatchError,
	ServiceMatcher,
	ServiceMatcherLive,
	TOKEN_THRESHOLD,
	fuzzyConfidence,
	levenshtein,
	makeServiceMatcher,
	normalize,
	scoreLabel,
	tokenOverlap,
	type FuzzyMatcher,
	type FuzzyResolution,
	type FuzzyStrategy,
	type ServiceCandidate,
	type ServiceMatchQuery,
} from './fuzzy.js';

export {
	DEFAULT_DATE_MIN_CONFIDENCE,
	DateMatcher,
	DateMatcherLive,
	MONTH_NAMES,
	makeDateMatcher,
	matchSlotMembership,
	parseMonthLabel,
	parseYearMonthKey,
	scoreMonthTarget,
	scoreSlot,
	stripTzSuffix,
	type CalendarMonth,
	type DateMatchQuery,
	type SlotCandidate,
} from './date-matcher.js';

export {
	DEFAULT_DEFERRED_VALUE,
	DEFAULT_FIELD_RULES,
	FieldMatcher,
	FieldMatcherLive,
	makeFieldMatcher,
	resolveFieldAnswer,
	scoreFieldRule,
	type FieldMatchQuery,
	type FieldRule,
} from './field-matcher.js';
