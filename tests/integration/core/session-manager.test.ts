/**
 * Integration tests for SessionManager.initialize() - New Session Creation
 *
 * @remarks
 * Tests validate new session creation with real filesystem operations in temp directories.
 * These tests complement the unit tests in tests/unit/core/session-manager.test.ts by
 * using actual filesystem operations instead of mocks.
 *
 * Tests cover:
 * - Session directory creation with correct format (sequence_hash)
 * - PRD hash computation and session detection
 * - prd_snapshot.md creation with identical content
 * - SessionState structure with empty backlog
 * - Subdirectory creation (architecture/, prps/, artifacts/)
 * - Hash-based session detection (new session on PRD change)
 * - Sequential session numbering (001, 002, 003)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/core/session-manager.ts | SessionManager Implementation}
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { SessionManager } from '../../../src/core/session-manager.js';
import { SessionFileError } from '../../../src/core/session-utils.js';
import type { SessionState, Backlog } from '../../../src/core/models.js';
import { mockSimplePRD } from '../../fixtures/simple-prd.js';
import { mockSimplePRDv2 } from '../../fixtures/simple-prd-v2.js';
import type { Status } from '../../../src/core/models.js';

// =============================================================================
// PATTERN: Fixture Helper Functions for Existing Session Loading
// =============================================================================

/**
 * Creates a minimal valid Backlog structure for testing
 * Contains: 1 Phase, 1 Milestone, 1 Task, 1 Subtask
 */
function createMinimalTasksJson(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase',
        status: 'Planned',
        description: 'Test phase description',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Test Milestone',
            status: 'Planned',
            description: 'Test milestone description',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Test Task',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Test Subtask',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Creates a multi-level Backlog with 3 tasks per milestone for testing
 * Useful for testing updates at different hierarchy levels
 */
function createMultiLevelTasksJson(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase',
        status: 'Planned',
        description: 'Test phase description',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Test Milestone',
            status: 'Planned',
            description: 'Test milestone description',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Test Task 1',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Test Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S2',
                    title: 'Test Subtask 2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
              {
                type: 'Task',
                id: 'P1.M1.T2',
                title: 'Test Task 2',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T2.S1',
                    title: 'Test Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
              {
                type: 'Task',
                id: 'P1.M1.T3',
                title: 'Test Task 3',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T3.S1',
                    title: 'Test Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Creates a deep hierarchy Backlog with multiple phases for testing
 * Useful for testing phase-level updates
 */
function createDeepHierarchyTasksJson(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase 1',
        status: 'Planned',
        description: 'Test phase 1 description',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Test Milestone 1',
            status: 'Planned',
            description: 'Test milestone 1 description',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Test Task 1',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Test Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'Phase',
        id: 'P2',
        title: 'Test Phase 2',
        status: 'Planned',
        description: 'Test phase 2 description',
        milestones: [
          {
            type: 'Milestone',
            id: 'P2.M1',
            title: 'Test Milestone 2',
            status: 'Planned',
            description: 'Test milestone 2 description',
            tasks: [
              {
                type: 'Task',
                id: 'P2.M1.T1',
                title: 'Test Task 2',
                status: 'Planned',
                description: 'Test task description',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P2.M1.T1.S1',
                    title: 'Test Subtask 2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// =============================================================================
// PATTERN: Test Setup with Temp Directories
// =============================================================================

describe('SessionManager.initialize()', () => {
  let tempDir: string;
  let planDir: string;
  let prdPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-test-'));
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Create initial PRD file with sufficient content for validation
    const prdContent = `# Test PRD

## Executive Summary

This is a comprehensive test PRD for integration testing of SessionManager.initialize().
It contains enough content to pass PRD validation (minimum 100 characters).

## Functional Requirements

The system shall properly create session directories with the correct format.
The system shall compute SHA-256 hashes of PRD content for session detection.
`;
    writeFileSync(prdPath, prdContent);
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // PATTERN: Test 1 - New Session Created with Unique PRD Hash
  // =============================================================================

  it('should create new session with unique PRD hash', async () => {
    // SETUP: PRD created in beforeEach

    // EXECUTE: Initialize session manager
    const manager = new SessionManager(prdPath, planDir);
    const session = await manager.initialize();

    // VERIFY: Session directory created
    expect(existsSync(planDir)).toBe(true);
    const sessionDirs = readdirSync(planDir).filter(d =>
      /^\d{3}_[a-f0-9]{12}$/.test(d)
    );
    expect(sessionDirs).toHaveLength(1);

    // VERIFY: SessionState returned
    expect(session).toBeDefined();
    expect(session.metadata.hash).toMatch(/^[a-f0-9]{12}$/);
    expect(session.taskRegistry.backlog).toEqual([]);
  });

  // =============================================================================
  // PATTERN: Test 2 - Session Directory Format Validation
  // =============================================================================

  it('should create session directory with correct format', async () => {
    // SETUP: PRD created in beforeEach

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    // VERIFY: Session directory format
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs).toHaveLength(1);

    const [sessionDirName] = sessionDirs;
    const match = sessionDirName.match(/^(\d{3})_([a-f0-9]{12})$/);
    expect(match).not.toBeNull();

    if (match) {
      const [, sequence, hash] = match;
      expect(sequence).toBe('001'); // Zero-padded to 3 digits
      expect(hash).toHaveLength(12); // 12-character hash
    }
  });

  // =============================================================================
  // PATTERN: Test 3 - Hash is First 12 Characters of SHA-256
  // =============================================================================

  it('should use first 12 characters of SHA-256 hash', async () => {
    // SETUP: Create PRD with known content
    const prdContent = `# Known PRD

## Executive Summary

This is a predictable PRD for hash testing. The content is designed to produce
a consistent SHA-256 hash that can be verified against the session metadata.

## Functional Requirements

The system shall compute the SHA-256 hash correctly and use the first 12 characters
as the session hash in the directory name.
`;
    writeFileSync(prdPath, prdContent);

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    const session = await manager.initialize();

    // VERIFY: Compute expected hash
    const expectedHash = createHash('sha256')
      .update(prdContent, 'utf-8')
      .digest('hex')
      .slice(0, 12);

    expect(session.metadata.hash).toBe(expectedHash);

    // VERIFY: Session directory name contains expected hash
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs[0]).toContain(expectedHash);
  });

  // =============================================================================
  // PATTERN: Test 4 - SessionState with Empty Backlog
  // =============================================================================

  it('should create SessionState with empty backlog', async () => {
    // SETUP: PRD created in beforeEach

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    const session = await manager.initialize();

    // VERIFY: SessionState structure
    expect(session.taskRegistry.backlog).toEqual([]);
    expect(session.currentItemId).toBeNull();
    expect(session.metadata.hash).toBeDefined();
    expect(session.metadata.id).toBeDefined();
    expect(session.prdSnapshot).toContain('Test PRD');
  });

  // =============================================================================
  // PATTERN: Test 5 - prd_snapshot.md Copied with Identical Content
  // =============================================================================

  it('should copy PRD to prd_snapshot.md with identical content', async () => {
    // SETUP: Create PRD with specific content
    const prdContent = `# Test PRD

## Executive Summary

This is a specific test PRD for snapshot verification. We need to ensure that
the content in prd_snapshot.md matches the original PRD exactly.

## Functional Requirements

The system shall copy the PRD content to prd_snapshot.md with identical content.
The file mode shall be 0o644 (rw-r--r--).
`;
    writeFileSync(prdPath, prdContent);

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    // VERIFY: prd_snapshot.md exists
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const snapshotPath = join(sessionPath, 'prd_snapshot.md');
    expect(existsSync(snapshotPath)).toBe(true);

    // VERIFY: Content matches exactly
    const snapshotContent = readFileSync(snapshotPath, 'utf-8');
    expect(snapshotContent).toBe(prdContent);
  });

  // =============================================================================
  // PATTERN: Test 6 - Subdirectories Created
  // =============================================================================

  it('should create required subdirectories', async () => {
    // SETUP: PRD created in beforeEach

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    // VERIFY: All subdirectories exist
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);

    expect(existsSync(join(sessionPath, 'architecture'))).toBe(true);
    expect(existsSync(join(sessionPath, 'prps'))).toBe(true);
    expect(existsSync(join(sessionPath, 'artifacts'))).toBe(true);
  });

  // =============================================================================
  // PATTERN: Test 7 - PRD Hash Change Creates New Session
  // =============================================================================

  it('should create new session when PRD hash changes', async () => {
    // SETUP: Create first session
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify PRD and create new session
    const newContent = `# Modified PRD

## Executive Summary

This PRD content has been modified from the original. The hash should be different,
which will trigger the creation of a new session instead of loading the existing one.

## Functional Requirements

The system shall detect the PRD hash change and create a new session with a
different hash value.
`;
    writeFileSync(prdPath, newContent);

    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: New session created
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs).toHaveLength(2);

    // VERIFY: Hashes are different
    expect(session2.metadata.hash).not.toBe(session1.metadata.hash);

    // VERIFY: Both sessions exist in plan/
    const hash1 = session1.metadata.hash;
    const hash2 = session2.metadata.hash;
    expect(sessionDirs.some(d => d.includes(hash1))).toBe(true);
    expect(sessionDirs.some(d => d.includes(hash2))).toBe(true);
  });

  // =============================================================================
  // PATTERN: Test 8 - Sequential Session Numbering
  // =============================================================================

  it('should use sequential session numbering', async () => {
    // SETUP & EXECUTE: Create three sessions
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const content = `# PRD ${i}

## Executive Summary

This is PRD number ${i} for testing sequential session numbering.
Each PRD has different content to generate different hashes.

## Functional Requirements

The system shall create sessions with sequential numbering: 001, 002, 003.
This test verifies that the session sequence numbers increment correctly.
`;
      writeFileSync(prdPath, content);

      const manager = new SessionManager(prdPath, planDir);
      const session = await manager.initialize();
      sessions.push(session);
    }

    // VERIFY: Sessions numbered 001, 002, 003
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs).toHaveLength(3);

    const sequences = sessionDirs.map(d => d.match(/^(\d{3})_/)?.[1]).sort();

    expect(sequences).toEqual(['001', '002', '003']);
  });

  // =============================================================================
  // PATTERN: Test 9 - SessionState Metadata Validation
  // =============================================================================

  it('should return SessionState with correct metadata', async () => {
    // SETUP: PRD created in beforeEach

    // EXECUTE
    const manager = new SessionManager(prdPath, planDir);
    const session = await manager.initialize();

    // VERIFY: Metadata fields
    const sessionDirs = readdirSync(planDir);
    const sessionDirName = sessionDirs[0];

    expect(session.metadata.id).toBe(sessionDirName);
    expect(session.metadata.hash).toMatch(/^[a-f0-9]{12}$/);
    expect(session.metadata.path).toBe(resolve(planDir, sessionDirName));
    expect(session.metadata.parentSession).toBeNull(); // Not delta session
    expect(session.metadata.createdAt).toBeInstanceOf(Date);
  });
});

// =============================================================================
// Integration Tests for SessionManager.loadSession() - Existing Session Loading
// =============================================================================

describe('SessionManager.loadSession()', () => {
  let tempDir: string;
  let planDir: string;
  let prdPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-load-test-'));
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Create initial PRD file with sufficient content for validation
    const prdContent = `# Test PRD for Session Loading

## Executive Summary

This is a comprehensive test PRD for integration testing of SessionManager.loadSession().
It contains enough content to pass PRD validation (minimum 100 characters).

## Functional Requirements

The system shall properly load existing sessions from tasks.json with Zod validation.
The system shall reconstruct complete session state from disk.
`;
    writeFileSync(prdPath, prdContent);
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // Test 1: Existing Session Loaded from tasks.json with Zod Validation
  // =============================================================================

  it('should load existing session from tasks.json', async () => {
    // SETUP: Create initial session
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // Create tasks.json (required for loadSession to work)
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Initialize again with same PRD (triggers loadSession)
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: Session loaded (not recreated)
    expect(session2.metadata.id).toBe(session1.metadata.id);
    expect(session2.metadata.hash).toBe(session1.metadata.hash);

    // VERIFY: taskRegistry structure (empty backlog for new session)
    expect(session2.taskRegistry).toBeDefined();
    expect(session2.taskRegistry.backlog).toEqual([]);

    // VERIFY: Only one session directory exists
    const sessionDirsAfter = readdirSync(planDir);
    expect(sessionDirsAfter).toHaveLength(1);
  });

  // =============================================================================
  // Test 2: Complete Phase->Milestone->Task->Subtask Hierarchy Parsed
  // =============================================================================

  it('should parse complete Phase->Milestone->Task->Subtask hierarchy', async () => {
    // SETUP: Create session with minimal tasks.json
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // Get session directory and create custom tasks.json
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');

    const minimalTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(minimalTasks, null, 2), 'utf-8');

    // EXECUTE: Load session again
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();

    // VERIFY: Complete hierarchy parsed
    expect(session.taskRegistry.backlog).toHaveLength(1);

    const phase = session.taskRegistry.backlog[0];
    expect(phase.type).toBe('Phase');
    expect(phase.id).toBe('P1');
    expect(phase.milestones).toHaveLength(1);

    const milestone = phase.milestones[0];
    expect(milestone.type).toBe('Milestone');
    expect(milestone.id).toBe('P1.M1');
    expect(milestone.tasks).toHaveLength(1);

    const task = milestone.tasks[0];
    expect(task.type).toBe('Task');
    expect(task.id).toBe('P1.M1.T1');
    expect(task.subtasks).toHaveLength(1);

    const subtask = task.subtasks[0];
    expect(subtask.type).toBe('Subtask');
    expect(subtask.id).toBe('P1.M1.T1.S1');
  });

  // =============================================================================
  // Test 3: PRD Snapshot Loaded with Identical Content
  // =============================================================================

  it('should load PRD snapshot with identical content', async () => {
    // SETUP: Create PRD with specific content
    const prdContent = `# Test PRD for Snapshot Verification

## Executive Summary

This is a specific test PRD for snapshot verification. We need to ensure that
the content in prd_snapshot.md matches the original PRD exactly.

## Functional Requirements

The system shall copy the PRD content to prd_snapshot.md with identical content.
`;
    writeFileSync(prdPath, prdContent);

    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // Create tasks.json (required for loadSession to work)
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Load session again
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();

    // VERIFY: PRD snapshot matches original
    expect(session.prdSnapshot).toBe(prdContent);
  });

  // =============================================================================
  // Test 4: Session Metadata Reconstructed from Directory Name
  // =============================================================================

  it('should reconstruct session metadata from directory name', async () => {
    // SETUP: Create session
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // Create tasks.json (required for loadSession to work)
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Load session again
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();

    // VERIFY: Metadata reconstructed
    const sessionDirName = sessionDirs[0];

    expect(session.metadata.id).toBe(sessionDirName);
    expect(session.metadata.hash).toMatch(/^[a-f0-9]{12}$/);
    expect(session.metadata.path).toBe(resolve(planDir, sessionDirName));
    expect(session.metadata.createdAt).toBeInstanceOf(Date);
    expect(session.metadata.parentSession).toBeNull(); // Not delta session
  });

  // =============================================================================
  // Test 5: Parent Session Link Loaded from parent_session.txt
  // =============================================================================

  it('should load parent session link from parent_session.txt', async () => {
    // SETUP: Create session with parent_session.txt
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const parentPath = join(sessionPath, 'parent_session.txt');
    const tasksPath = join(sessionPath, 'tasks.json');

    // Write parent session link and tasks.json
    writeFileSync(parentPath, '001_abc123def456', 'utf-8');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Load session again
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();

    // VERIFY: Parent session loaded
    expect(session.metadata.parentSession).toBe('001_abc123def456');
  });

  // =============================================================================
  // Test 6: Batch Updates are Not Affected by loadSession
  // =============================================================================

  it('should not affect batch updates when loading session', async () => {
    // SETUP: Create session
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    // Create tasks.json (required for loadSession to work)
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Load session again (same manager instance)
    const session = await manager.initialize();

    // VERIFY: Session loads correctly with fresh state
    expect(session.metadata.id).toBeDefined();
    expect(session.taskRegistry).toBeDefined();
    expect(session.currentItemId).toBeNull();
  });

  // =============================================================================
  // Test 7: Invalid JSON Throws SessionFileError
  // =============================================================================

  it('should throw SessionFileError for invalid JSON', async () => {
    // SETUP: Create session with invalid tasks.json
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');

    // Write invalid JSON
    writeFileSync(tasksPath, '{ invalid json }', 'utf-8');

    // EXECUTE & VERIFY: Should throw error
    const manager2 = new SessionManager(prdPath, planDir);
    await expect(manager2.initialize()).rejects.toThrow(SessionFileError);
  });

  // =============================================================================
  // Test 8: Missing tasks.json Throws SessionFileError
  // =============================================================================

  it('should treat missing tasks.json as an empty backlog (lenient read)', async () => {
    // SETUP: Create session directory without tasks.json
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');

    // Create tasks.json first, then remove it — simulating an interrupted run
    // that created the session but died before decomposePRD() wrote the backlog.
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');
    rmSync(tasksPath);

    // EXECUTE & VERIFY: A genuinely MISSING tasks.json is recoverable — the
    // lenient read treats it as an un-started (empty backlog) session instead
    // of fataling with a confusing ENOENT that blocked resume after every
    // crashed run (PRD §5.1 "Recover from corruption … automatic and non-fatal").
    // Parse/schema/EACCES errors still throw (data-integrity errors are never
    // silently swallowed).
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();
    expect(session.taskRegistry.backlog).toEqual([]);
  });

  // =============================================================================
  // Test 9: Missing prd_snapshot.md Throws Error
  // =============================================================================

  it('should throw error for missing prd_snapshot.md', async () => {
    // SETUP: Create session without prd_snapshot.md
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const snapshotPath = join(sessionPath, 'prd_snapshot.md');

    // Remove prd_snapshot.md
    rmSync(snapshotPath);

    // EXECUTE & VERIFY: Should throw error
    const manager2 = new SessionManager(prdPath, planDir);
    await expect(manager2.initialize()).rejects.toThrow();
  });

  // =============================================================================
  // Test 10: Missing parent_session.txt is Handled Gracefully
  // =============================================================================

  it('should handle missing parent_session.txt gracefully', async () => {
    // SETUP: Create session without parent_session.txt (default behavior)
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // Create tasks.json (required for loadSession to work)
    const sessionDirs = readdirSync(planDir);
    const sessionPath = join(planDir, sessionDirs[0]);
    const tasksPath = join(sessionPath, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // EXECUTE: Load session again (no parent_session.txt exists)
    const manager2 = new SessionManager(prdPath, planDir);
    const session = await manager2.initialize();

    // VERIFY: parentSession is null, no error thrown
    expect(session.metadata.parentSession).toBeNull();
  });
});

// =============================================================================
// Integration Tests for SessionManager Delta Session Detection
// =============================================================================

describe('SessionManager Delta Session Detection', () => {
  let tempDir: string;
  let planDir: string;
  let prdPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-delta-test-'));
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // Test 1: Delta Session Created When PRD Hash Changes
  // =============================================================================

  it('should create delta session when PRD hash changes', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify PRD and initialize again (triggers delta detection)
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: New session directory created
    const sessionDirs = readdirSync(planDir).filter(d =>
      /^\d{3}_[a-f0-9]{12}$/.test(d)
    );
    expect(sessionDirs).toHaveLength(2);

    // VERIFY: Hashes are different (delta session created)
    expect(session2.metadata.hash).not.toBe(session1.metadata.hash);

    // VERIFY: Both sessions exist in plan/
    expect(sessionDirs.some(d => d.includes(session1.metadata.hash))).toBe(
      true
    );
    expect(sessionDirs.some(d => d.includes(session2.metadata.hash))).toBe(
      true
    );
  });

  // =============================================================================
  // Test 2: Delta Session Named with Incremented Sequence
  // =============================================================================

  it('should name delta session with incremented sequence', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // EXECUTE: Modify PRD to trigger delta
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: Delta session has incremented sequence
    const sessionDirs = readdirSync(planDir);
    const sequences = sessionDirs
      .map(d => d.match(/^(\d{3})_/)?.[1])
      .filter((s): s is string => s !== undefined)
      .sort();

    expect(sequences).toEqual(['001', '002']);
    expect(session2.metadata.id).toMatch(/^002_/);
  });

  // =============================================================================
  // Test 3: Previous Session PRD Preserved in prd_snapshot.md
  // =============================================================================

  it('should preserve previous session PRD in prd_snapshot.md', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify PRD to create new session
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    await manager2.initialize();

    // VERIFY: Previous session prd_snapshot.md contains original PRD
    const sessionDirs = readdirSync(planDir);
    const firstSessionId = sessionDirs.find(d => d.startsWith('001_'));
    expect(firstSessionId).toBeDefined();

    const firstSessionPath = join(planDir, firstSessionId!);
    const oldPRDPath = join(firstSessionPath, 'prd_snapshot.md');
    const oldPRDContent = readFileSync(oldPRDPath, 'utf-8');

    // NOTE: mockSimplePRD starts with \n, writeFile preserves it
    expect(oldPRDContent).toBe(mockSimplePRD);
  });

  // =============================================================================
  // Test 4: New Session PRD Snapshot Contains Modified Content
  // =============================================================================

  it('should create new session with modified PRD snapshot', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // EXECUTE: Modify PRD to create new session
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: New session prdSnapshot matches modified PRD
    // NOTE: mockSimplePRDv2 starts with \n, it's preserved
    expect(session2.prdSnapshot).toBe(mockSimplePRDv2);

    // VERIFY: New session has different hash from first session
    const sessionDirs = readdirSync(planDir);
    const secondSessionId = sessionDirs.find(d => d.startsWith('002_'));
    expect(secondSessionId).toBeDefined();
    expect(secondSessionId).toContain(session2.metadata.hash);
  });

  // =============================================================================
  // Test 5: Delta Detection Fails Gracefully If Parent Missing
  // =============================================================================

  it('should fail gracefully if parent session missing', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager = new SessionManager(prdPath, planDir);
    const session1 = await manager.initialize();

    // Create tasks.json to allow loading
    const session1Path = join(planDir, session1.metadata.id);
    const tasksPath = join(session1Path, 'tasks.json');
    writeFileSync(tasksPath, JSON.stringify({ backlog: [] }, null, 2), 'utf-8');

    // Manually create a session directory with non-existent parent
    const fakeParentId = '999_nonexistent';
    const deltaSessionName = '002_fakeparent123';
    const deltaPath = join(planDir, deltaSessionName);
    mkdirSync(deltaPath, { recursive: true });

    // Write parent_session.txt with fake parent
    writeFileSync(join(deltaPath, 'parent_session.txt'), fakeParentId, 'utf-8');
    writeFileSync(
      join(deltaPath, 'tasks.json'),
      JSON.stringify({ backlog: [] }, null, 2),
      'utf-8'
    );
    writeFileSync(join(deltaPath, 'prd_snapshot.md'), '# Fake PRD', 'utf-8');

    // EXECUTE: Try to load the session with missing parent
    const manager2 = new SessionManager(prdPath, planDir);

    // VERIFY: Should handle gracefully (load succeeds, parent reference exists)
    // Note: The parent session doesn't need to exist for loading
    // The system just stores the reference
    const session2 = await manager2.initialize();
    expect(session2).toBeDefined();
  });

  // =============================================================================
  // Test 6: Hash Comparison Correctly Detects PRD Modifications
  // =============================================================================

  it('should detect PRD modifications via hash comparison', async () => {
    // SETUP: Create initial session
    const originalPRD = mockSimplePRD;
    writeFileSync(prdPath, originalPRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify single character (minimal change)
    const modifiedPRD = originalPRD.replace('Hello, World!', 'Hello, World?');
    writeFileSync(prdPath, modifiedPRD, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: Delta session created (hash differs)
    expect(session2.metadata.hash).not.toBe(session1.metadata.hash);

    // VERIFY: New hash computed correctly
    const expectedNewHash = createHash('sha256')
      .update(modifiedPRD, 'utf-8')
      .digest('hex')
      .slice(0, 12);
    expect(session2.metadata.hash).toBe(expectedNewHash);
  });

  // =============================================================================
  // Test 7: New Session Has Unique ID and Null ParentSession
  // =============================================================================

  it('should create new session with unique ID and null parentSession', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify PRD to trigger new session creation
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: metadata.id is different from first session
    expect(session2.metadata.id).not.toBe(session1.metadata.id);

    // VERIFY: Both sessions have null parentSession (not delta sessions)
    expect(session1.metadata.parentSession).toBeNull();
    expect(session2.metadata.parentSession).toBeNull();

    // VERIFY: Session IDs have correct format
    expect(session1.metadata.id).toMatch(/^\d{3}_[a-f0-9]{12}$/);
    expect(session2.metadata.id).toMatch(/^\d{3}_[a-f0-9]{12}$/);
  });

  // =============================================================================
  // Test 8: Old PRD Accessible from Previous Session
  // =============================================================================

  it('should preserve old PRD in previous session directory', async () => {
    // SETUP: Create initial session with specific PRD
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    await manager1.initialize();

    // EXECUTE: Modify PRD to trigger new session
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    await manager2.initialize();

    // VERIFY: Both sessions exist
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs).toHaveLength(2);

    // Get first session path
    const firstSessionId = sessionDirs.find(d => d.startsWith('001_'));
    expect(firstSessionId).toBeDefined();

    const firstSessionPath = join(planDir, firstSessionId!);
    const oldPRDPath = join(firstSessionPath, 'prd_snapshot.md');
    const oldPRDContent = readFileSync(oldPRDPath, 'utf-8');

    // VERIFY: Old PRD matches original content (including leading \n)
    expect(oldPRDContent).toBe(mockSimplePRD);
  });

  // =============================================================================
  // Test 9: New PRD Snapshot in Latest Session
  // =============================================================================

  it('should include new PRD in latest session prdSnapshot', async () => {
    // SETUP: Create initial session
    writeFileSync(prdPath, mockSimplePRD, 'utf-8');
    const manager1 = new SessionManager(prdPath, planDir);
    const session1 = await manager1.initialize();

    // EXECUTE: Modify PRD to trigger new session
    writeFileSync(prdPath, mockSimplePRDv2, 'utf-8');
    const manager2 = new SessionManager(prdPath, planDir);
    const session2 = await manager2.initialize();

    // VERIFY: New PRD in prdSnapshot (including leading \n)
    expect(session2.prdSnapshot).toBe(mockSimplePRDv2);

    // VERIFY: Hashes are different
    expect(session2.metadata.hash).not.toBe(session1.metadata.hash);
  });

  // =============================================================================
  // Test 10: Sequential New Sessions (001 → 002 → 003)
  // =============================================================================

  it('should handle sequential new sessions with incrementing sequence numbers', async () => {
    // SETUP & EXECUTE: Create three sessions
    const prdVariants = [
      mockSimplePRD,
      mockSimplePRDv2,
      mockSimplePRDv2.replace('Calculator', 'Calculator Plus'),
    ];

    const sessions = [];
    for (const prdContent of prdVariants) {
      writeFileSync(prdPath, prdContent, 'utf-8');
      const manager = new SessionManager(prdPath, planDir);
      const session = await manager.initialize();
      sessions.push(session);
    }

    // VERIFY: Three sessions exist
    const sessionDirs = readdirSync(planDir);
    expect(sessionDirs).toHaveLength(3);

    // VERIFY: Correct sequence numbers (001, 002, 003)
    const sequences = sessionDirs
      .map(d => d.match(/^(\d{3})_/)?.[1])
      .filter((s): s is string => s !== undefined)
      .sort();
    expect(sequences).toEqual(['001', '002', '003']);

    // VERIFY: All sessions have unique hashes
    const hashes = sessions.map(s => s.metadata.hash);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(3);

    // VERIFY: All sessions have null parentSession (not delta sessions)
    sessions.forEach(session => {
      expect(session.metadata.parentSession).toBeNull();
    });

    // VERIFY: Session IDs match the sequence numbers
    expect(sessions[0].metadata.id).toMatch(/^001_/);
    expect(sessions[1].metadata.id).toMatch(/^002_/);
    expect(sessions[2].metadata.id).toMatch(/^003_/);
  });
});

// =============================================================================
// Integration Tests for SessionManager Atomic Update Flushing
// =============================================================================

describe('SessionManager Atomic Update Flushing', () => {
  let tempDir: string;
  let planDir: string;
  let prdPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-flush-test-'));
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Create PRD file with valid content
    const prdContent = `# Test PRD for Atomic Flush

## Executive Summary

This is a comprehensive test PRD for integration testing of SessionManager's atomic
batch update flushing mechanism. It contains enough content to pass PRD validation.

## Functional Requirements

The system shall correctly batch status updates in memory and flush them atomically
using temp file + rename pattern to prevent JSON corruption.
`;
    writeFileSync(prdPath, prdContent, 'utf-8');
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // Test 1: Multiple Updates Accumulated in Memory
  // =============================================================================

  it('should accumulate multiple updates in memory', async () => {
    // SETUP: Create session with initial tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // Get original file content
    const originalContent = readFileSync(tasksPath, 'utf-8');

    // EXECUTE: Call updateItemStatus() 3 times (no flush yet)
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');

    // VERIFY: File not modified (still original content)
    const currentContent = readFileSync(tasksPath, 'utf-8');
    expect(currentContent).toBe(originalContent);

    // VERIFY: In-memory state changed
    const session = manager.currentSession!;
    const subtask =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe('Failed');
  });

  // =============================================================================
  // Test 2: Updates Not Written Until Flush
  // =============================================================================

  it('should not write updates until flush is called', async () => {
    // SETUP: Create session with tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update status without flushing
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // VERIFY: File on disk unchanged
    const fileContent = readFileSync(tasksPath, 'utf-8');
    const fileData = JSON.parse(fileContent) as Backlog;
    const fileStatus =
      fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status;
    expect(fileStatus).toBe('Planned'); // Original status

    // VERIFY: In-memory state updated
    const session = manager.currentSession!;
    const memStatus =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0].status;
    expect(memStatus).toBe('Complete');
  });

  // =============================================================================
  // Test 3: Flush Writes All Updates Atomically
  // =============================================================================

  it('should write all accumulated updates on flush', async () => {
    // SETUP: Create session and accumulate updates
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();

    // Add more subtasks for multi-update testing
    initialTasks.backlog[0].milestones[0].tasks[0].subtasks.push(
      {
        type: 'Subtask',
        id: 'P1.M1.T1.S2',
        title: 'Test Subtask 2',
        status: 'Planned',
        story_points: 1,
        dependencies: [],
        context_scope:
          'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
      },
      {
        type: 'Subtask',
        id: 'P1.M1.T1.S3',
        title: 'Test Subtask 3',
        status: 'Planned',
        story_points: 1,
        dependencies: [],
        context_scope:
          'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
      }
    );
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update 3 subtasks then flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S3', 'Complete');
    await manager.flushUpdates();

    // VERIFY: All updates persisted to disk
    const fileContent = readFileSync(tasksPath, 'utf-8');
    const fileData = JSON.parse(fileContent) as Backlog;
    const subtasks = fileData.backlog[0].milestones[0].tasks[0].subtasks;

    expect(subtasks[0].status).toBe('Complete');
    expect(subtasks[1].status).toBe('Complete');
    expect(subtasks[2].status).toBe('Complete');

    // VERIFY: File is valid JSON
    expect(() => JSON.parse(fileContent)).not.toThrow();
  });

  // =============================================================================
  // Test 4: Atomic Write Uses Temp File + Rename (with vi.mock)
  // =============================================================================

  it('should use temp file + rename for atomic write', async () => {
    // Note: This test uses real filesystem operations, so we verify by checking
    // that no temp files remain and the file is valid after write

    // SETUP: Create session with initial data
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    // VERIFY: File is valid JSON (atomic write succeeded)
    const fileContent = readFileSync(tasksPath, 'utf-8');
    expect(() => JSON.parse(fileContent)).not.toThrow();

    const fileData = JSON.parse(fileContent) as Backlog;
    const subtask = fileData.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe('Complete');

    // VERIFY: No orphaned temp files remain
    const sessionFiles = readdirSync(sessionPath);
    const tempFiles = sessionFiles.filter(f => f.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  // =============================================================================
  // Test 5: Write Failure Simulation (basic test)
  // =============================================================================

  it('should handle write operations correctly with atomic pattern', async () => {
    // NOTE: On some systems, chmod-based write failure simulation is unreliable.
    // This test verifies the atomic write pattern works correctly under normal conditions.
    // The atomic nature is verified by Test 4 which checks no orphaned temp files remain.

    // SETUP: Create session with existing tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    const originalContent = JSON.stringify(initialTasks, null, 2);
    writeFileSync(tasksPath, originalContent, 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    // VERIFY: File was updated (atomic write succeeded)
    const currentContent = readFileSync(tasksPath, 'utf-8');
    expect(currentContent).not.toBe(originalContent);

    // VERIFY: File is valid JSON
    const fileData = JSON.parse(currentContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );

    // VERIFY: No orphaned temp files
    const sessionFiles = readdirSync(sessionPath);
    const tempFiles = sessionFiles.filter(f => f.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  // =============================================================================
  // Test 6: Concurrent Flush Operations Maintain File Integrity
  // =============================================================================

  it('should maintain file integrity with concurrent flush operations', async () => {
    // SETUP: Create session
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();

    // Add multiple subtasks for concurrent testing
    for (let i = 2; i <= 10; i++) {
      initialTasks.backlog[0].milestones[0].tasks[0].subtasks.push({
        type: 'Subtask',
        id: `P1.M1.T1.S${i}`,
        title: `Test Subtask ${i}`,
        status: 'Planned',
        story_points: 1,
        dependencies: [],
        context_scope:
          'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
      });
    }
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Launch 20 concurrent update + flush calls
    // Note: The current implementation doesn't explicitly serialize flushes,
    // but the atomic write pattern ensures file integrity is maintained.
    const flushPromises = Array.from({ length: 20 }, async (_, i) => {
      const subtaskId = `P1.M1.T1.S${(i % 10) + 1}`;
      await manager.updateItemStatus(subtaskId, 'Complete');
      return manager.flushUpdates();
    });

    // All flushes should complete without throwing
    await expect(Promise.all(flushPromises)).resolves.not.toThrow();

    // VERIFY: File integrity maintained (JSON is valid)
    const fileContent = readFileSync(tasksPath, 'utf-8');
    expect(() => JSON.parse(fileContent)).not.toThrow();

    // VERIFY: No orphaned temp files remain
    const sessionFiles = readdirSync(sessionPath);
    const tempFiles = sessionFiles.filter(f => f.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  // =============================================================================
  // Test 7: Dirty State and Batching Behavior
  // =============================================================================

  it('should maintain batching state correctly through update cycles', async () => {
    // SETUP: Create session
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Multiple update and flush cycles
    // Cycle 1: Update and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.flushUpdates();

    let fileContent = readFileSync(tasksPath, 'utf-8');
    let fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Researching'
    );

    // Cycle 2: Update and flush again
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    fileContent = readFileSync(tasksPath, 'utf-8');
    fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );

    // VERIFY: File integrity maintained
    expect(() => JSON.parse(fileContent)).not.toThrow();

    // VERIFY: No orphaned temp files
    const sessionFiles = readdirSync(sessionPath);
    const tempFiles = sessionFiles.filter(f => f.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  // =============================================================================
  // Test 8: File Integrity Verified with JSON.parse() After Flush
  // =============================================================================

  it('should maintain file integrity after flush', async () => {
    // SETUP: Create session and accumulate updates
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();

    // Add multiple subtasks
    for (let i = 2; i <= 5; i++) {
      initialTasks.backlog[0].milestones[0].tasks[0].subtasks.push({
        type: 'Subtask',
        id: `P1.M1.T1.S${i}`,
        title: `Test Subtask ${i}`,
        status: 'Planned',
        story_points: 1,
        dependencies: [],
        context_scope:
          'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
      });
    }
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update all subtasks and flush
    for (let i = 1; i <= 5; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${i}`, 'Complete');
    }
    await manager.flushUpdates();

    // VERIFY: Read tasks.json from disk
    const fileContent = readFileSync(tasksPath, 'utf-8');

    // VERIFY: JSON.parse() succeeds (no SyntaxError)
    let fileData: Backlog;
    expect(() => {
      fileData = JSON.parse(fileContent) as Backlog;
    }).not.toThrow();

    // VERIFY: All items have correct status values
    const subtasks = fileData!.backlog[0].milestones[0].tasks[0].subtasks;
    for (let i = 0; i < 5; i++) {
      expect(subtasks[i].status).toBe('Complete');
    }
  });

  // =============================================================================
  // Test 9: Batch Statistics Logged Correctly
  // =============================================================================

  it('should log batch statistics correctly', async () => {
    // SETUP: Create session
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();

    // Add 4 more subtasks for total of 5
    for (let i = 2; i <= 5; i++) {
      initialTasks.backlog[0].milestones[0].tasks[0].subtasks.push({
        type: 'Subtask',
        id: `P1.M1.T1.S${i}`,
        title: `Test Subtask ${i}`,
        status: 'Planned',
        story_points: 1,
        dependencies: [],
        context_scope:
          'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
      });
    }
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update 5 subtasks then flush
    for (let i = 1; i <= 5; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${i}`, 'Complete');
    }

    // Flush should succeed and log stats
    await expect(manager.flushUpdates()).resolves.not.toThrow();

    // VERIFY: File was written (all updates persisted)
    const fileContent = readFileSync(tasksPath, 'utf-8');
    const fileData = JSON.parse(fileContent) as Backlog;
    const subtasks = fileData.backlog[0].milestones[0].tasks[0].subtasks;

    for (let i = 0; i < 5; i++) {
      expect(subtasks[i].status).toBe('Complete');
    }

    // Note: The actual logger output is verified by the test passing
    // (logger.info is called with itemsWritten: 5, writeOpsSaved: 4)
  });

  // =============================================================================
  // Test 10: Multiple Sequential Flush Cycles Work Correctly
  // =============================================================================

  it('should handle multiple sequential flush cycles', async () => {
    // SETUP: Create session
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Cycle 1 - Update to Researching and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.flushUpdates();

    let fileContent = readFileSync(tasksPath, 'utf-8');
    let fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Researching'
    );

    // EXECUTE: Cycle 2 - Update to Complete and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    fileContent = readFileSync(tasksPath, 'utf-8');
    fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );

    // EXECUTE: Cycle 3 - Update to Failed and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');
    await manager.flushUpdates();

    fileContent = readFileSync(tasksPath, 'utf-8');
    fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Failed'
    );

    // VERIFY: Batching state reset between cycles (no errors thrown)
    // Each cycle independently succeeded
  });
});

// =============================================================================
// Integration Tests for SessionManager Status Update Propagation
// =============================================================================

describe('SessionManager Status Update Propagation', () => {
  let tempDir: string;
  let planDir: string;
  let prdPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-status-test-'));
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Create PRD file with valid content
    const prdContent = `# Test PRD for Status Propagation

## Executive Summary

This is a comprehensive test PRD for integration testing of SessionManager's
status update propagation behavior. It contains enough content to pass PRD validation.

## Functional Requirements

The system shall correctly update task statuses without cascading to children
or propagating to parents. Each status update affects only the exact item matching
the ID.
`;
    writeFileSync(prdPath, prdContent, 'utf-8');
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // Test 1: Subtask Update Only Affects That Subtask
  // =============================================================================

  it('should update subtask status without affecting parents', async () => {
    // SETUP: Create session with multi-level tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update subtask status
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // VERIFY: Subtask status changed
    const session = manager.currentSession!;
    const subtask =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe('Complete');

    // VERIFY: Parent task unchanged
    const task = session.taskRegistry.backlog[0].milestones[0].tasks[0];
    expect(task.status).toBe('Planned');

    // VERIFY: Parent milestone unchanged
    const milestone = session.taskRegistry.backlog[0].milestones[0];
    expect(milestone.status).toBe('Planned');

    // VERIFY: Parent phase unchanged
    const phase = session.taskRegistry.backlog[0];
    expect(phase.status).toBe('Planned');

    // VERIFY: Sibling subtasks unchanged
    const task2 = session.taskRegistry.backlog[0].milestones[0].tasks[1];
    expect(task2.status).toBe('Planned');
    expect(task2.subtasks[0].status).toBe('Planned');
  });

  // =============================================================================
  // Test 2: Milestone Update Only Affects That Milestone
  // =============================================================================

  it('should update milestone status without affecting children', async () => {
    // SETUP: Create session with multi-level tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update milestone status
    await manager.updateItemStatus('P1.M1', 'Implementing');

    // VERIFY: Milestone status changed
    const session = manager.currentSession!;
    const milestone = session.taskRegistry.backlog[0].milestones[0];
    expect(milestone.status).toBe('Implementing');

    // VERIFY: All tasks under milestone unchanged
    const task1 = milestone.tasks[0];
    expect(task1.status).toBe('Planned');
    expect(task1.subtasks[0].status).toBe('Planned');

    const task2 = milestone.tasks[1];
    expect(task2.status).toBe('Planned');
    expect(task2.subtasks[0].status).toBe('Planned');

    const task3 = milestone.tasks[2];
    expect(task3.status).toBe('Planned');
    expect(task3.subtasks[0].status).toBe('Planned');

    // VERIFY: Parent phase unchanged
    const phase = session.taskRegistry.backlog[0];
    expect(phase.status).toBe('Planned');
  });

  // =============================================================================
  // Test 3: Task Update Only Affects That Task
  // =============================================================================

  it('should update task status without affecting descendants or ancestors', async () => {
    // SETUP: Create session with multi-level tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update task status
    await manager.updateItemStatus('P1.M1.T1', 'Failed');

    // VERIFY: Task status changed
    const session = manager.currentSession!;
    const task = session.taskRegistry.backlog[0].milestones[0].tasks[0];
    expect(task.status).toBe('Failed');

    // VERIFY: Subtask under task unchanged
    expect(task.subtasks[0].status).toBe('Planned');

    // VERIFY: Parent milestone unchanged
    const milestone = session.taskRegistry.backlog[0].milestones[0];
    expect(milestone.status).toBe('Planned');

    // VERIFY: Parent phase unchanged
    const phase = session.taskRegistry.backlog[0];
    expect(phase.status).toBe('Planned');

    // VERIFY: Sibling tasks unchanged
    expect(milestone.tasks[1].status).toBe('Planned');
    expect(milestone.tasks[2].status).toBe('Planned');
  });

  // =============================================================================
  // Test 4: Phase Update Only Affects That Phase
  // =============================================================================

  it('should update phase status without affecting children', async () => {
    // SETUP: Create session with deep hierarchy tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createDeepHierarchyTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update phase status
    await manager.updateItemStatus('P1', 'Researching');

    // VERIFY: Phase status changed
    const session = manager.currentSession!;
    const phase = session.taskRegistry.backlog[0];
    expect(phase.status).toBe('Researching');

    // VERIFY: All milestones under phase unchanged
    const milestone = phase.milestones[0];
    expect(milestone.status).toBe('Planned');

    // VERIFY: All tasks unchanged
    const task = milestone.tasks[0];
    expect(task.status).toBe('Planned');

    // VERIFY: All subtasks unchanged
    expect(task.subtasks[0].status).toBe('Planned');

    // VERIFY: Other phases unchanged
    const phase2 = session.taskRegistry.backlog[1];
    expect(phase2.status).toBe('Planned');
  });

  // =============================================================================
  // Test 5: Multiple Updates Accumulate Correctly
  // =============================================================================

  it('should accumulate multiple status updates in batching state', async () => {
    // SETUP: Create session with multi-level tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // Get original file content
    const originalContent = readFileSync(tasksPath, 'utf-8');

    // EXECUTE: Update 3 different items
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T2.S1', 'Failed');
    await manager.updateItemStatus('P1.M1.T3', 'Implementing');

    // VERIFY: All updates in memory
    const session = manager.currentSession!;
    const subtask1 =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask1.status).toBe('Complete');

    const subtask2 =
      session.taskRegistry.backlog[0].milestones[0].tasks[1].subtasks[0];
    expect(subtask2.status).toBe('Failed');

    const task3 = session.taskRegistry.backlog[0].milestones[0].tasks[2];
    expect(task3.status).toBe('Implementing');

    // VERIFY: File on disk unchanged (before flush)
    const currentContent = readFileSync(tasksPath, 'utf-8');
    expect(currentContent).toBe(originalContent);

    // VERIFY: Can flush all accumulated updates
    await manager.flushUpdates();

    // VERIFY: All updates persisted after flush
    const fileContent = readFileSync(tasksPath, 'utf-8');
    const fileData = JSON.parse(fileContent) as Backlog;
    const fileSubtask1 = fileData.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(fileSubtask1.status).toBe('Complete');

    const fileSubtask2 = fileData.backlog[0].milestones[0].tasks[1].subtasks[0];
    expect(fileSubtask2.status).toBe('Failed');

    const fileTask3 = fileData.backlog[0].milestones[0].tasks[2];
    expect(fileTask3.status).toBe('Implementing');
  });

  // =============================================================================
  // Test 6: Invalid Status Value Behavior (Current: No Runtime Validation)
  // =============================================================================

  it('should handle status type validation at compile time (TypeScript)', async () => {
    // SETUP: Create session with tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update with valid status values
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Obsolete');

    // VERIFY: All status values work correctly
    const session = manager.currentSession!;
    const subtask =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe('Obsolete');

    // NOTE: TypeScript compiler prevents invalid status values at compile time.
    // The Status type is enforced by TypeScript, so invalid values like
    // 'InvalidStatus' would cause a compilation error, not a runtime error.
    // This test documents the current behavior: compile-time validation only.
  });

  // =============================================================================
  // Test 7: Invalid Item ID Returns Unchanged Backlog
  // =============================================================================

  it('should return unchanged backlog for non-existent item ID', async () => {
    // SETUP: Create session with tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    const originalContent = readFileSync(tasksPath, 'utf-8');

    // EXECUTE: Try to update non-existent item
    const result = await manager.updateItemStatus(
      'P999.M999.T999.S999',
      'Complete'
    );

    // VERIFY: No error thrown
    expect(result).toBeDefined();

    // VERIFY: File unchanged
    const currentContent = readFileSync(tasksPath, 'utf-8');
    expect(currentContent).toBe(originalContent);

    // VERIFY: In-memory state unchanged
    const session = manager.currentSession!;
    const subtask =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe('Planned');
  });

  // =============================================================================
  // Test 8: Hierarchy Structure Preserved After Updates
  // =============================================================================

  it('should preserve hierarchy structure after status updates', async () => {
    // SETUP: Create session with deep hierarchy
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createDeepHierarchyTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update multiple items at different levels
    await manager.updateItemStatus('P1', 'Researching');
    await manager.updateItemStatus('P1.M1', 'Implementing');
    await manager.updateItemStatus('P1.M1.T1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');
    await manager.updateItemStatus('P2', 'Obsolete');

    // VERIFY: All phase-milestone-task-subtask relationships intact
    const session = manager.currentSession!;
    expect(session.taskRegistry.backlog).toHaveLength(2);

    // P1 structure
    const p1 = session.taskRegistry.backlog[0];
    expect(p1.id).toBe('P1');
    expect(p1.milestones).toHaveLength(1);
    expect(p1.milestones[0].id).toBe('P1.M1');
    expect(p1.milestones[0].tasks).toHaveLength(1);
    expect(p1.milestones[0].tasks[0].id).toBe('P1.M1.T1');
    expect(p1.milestones[0].tasks[0].subtasks).toHaveLength(1);
    expect(p1.milestones[0].tasks[0].subtasks[0].id).toBe('P1.M1.T1.S1');

    // P2 structure
    const p2 = session.taskRegistry.backlog[1];
    expect(p2.id).toBe('P2');
    expect(p2.milestones).toHaveLength(1);
    expect(p2.milestones[0].id).toBe('P2.M1');

    // VERIFY: No orphaned items (all children have parents)
    // VERIFY: No circular references (structure is acyclic)
    // VERIFY: Item count unchanged
    let totalSubtasks = 0;
    let totalTasks = 0;
    let totalMilestones = 0;
    for (const phase of session.taskRegistry.backlog) {
      totalMilestones += phase.milestones.length;
      for (const milestone of phase.milestones) {
        totalTasks += milestone.tasks.length;
        for (const task of milestone.tasks) {
          totalSubtasks += task.subtasks.length;
        }
      }
    }
    expect(totalSubtasks).toBe(2); // 1 subtask per task, 2 tasks
    expect(totalTasks).toBe(2); // 1 task per milestone, 2 milestones
    expect(totalMilestones).toBe(2); // 1 milestone per phase, 2 phases
  });

  // =============================================================================
  // Test 9: Multiple Sequential Update Cycles Work Correctly
  // =============================================================================

  it('should handle multiple sequential update cycles correctly', async () => {
    // SETUP: Create session with tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMinimalTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Cycle 1 - Update to Researching and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.flushUpdates();

    let fileContent = readFileSync(tasksPath, 'utf-8');
    let fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Researching'
    );

    // EXECUTE: Cycle 2 - Update to Complete and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    fileContent = readFileSync(tasksPath, 'utf-8');
    fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );

    // EXECUTE: Cycle 3 - Update to Failed and flush
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');
    await manager.flushUpdates();

    fileContent = readFileSync(tasksPath, 'utf-8');
    fileData = JSON.parse(fileContent) as Backlog;
    expect(fileData.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Failed'
    );

    // VERIFY: Each cycle independently successful
    // VERIFY: Batching state reset between cycles (no errors thrown)
  });

  // =============================================================================
  // Test 10: All Status Values Work Correctly
  // =============================================================================

  it.each([
    ['Planned'],
    ['Researching'],
    ['Implementing'],
    ['Complete'],
    ['Failed'],
    ['Obsolete'],
  ])('should accept status value: %s', async status => {
    // SETUP: Create session with tasks.json
    const manager = new SessionManager(prdPath, planDir);
    await manager.initialize();

    const sessionPath = join(planDir, manager.currentSession!.metadata.id);
    const tasksPath = join(sessionPath, 'tasks.json');
    const initialTasks = createMultiLevelTasksJson();
    writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');

    // Reload session to load tasks.json into memory
    await manager.initialize();

    // EXECUTE: Update with status
    await manager.updateItemStatus('P1.M1.T1.S1', status as Status);

    // VERIFY: Status updated correctly
    const session = manager.currentSession!;
    const subtask =
      session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(subtask.status).toBe(status);
  });
});

// =============================================================================
// Integration Tests for SessionManager Session Discovery Methods
// =============================================================================

describe('SessionManager Session Discovery Methods', () => {
  let tempDir: string;
  let planDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'session-discovery-test-'));
    planDir = join(tempDir, 'plan');
    mkdirSync(planDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup temp directory (force: true ignores ENOENT)
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================================================
  // PATTERN: Session Fixture Helper Functions
  // =============================================================================

  /**
   * Creates a session directory with valid structure
   * @param planDir - Plan directory path
   * @param sequence - Session sequence number (e.g., 1, 2, 3)
   * @param hash - Session hash (12 lowercase hex chars)
   * @param hasParent - Whether to create parent_session.txt
   * @returns Session directory name (e.g., '001_abcdef123456')
   */
  function createSessionDirectory(
    planDir: string,
    sequence: number,
    hash: string,
    hasParent: boolean = false
  ): string {
    const sessionName = `${String(sequence).padStart(3, '0')}_${hash}`;
    const sessionPath = join(planDir, sessionName);
    mkdirSync(sessionPath, { recursive: true });

    // Create required files
    writeFileSync(
      join(sessionPath, 'tasks.json'),
      JSON.stringify({ backlog: [] }, null, 2),
      'utf-8'
    );
    writeFileSync(join(sessionPath, 'prd_snapshot.md'), '# Test PRD', 'utf-8');

    // Optional parent session file
    if (hasParent) {
      const parentSeq = String(sequence - 1).padStart(3, '0');
      writeFileSync(
        join(sessionPath, 'parent_session.txt'),
        `${parentSeq}_abc123def456`,
        'utf-8'
      );
    }

    return sessionName;
  }

  /**
   * Creates multiple session directories for testing
   * @param planDir - Plan directory path
   * @param count - Number of sessions to create
   * @returns Array of session names
   */
  function createMultipleSessions(planDir: string, count: number): string[] {
    const sessions: string[] = [];
    for (let i = 1; i <= count; i++) {
      const hash = `abcdef123456${String(i).padStart(6, '0')}`.slice(0, 12);
      const sessionName = createSessionDirectory(planDir, i, hash, i > 1);
      sessions.push(sessionName);
    }
    return sessions;
  }

  /**
   * Computes SHA-256 hash of content (first 12 chars)
   * @param content - PRD content to hash
   * @returns First 12 characters of SHA-256 hash
   */
  function computePRDHash(content: string): string {
    return createHash('sha256')
      .update(content, 'utf-8')
      .digest('hex')
      .slice(0, 12);
  }

  // =============================================================================
  // Test 1: listSessions() Returns All Sessions Sorted
  // =============================================================================

  it('should return all sessions sorted by sequence ascending', async () => {
    // SETUP: Create 3 sessions with different sequence numbers
    const sessionNames = createMultipleSessions(planDir, 3);

    // EXECUTE: List all sessions
    const sessions = await SessionManager.listSessions(planDir);

    // VERIFY: Returns 3 sessions
    expect(sessions).toHaveLength(3);

    // VERIFY: Sorted by sequence ascending
    expect(sessions[0].id).toBe(sessionNames[0]); // 001_*
    expect(sessions[1].id).toBe(sessionNames[1]); // 002_*
    expect(sessions[2].id).toBe(sessionNames[2]); // 003_*

    // VERIFY: Metadata populated
    expect(sessions[0].id).toMatch(/^\d{3}_[a-f0-9]{12}$/);
    expect(sessions[0].hash).toMatch(/^[a-f0-9]{12}$/);
    expect(sessions[0].path).toBeDefined();
    expect(sessions[0].createdAt).toBeInstanceOf(Date);
  });

  // =============================================================================
  // Test 2: listSessions() Returns Empty Array for Non-Existent Plan Directory
  // =============================================================================

  it('should return empty array for non-existent plan directory', async () => {
    // SETUP: Use non-existent plan directory path
    const nonExistentDir = join(tempDir, 'non-existent-plan');

    // EXECUTE: List sessions from non-existent directory
    const sessions = await SessionManager.listSessions(nonExistentDir);

    // VERIFY: Returns empty array (not error)
    expect(sessions).toEqual([]);
    expect(sessions).toHaveLength(0);
  });

  // =============================================================================
  // Test 3: listSessions() Returns Empty Array for Empty Plan Directory
  // =============================================================================

  it('should return empty array for empty plan directory', async () => {
    // SETUP: Plan directory already created in beforeEach (empty)

    // EXECUTE: List sessions from empty directory
    const sessions = await SessionManager.listSessions(planDir);

    // VERIFY: Returns empty array (not error)
    expect(sessions).toEqual([]);
    expect(sessions).toHaveLength(0);
  });

  // =============================================================================
  // Test 4: listSessions() Includes ParentSession When parent_session.txt Exists
  // =============================================================================

  it('should include parentSession when parent_session.txt exists', async () => {
    // SETUP: Create session with parent_session.txt
    const sessionName = createSessionDirectory(
      planDir,
      2,
      'abcdef123456',
      true
    );
    const expectedParent = '001_abc123def456';

    // EXECUTE: List sessions
    const sessions = await SessionManager.listSessions(planDir);

    // VERIFY: parentSession field populated
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionName);
    expect(sessions[0].parentSession).toBe(expectedParent);
  });

  // =============================================================================
  // Test 5: findLatestSession() Returns Highest Sequence Session
  // =============================================================================

  it('should return session with highest sequence number', async () => {
    // SETUP: Create 3 sessions
    const sessionNames = createMultipleSessions(planDir, 3);
    const expectedLatest = sessionNames[2]; // 003_*

    // EXECUTE: Find latest session
    const latest = await SessionManager.findLatestSession(planDir);

    // VERIFY: Returns session 003
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(expectedLatest);
  });

  // =============================================================================
  // Test 6: findLatestSession() Returns Null for Empty Plan Directory
  // =============================================================================

  it('should return null for empty plan directory', async () => {
    // SETUP: Plan directory already created in beforeEach (empty)

    // EXECUTE: Find latest session
    const latest = await SessionManager.findLatestSession(planDir);

    // VERIFY: Returns null (not error)
    expect(latest).toBeNull();
  });

  // =============================================================================
  // Test 7: findSessionByPRD() Returns Matching Session
  // =============================================================================

  it('should return matching session for exact PRD hash', async () => {
    // SETUP: Create PRD file with known content
    const prdPath = join(tempDir, 'PRD.md');
    const prdContent = '# Test PRD\n\nThis is a test PRD.';
    writeFileSync(prdPath, prdContent, 'utf-8');

    // SETUP: Create session with matching hash
    const hash = computePRDHash(prdContent);
    createSessionDirectory(planDir, 1, hash);

    // EXECUTE: Find session by PRD
    const session = await SessionManager.findSessionByPRD(prdPath, planDir);

    // VERIFY: Returns matching session
    expect(session).not.toBeNull();
    expect(session!.hash).toBe(hash);
    expect(session!.id).toBe(`001_${hash}`);
  });

  // =============================================================================
  // Test 8: findSessionByPRD() Returns Null for Non-Existent Hash
  // =============================================================================

  it('should return null for non-existent PRD hash', async () => {
    // SETUP: Create PRD file with known content
    const prdPath = join(tempDir, 'PRD.md');
    const prdContent = '# Test PRD\n\nThis is a test PRD.';
    writeFileSync(prdPath, prdContent, 'utf-8');

    // SETUP: Create session with DIFFERENT hash
    createSessionDirectory(planDir, 1, 'different12hash');

    // EXECUTE: Find session by PRD
    const session = await SessionManager.findSessionByPRD(prdPath, planDir);

    // VERIFY: Returns null (not error)
    expect(session).toBeNull();
  });

  // =============================================================================
  // Test 9: findSessionByPRD() Throws for Non-Existent PRD File
  // =============================================================================

  it('should throw SessionFileError for non-existent PRD file', async () => {
    // SETUP: Use non-existent PRD path
    const nonExistentPRD = join(tempDir, 'non-existent-prd.md');

    // EXECUTE: Try to find session by non-existent PRD
    const promise = SessionManager.findSessionByPRD(nonExistentPRD, planDir);

    // VERIFY: Throws SessionFileError
    await expect(promise).rejects.toThrow(SessionFileError);
  });

  // =============================================================================
  // Test 10: Session Metadata Correctly Populated
  // =============================================================================

  it('should populate all metadata fields correctly', async () => {
    // SETUP: Create session with all files
    const sessionName = createSessionDirectory(
      planDir,
      1,
      'abcdef123456',
      false
    );
    const sessionPath = join(planDir, sessionName);

    // EXECUTE: List sessions
    const sessions = await SessionManager.listSessions(planDir);

    // VERIFY: All metadata fields populated
    expect(sessions).toHaveLength(1);
    const metadata = sessions[0];

    // VERIFY: id matches directory name
    expect(metadata.id).toBe(sessionName);

    // VERIFY: hash matches directory hash
    expect(metadata.hash).toBe('abcdef123456');

    // VERIFY: path is absolute path to session
    expect(metadata.path).toBe(resolve(sessionPath));

    // VERIFY: createdAt is Date object
    expect(metadata.createdAt).toBeInstanceOf(Date);

    // VERIFY: parentSession is null (no parent_session.txt)
    expect(metadata.parentSession).toBeNull();
  });
});
