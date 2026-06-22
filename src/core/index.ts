/**
 * Core module exports
 *
 * @packageDocumentation
 *
 * @module core
 *
 * @remarks
 * Exports all core classes and utilities for the PRP Pipeline.
 */

// Session management
export { SessionManager } from './session-manager.js';
export { TaskOrchestrator } from './task-orchestrator.js';
export { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
export {
  hashPRD,
  createSessionDirectory,
  writeTasksJSON,
  readTasksJSON,
  writePRP,
  snapshotPRD,
  loadSnapshot,
  SessionFileError,
} from './session-utils.js';

// Environment errors
export { EnvironmentError, isEnvironmentError } from '../utils/errors.js';

// PRD diffing utilities
export {
  diffPRDs,
  hasSignificantChanges,
  parsePRDSections,
  normalizeMarkdown,
} from './prd-differ.js';

// Task patching
export { patchBacklog } from './task-patcher.js';

// Type definitions and models
export type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
  ItemType,
  SessionState,
  SessionMetadata,
  DeltaSession,
  ValidationGate,
  SuccessCriterion,
  PRPDocument,
  PRPArtifact,
  RequirementChange,
  DeltaAnalysis,
  BugSeverity,
  Bug,
  TestResults,
} from './models.js';

// PRD diffing types
export type { PRDSection, SectionChange, DiffSummary } from './prd-differ.js';

export {
  StatusEnum,
  ItemTypeEnum,
  BacklogSchema,
  PhaseSchema,
  MilestoneSchema,
  TaskSchema,
  SubtaskSchema,
  ContextScopeSchema,
  ValidationGateSchema,
  SuccessCriterionSchema,
  PRPDocumentSchema,
  PRPArtifactSchema,
  RequirementChangeSchema,
  DeltaAnalysisSchema,
  BugSeverityEnum,
  BugSchema,
  TestResultsSchema,
} from './models.js';
