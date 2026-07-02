/**
 * Unit tests for PRD Validator
 *
 * @remarks
 * Tests validate PRD validation functionality including:
 * 1. File existence validation with helpful error messages
 * 2. Content length validation (minimum 100 characters)
 * 3. Required sections validation
 * 4. Validation result structure and summary
 * 5. Actionable suggestions in error messages
 * 6. Integration with SessionManager
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PRDValidator,
  type ValidationResult,
  type ValidationIssue,
  type PRDValidationOptions,
} from '../../../src/utils/prd-validator.js';

// =============================================================================
// TEST SETUP
// =============================================================================

describe('PRDValidator', () => {
  const testDir = resolve('tests', 'tmp', 'prd-validator-test');

  // Create test directory before each test
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  // Clean up test directory after each test
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ========================================================================
  // File existence validation tests
  // ========================================================================

  describe('File existence validation', () => {
    it('should return null when file exists', async () => {
      const testFile = resolve(testDir, 'exists.md');
      await writeFile(testFile, '# Test PRD\n\nSome content', 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // File exists validation should pass
      const fileIssues = result.issues.filter(i => i.category === 'existence');
      expect(fileIssues).toHaveLength(0);
    });

    it('should return critical issue when file does not exist', async () => {
      const nonExistentFile = resolve(testDir, 'does-not-exist.md');

      const validator = new PRDValidator();
      const result = await validator.validate(nonExistentFile);

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBe(1);

      const issue = result.issues[0] as ValidationIssue;
      expect(issue.severity).toBe('critical');
      expect(issue.category).toBe('existence');
      expect(issue.message).toContain('PRD file not found');
      expect(issue.field).toBe('prdPath');
      expect(issue.suggestion).toContain('Check that the path is correct');
    });

    it('should return critical issue when path is a directory', async () => {
      // Create the directory first
      const testDirPath = resolve(testDir, 'directory-path');
      await mkdir(testDirPath, { recursive: true });

      const validator = new PRDValidator();
      const result = await validator.validate(testDirPath);

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBe(1);

      const issue = result.issues[0] as ValidationIssue;
      expect(issue.severity).toBe('critical');
      expect(issue.category).toBe('existence');
      expect(issue.message).toContain('directory, not a file');
      expect(issue.suggestion).toContain('PRD.md file, not a directory');
    });
  });

  // ========================================================================
  // Content length validation tests
  // ========================================================================

  describe('Content length validation', () => {
    it('should validate PRD with sufficient content', async () => {
      const testFile = resolve(testDir, 'valid-length.md');
      const content =
        '# Test PRD\n\n'.repeat(10) +
        '## Executive Summary\n\nThis is a valid PRD with sufficient content to pass validation.\n\n';
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // Should have no content issues
      const contentIssues = result.issues.filter(i => i.category === 'content');
      expect(contentIssues).toHaveLength(0);
    });

    it('should return critical issue when PRD is too short (< 100 chars)', async () => {
      const testFile = resolve(testDir, 'too-short.md');
      await writeFile(testFile, '# Short', 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBe(1);

      const issue = result.issues[0] as ValidationIssue;
      expect(issue.severity).toBe('critical');
      expect(issue.category).toBe('content');
      expect(issue.message).toContain('too short');
      expect(issue.actual).toContain('characters');
      expect(issue.expected).toContain('100 characters');
      expect(issue.suggestion).toContain('Add more content');
      expect(issue.reference).toContain('PRD.md');
    });

    it('should accept PRD with exactly 100 characters', async () => {
      const testFile = resolve(testDir, 'exactly-100.md');
      // Create content that is exactly 100 characters when trimmed
      const content = 'x'.repeat(100);
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // Content length validation should pass (no critical issues from content)
      const contentIssues = result.issues.filter(i => i.category === 'content');
      expect(contentIssues).toHaveLength(0);
    });

    it('should use custom minContentLength option', async () => {
      const testFile = resolve(testDir, 'custom-length.md');
      await writeFile(testFile, 'x'.repeat(150), 'utf-8');

      const validator = new PRDValidator();
      const options: PRDValidationOptions = { minContentLength: 200 };
      const result = await validator.validate(testFile, options);

      expect(result.valid).toBe(false);

      const issue = result.issues[0] as ValidationIssue;
      expect(issue.category).toBe('content');
      expect(issue.expected).toContain('200 characters');
    });
  });

  // ========================================================================
  // Structure validation tests (free-form by design)
  // ========================================================================
  //
  // PRDs vary wildly in shape and the pipeline does not depend on any fixed set
  // of section headings, so the validator must NOT enforce specific sections.
  // It validates existence + minimum substance only (see PRDValidationOptions).

  describe('Structure validation (free-form)', () => {
    it('should not warn about missing sections — PRDs are free-form', async () => {
      const testFile = resolve(testDir, 'no-standard-sections.md');
      // A PRD that uses none of the historical "required" headings.
      const content = `# Test PRD

## Introduction

This PRD deliberately uses non-standard section headings.

${'x'.repeat(100)}

## Details

Some details here.
`;
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // No structural issues of any kind — section titles are not enforced.
      const structureIssues = result.issues.filter(
        i => i.category === 'structure'
      );
      expect(structureIssues).toHaveLength(0);
      expect(result.summary.warning).toBe(0);
      expect(result.valid).toBe(true);
    });

    it('should not warn about case/numbering differences in headings', async () => {
      const testFile = resolve(testDir, 'lowercase-sections.md');
      const content = `# Test PRD

## executive summary

${'x'.repeat(100)}

## functional requirements
`;
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      const structureIssues = result.issues.filter(
        i => i.category === 'structure'
      );
      expect(structureIssues).toHaveLength(0);
    });
  });

  // ========================================================================
  // Validation result structure tests
  // ========================================================================

  describe('ValidationResult structure', () => {
    it('should return complete ValidationResult object', async () => {
      const testFile = resolve(testDir, 'complete-result.md');
      const content = `# Test PRD

## Executive Summary

Content.

## Functional Requirements

Requirements.

## User Workflows

Workflows.
`;
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result: ValidationResult = await validator.validate(testFile);

      // Check result structure
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('prdPath');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('validatedAt');

      // Check types
      expect(typeof result.valid).toBe('boolean');
      expect(typeof result.prdPath).toBe('string');
      expect(Array.isArray(result.issues)).toBe(true);
      expect(typeof result.summary).toBe('object');
      expect(result.validatedAt).toBeInstanceOf(Date);
    });

    it('should provide correct summary counts', async () => {
      const testFile = resolve(testDir, 'summary-counts.md');
      const content = `# Test PRD

## Executive Summary

${'x'.repeat(100)}

Content here.
`;
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // No structural enforcement: a valid PRD yields no issues of any severity.
      expect(result.summary.critical).toBe(0);
      expect(result.summary.warning).toBe(0);
      expect(result.summary.info).toBe(0);
    });

    it('should include absolute path in result', async () => {
      const testFile = resolve(testDir, 'absolute-path.md');
      await writeFile(testFile, '# Test\n\n' + 'x'.repeat(100), 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      expect(result.prdPath).toBe(resolve(testFile));
    });
  });

  // ========================================================================
  // Integration tests
  // ========================================================================

  describe('Integration tests', () => {
    it('should validate complete valid PRD with no issues', async () => {
      const testFile = resolve(testDir, 'valid-prd.md');
      const content = `# Product Requirements Document

## Executive Summary

This document describes the requirements for a test product.

## Functional Requirements

1. The system shall authenticate users
2. The system shall store data
3. The system shall generate reports

## User Workflows

1. User logs in
2. User creates data
3. User views reports
`;
      await writeFile(testFile, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.summary.critical).toBe(0);
      expect(result.summary.warning).toBe(0);
      expect(result.summary.info).toBe(0);
    });

    it('should handle empty PRD gracefully', async () => {
      const testFile = resolve(testDir, 'empty-prd.md');
      await writeFile(testFile, '', 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBe(1);

      const issue = result.issues[0] as ValidationIssue;
      expect(issue.category).toBe('content');
    });

    it('should prioritize critical issues over warnings', async () => {
      const testFile = resolve(testDir, 'empty-missing-sections.md');
      await writeFile(testFile, '', 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testFile);

      // Empty PRD is critical - should return early
      expect(result.summary.critical).toBe(1);
      // Warnings for missing sections should not be checked
      expect(result.summary.warning).toBe(0);
    });
  });
});
