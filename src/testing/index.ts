/**
 * Testing Utilities Index
 * Public API for recording and replaying API interactions
 */

// Cassette format and utilities
export {
  type Cassette,
  type CassetteEntry,
  type CassetteRequest,
  type CassetteResponse,
  type CassetteDiff,
  type MatchOptions,
  createCassette,
  createEntry,
  addEntry,
  serializeCassette,
  parseCassette,
  findMatchingEntry,
  diffCassettes,
  hasBreakingChanges,
} from './cassette.js';

// Masking utilities
export {
  type MaskingConfig,
  defaultMaskingConfig,
  maskString,
  maskObject,
  maskHeaders,
  maskUrl,
  maskJsonBody,
  maskRequest,
  maskResponse,
  maskEntry,
  createMaskingConfig,
  acuityMaskingConfig,
  paypalMaskingConfig,
} from './masking.js';

// Recorder
export {
  type RecorderMode,
  type RecorderConfig,
  APIRecorder,
  createAcuityRecorder,
  createPayPalRecorder,
  createSchedulingRecorder,
  withRecording,
  withReplay,
} from './recorder.js';

// Player and storage
export {
  type CassetteStorage,
  type PlayerConfig,
  FileCassetteStorage,
  MemoryCassetteStorage,
  CassettePlayer,
  validateCassette,
  refreshCassette,
  createDefaultStorage,
  isCassetteStale,
  mergeCassettes,
} from './player.js';
