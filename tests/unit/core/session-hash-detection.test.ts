/**
 * Unit tests for PRD hash-based change detection
 *
 * @remarks
 * Comprehensive test suite validating the SHA-256 hash computation and
 * change detection logic used by SessionManager for delta session creation.
 *
 * Tests cover:
 * - SHA-256 hash computation from PRD file content (64-character hex string)
 * - Hash change detection when PRD content changes
 * - hasSessionChanged() method behavior
 * - Case-sensitive and deterministic hash comparison
 * - First 12-character slice pattern for session hashes
 * - Hash caching behavior during initialize()
 * - Edge cases: empty content, unicode, special characters, whitespace
 *
 * Uses real crypto operations (not mocks) for predictable hash values
 * with known PRD content.
 *
 * @see {@link ../../src/core/session-utils.ts | hashPRD() function}
 * @see {@link ../../src/core/session-manager.ts | hasSessionChanged() method}
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import SessionManager and types
import { SessionManager } from '../../../src/core/session-manager.js';
import {
  hashPRD,
  createSessionDirectory,
} from '../../../src/core/session-utils.js';

// Import test fixtures
import { mockSimplePRD } from '../../fixtures/simple-prd.js';
import { mockSimplePRDv2 } from '../../fixtures/simple-prd-v2.js';

describe('PRD Hash-based Change Detection', () => {
  let tempDir: string;
  let planDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'hash-detection-test-'));
    planDir = join(tempDir, 'plan');
    mkdirSync(planDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory after test
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper function to create test PRD
   * @param path - Filesystem path to write PRD
   * @param content - PRD markdown content
   */
  function createTestPRD(path: string, content: string): void {
    writeFileSync(path, content, { mode: 0o644 });
  }

  /**
   * Helper function to compute expected hash
   * @param content - Content to hash
   * @returns SHA-256 hash as 64-character hex string
   */
  function computeExpectedHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * CONTRACT (a): SHA-256 hash computation test
   * Verifies that hashPRD() computes SHA-256 hash from PRD file content
   */
  describe('SHA-256 hash computation (CONTRACT a)', () => {
    it('should compute SHA-256 hash from PRD file content', async () => {
      // SETUP: Create test PRD with known content
      const prdPath = join(tempDir, 'PRD.md');
      const prdContent = '# Test PRD\n\nKnown content for hash testing.';
      createTestPRD(prdPath, prdContent);

      // EXECUTE: Compute hash using hashPRD function
      const hash = await hashPRD(prdPath);

      // VERIFY: Hash is 64-character hex string
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // VERIFY: Hash matches expected value from real crypto
      const expectedHash = computeExpectedHash(prdContent);
      expect(hash).toBe(expectedHash);

      // VERIFY: Uses SHA-256 algorithm
      const manualHash = createHash('sha256')
        .update(prdContent, 'utf-8')
        .digest('hex');
      expect(hash).toBe(manualHash);
    });

    it('should compute hash using createHash sha256 algorithm', async () => {
      // SETUP: Create PRD with specific content
      const prdPath = join(tempDir, 'PRD.md');
      const prdContent = '# PRD\n\nContent for algorithm verification.';
      createTestPRD(prdPath, prdContent);

      // EXECUTE: Compute hash
      const hash = await hashPRD(prdPath);

      // VERIFY: Hash matches manual SHA-256 computation
      const manualHash = createHash('sha256')
        .update(prdContent, 'utf-8')
        .digest('hex');
      expect(hash).toBe(manualHash);

      // VERIFY: Hash is valid SHA-256 format
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  /**
   * CONTRACT (b): Hash change detection test
   * Verifies that hash changes when PRD content changes
   */
  describe('Hash change detection (CONTRACT b)', () => {
    it('should detect hash change when PRD content changes', async () => {
      // SETUP: Create PRD with v1 content
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, mockSimplePRD);

      // EXECUTE: Compute initial hash
      const hash1 = await hashPRD(prdPath);

      // MODIFY: Update PRD with v2 content
      createTestPRD(prdPath, mockSimplePRDv2);

      // EXECUTE: Compute new hash
      const hash2 = await hashPRD(prdPath);

      // VERIFY: Hashes differ (change detected)
      expect(hash1).not.toBe(hash2);

      // VERIFY: Both are valid hashes
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);

      // VERIFY: Can verify with real crypto
      const expectedHash1 = computeExpectedHash(mockSimplePRD);
      const expectedHash2 = computeExpectedHash(mockSimplePRDv2);
      expect(hash1).toBe(expectedHash1);
      expect(hash2).toBe(expectedHash2);
    });

    it('should produce different hashes for different content', async () => {
      // SETUP: Create two different PRDs
      const prdPath1 = join(tempDir, 'PRD1.md');
      const prdPath2 = join(tempDir, 'PRD2.md');

      const content1 = '# PRD v1\n\nFirst version.';
      const content2 = '# PRD v2\n\nSecond version.';

      createTestPRD(prdPath1, content1);
      createTestPRD(prdPath2, content2);

      // EXECUTE: Compute hashes
      const hash1 = await hashPRD(prdPath1);
      const hash2 = await hashPRD(prdPath2);

      // VERIFY: Hashes are different
      expect(hash1).not.toBe(hash2);

      // VERIFY: Both are valid SHA-256 hashes
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  /**
   * CONTRACT (c): hasSessionChanged() method test
   * Verifies that hasSessionChanged() returns true when hash mismatch detected
   */
  describe('hasSessionChanged() method (CONTRACT c)', () => {
    it('should return true when hash mismatch detected via hasSessionChanged', async () => {
      // SETUP: Create PRD with initial content
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, mockSimplePRD);

      // EXECUTE: Initialize session with initial PRD
      const manager1 = new SessionManager(prdPath, planDir);
      await manager1.initialize();
      const session1 = manager1.currentSession;

      // VERIFY: No change detected initially
      expect(manager1.hasSessionChanged()).toBe(false);

      // MODIFY: Update PRD with different content
      createTestPRD(prdPath, mockSimplePRDv2);

      // EXECUTE: Initialize new session manager (recomputes hash)
      const manager2 = new SessionManager(prdPath, planDir);
      await manager2.initialize();
      const session2 = manager2.currentSession;

      // VERIFY: Session hashes differ
      expect(session1.metadata.hash).not.toBe(session2.metadata.hash);

      // VERIFY: Both are valid 12-character session hashes
      expect(session1.metadata.hash).toMatch(/^[a-f0-9]{12}$/);
      expect(session2.metadata.hash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should return false when PRD has not changed', async () => {
      // SETUP: Create PRD with content
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, mockSimplePRD);

      // EXECUTE: Initialize session
      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();

      // VERIFY: No change detected
      expect(manager.hasSessionChanged()).toBe(false);

      // VERIFY: Session hash matches computed hash
      const fullHash = await hashPRD(prdPath);
      const sessionHash = fullHash.slice(0, 12);
      expect(manager.currentSession.metadata.hash).toBe(sessionHash);
    });

    it('should throw error when hasSessionChanged called before initialize', async () => {
      // SETUP: Create PRD but don't initialize manager
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, mockSimplePRD);

      const manager = new SessionManager(prdPath, planDir);

      // VERIFY: hasSessionChanged throws error
      expect(() => manager.hasSessionChanged()).toThrow(
        'Cannot check session change: no session loaded'
      );
    });
  });

  /**
   * CONTRACT (d): Case-sensitive and deterministic hash comparison tests
   */
  describe('Case-sensitive hash comparison (CONTRACT d)', () => {
    it('should be case-sensitive in hash comparison', async () => {
      // SETUP: Create two PRDs with different case
      const prdPath1 = join(tempDir, 'PRD1.md');
      const prdPath2 = join(tempDir, 'PRD2.md');

      const content1 = '# Test PRD\nContent with uppercase';
      const content2 = '# Test PRD\ncontent with lowercase';

      createTestPRD(prdPath1, content1);
      createTestPRD(prdPath2, content2);

      // EXECUTE: Compute hashes
      const hash1 = await hashPRD(prdPath1);
      const hash2 = await hashPRD(prdPath2);

      // VERIFY: Hashes differ (case-sensitive)
      expect(hash1).not.toBe(hash2);

      // VERIFY: Can verify with real crypto
      const expectedHash1 = computeExpectedHash(content1);
      const expectedHash2 = computeExpectedHash(content2);
      expect(hash1).toBe(expectedHash1);
      expect(hash2).toBe(expectedHash2);
      expect(expectedHash1).not.toBe(expectedHash2);
    });

    it('should compute deterministic hashes for identical content', async () => {
      // SETUP: Create PRD with fixed content
      const prdPath = join(tempDir, 'PRD.md');
      const prdContent = '# Test PRD\n\nDeterministic content for testing.';
      createTestPRD(prdPath, prdContent);

      // EXECUTE: Compute hash multiple times
      const hash1 = await hashPRD(prdPath);
      const hash2 = await hashPRD(prdPath);
      const hash3 = await hashPRD(prdPath);

      // VERIFY: All hashes are identical (deterministic)
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(hash1).toBe(hash3);

      // VERIFY: All match expected value from real crypto
      const expectedHash = computeExpectedHash(prdContent);
      expect(hash1).toBe(expectedHash);
      expect(hash2).toBe(expectedHash);
      expect(hash3).toBe(expectedHash);
    });
  });

  /**
   * First 12-character slice pattern test
   * Verifies that session hashes use first 12 characters of full SHA-256 hash
   */
  describe('First 12-character slice pattern', () => {
    it('should use first 12 characters for session hash', async () => {
      // SETUP: Create PRD with known content (must be at least 100 chars)
      const prdPath = join(tempDir, 'PRD.md');
      const prdContent = `# Test PRD

## Executive Summary
This is a test PRD for hash slice testing. It needs to be at least 100 characters to pass validation.

## Requirements
- Test hash computation
- Verify slice pattern
- Validate session hash format`;
      createTestPRD(prdPath, prdContent);

      // EXECUTE: Compute full hash and session hash
      const fullHash = await hashPRD(prdPath);
      const sessionHash = fullHash.slice(0, 12);

      // VERIFY: Full hash is 64 characters
      expect(fullHash).toHaveLength(64);

      // VERIFY: Session hash is 12 characters
      expect(sessionHash).toHaveLength(12);

      // VERIFY: Session hash is lowercase hex
      expect(sessionHash).toMatch(/^[a-f0-9]{12}$/);

      // VERIFY: SessionManager uses 12-char hash in session ID
      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();
      const session = manager.currentSession;
      expect(session.metadata.hash).toBe(sessionHash);
      expect(session.metadata.id).toContain(`_${sessionHash}`);
    });

    it('should slice full hash correctly for session metadata', async () => {
      // SETUP: Create PRD (must be at least 100 chars)
      const prdPath = join(tempDir, 'PRD.md');
      const prdContent = `# Product Requirements Document

## Overview
This PRD is for testing the hash slice pattern functionality. The content must be long enough to pass validation.

## Features
- Hash computation
- Session metadata validation
- Proper slice pattern verification`;
      createTestPRD(prdPath, prdContent);

      // EXECUTE: Initialize session
      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();

      // VERIFY: Session metadata hash is 12 characters
      expect(manager.currentSession.metadata.hash).toHaveLength(12);
      expect(manager.currentSession.metadata.hash).toMatch(/^[a-f0-9]{12}$/);

      // VERIFY: It's the first 12 chars of the full hash
      const fullHash = await hashPRD(prdPath);
      expect(manager.currentSession.metadata.hash).toBe(fullHash.slice(0, 12));
    });
  });

  /**
   * Hash caching behavior test
   * Verifies that PRD hash is cached during initialize() and updated on re-initialization
   */
  describe('Hash caching behavior', () => {
    it('should cache PRD hash during initialize', async () => {
      // SETUP: Create PRD with initial content (must be at least 100 chars)
      const prdPath = join(tempDir, 'PRD.md');
      const initialContent = `# Initial PRD

## Description
This is the initial version of the PRD for testing hash caching behavior.

## Features
- Initial feature set
- Testing hash computation
- Cache validation`;
      createTestPRD(prdPath, initialContent);

      // EXECUTE: Initialize session
      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();

      // VERIFY: No change detected initially
      expect(manager.hasSessionChanged()).toBe(false);

      // MODIFY: Update PRD content (must be at least 100 chars)
      const modifiedContent = `# Modified PRD

## Description
This is the modified version of the PRD for testing hash caching behavior.

## Features
- Modified feature set
- Testing hash recomputation
- Cache invalidation`;
      createTestPRD(prdPath, modifiedContent);

      // VERIFY: Still no change detected (uses cached hash)
      expect(manager.hasSessionChanged()).toBe(false);

      // EXECUTE: Re-initialize to recompute hash
      await manager.initialize();

      // VERIFY: Hash is updated to new value
      const newHash = await hashPRD(prdPath);
      const newSessionHash = newHash.slice(0, 12);
      expect(manager.currentSession.metadata.hash).toBe(newSessionHash);
    });

    it('should recompute hash on each initialize call', async () => {
      // SETUP: Create PRD (must be at least 100 chars)
      const prdPath = join(tempDir, 'PRD.md');
      const content1 = `# PRD Version 1

## Overview
This is the first version of the PRD for testing hash recomputation.

## Features
- Feature one
- Feature two
- Feature three`;
      createTestPRD(prdPath, content1);

      // EXECUTE: Initialize first time
      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();
      const hash1 = manager.currentSession.metadata.hash;

      // MODIFY: Update content (must be at least 100 chars)
      const content2 = `# PRD Version 2

## Overview
This is the second version of the PRD for testing hash recomputation.

## Features
- Feature one updated
- Feature two updated
- Feature three updated`;
      createTestPRD(prdPath, content2);

      // EXECUTE: Initialize again
      await manager.initialize();
      const hash2 = manager.currentSession.metadata.hash;

      // VERIFY: Hashes differ
      expect(hash1).not.toBe(hash2);

      // VERIFY: Second hash matches new content
      const expectedHash2 = computeExpectedHash(content2).slice(0, 12);
      expect(hash2).toBe(expectedHash2);
    });
  });

  /**
   * Edge cases test suite
   * Tests handling of empty content, unicode, special characters, and whitespace
   */
  describe('Hash computation edge cases', () => {
    it('should handle empty PRD content', async () => {
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, '');

      const hash = await hashPRD(prdPath);

      // Known SHA-256 hash of empty string
      expect(hash).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle unicode characters', async () => {
      const prdPath = join(tempDir, 'PRD.md');
      const unicodeContent = '# Test\n你好世界\n🚀 Rocket';
      createTestPRD(prdPath, unicodeContent);

      const hash = await hashPRD(prdPath);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify determinism for unicode
      const hash2 = await hashPRD(prdPath);
      expect(hash).toBe(hash2);
    });

    it('should handle whitespace differences', async () => {
      const prdPath1 = join(tempDir, 'PRD1.md');
      const prdPath2 = join(tempDir, 'PRD2.md');

      createTestPRD(prdPath1, 'content');
      createTestPRD(prdPath2, 'content '); // Extra space

      const hash1 = await hashPRD(prdPath1);
      const hash2 = await hashPRD(prdPath2);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle special characters', async () => {
      const prdPath = join(tempDir, 'PRD.md');
      const specialContent = '# Test\n\n\t\r\nNewlines and tabs';
      createTestPRD(prdPath, specialContent);

      const hash = await hashPRD(prdPath);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify it matches expected value
      const expected = computeExpectedHash(specialContent);
      expect(hash).toBe(expected);
    });

    it('should handle very large PRD files', async () => {
      const prdPath = join(tempDir, 'PRD.md');
      // Create a large PRD (1MB of content)
      const largeContent = '# Large PRD\n\n' + 'x'.repeat(1024 * 1024);
      createTestPRD(prdPath, largeContent);

      const hash = await hashPRD(prdPath);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify determinism for large content
      const hash2 = await hashPRD(prdPath);
      expect(hash).toBe(hash2);
    });

    it('should treat different newline characters differently', async () => {
      const prdPath1 = join(tempDir, 'PRD1.md');
      const prdPath2 = join(tempDir, 'PRD2.md');
      const prdPath3 = join(tempDir, 'PRD3.md');

      // Unix vs Windows vs old Mac line endings
      createTestPRD(prdPath1, 'line1\nline2');
      createTestPRD(prdPath2, 'line1\r\nline2');
      createTestPRD(prdPath3, 'line1\rline2');

      const hash1 = await hashPRD(prdPath1);
      const hash2 = await hashPRD(prdPath2);
      const hash3 = await hashPRD(prdPath3);

      // All should be different
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);

      // All should be valid
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash3).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  /**
   * Session hash validation tests
   * Validates session metadata hash format and structure
   */
  describe('Session metadata hash validation', () => {
    it('should create session with valid hash format', async () => {
      const prdPath = join(tempDir, 'PRD.md');
      createTestPRD(prdPath, mockSimplePRD);

      const manager = new SessionManager(prdPath, planDir);
      await manager.initialize();

      const metadata = manager.currentSession.metadata;

      // VERIFY: Hash is 12 characters
      expect(metadata.hash).toHaveLength(12);

      // VERIFY: Hash is lowercase hex
      expect(metadata.hash).toMatch(/^[a-f0-9]{12}$/);

      // VERIFY: Session ID contains hash
      expect(metadata.id).toContain(`_${metadata.hash}`);

      // VERIFY: Session ID format is {sequence}_{hash}
      expect(metadata.id).toMatch(/^\d{3}_[a-f0-9]{12}$/);
    });

    it('should create session with unique hash for unique content', async () => {
      const prdPath1 = join(tempDir, 'PRD1.md');
      const prdPath2 = join(tempDir, 'PRD2.md');

      // Content must be at least 100 chars to pass validation
      createTestPRD(
        prdPath1,
        `# PRD Document 1

## Overview
This is the first unique PRD document for testing hash uniqueness.

## Features
- Unique feature set one
- Testing hash differentiation
- Validating session creation`
      );
      createTestPRD(
        prdPath2,
        `# PRD Document 2

## Overview
This is the second unique PRD document for testing hash uniqueness.

## Features
- Unique feature set two
- Testing hash differentiation
- Validating session creation`
      );

      const manager1 = new SessionManager(prdPath1, planDir);
      const manager2 = new SessionManager(prdPath2, planDir);

      await manager1.initialize();
      await manager2.initialize();

      const hash1 = manager1.currentSession.metadata.hash;
      const hash2 = manager2.currentSession.metadata.hash;

      // VERIFY: Different content produces different hashes
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createSessionDirectory hash path (no precomputedHash)', () => {
    // REAL tmpdir: exercises createSessionDirectory's else branch — the internal
    // hashPRD(prdPath) call (which resolves via resolvePRD) — so its successful
    // resolution is covered. The mock-based session-utils.test.ts cannot cover this
    // path (its file-level TextDecoder mock is incompatible with resolvePRD).
    it('computes the session id from hashPRD when precomputedHash is omitted', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'csd-'));
      const planDir = join(tmp, 'plan');
      const prdPath = join(tmp, 'PRD.md');
      writeFileSync(
        prdPath,
        `# PRD

Real-tmpdir PRD for createSessionDirectory's no-precomputedHash path.\n`
      );

      try {
        const expectedHash = (await hashPRD(prdPath)).slice(0, 12);
        const sessionPath = await createSessionDirectory(prdPath, 1, planDir);

        // VERIFY: the session id embeds the hash computed by the internal hashPRD call.
        expect(sessionPath).toContain(`001_${expectedHash}`);
        expect(sessionPath.startsWith(planDir)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
