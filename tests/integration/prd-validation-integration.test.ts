/**
 * Integration tests for PRD validation functionality
 *
 * @remarks
 * These tests verify the end-to-end PRD validation functionality including:
 * 1. PRDValidator directly with real files
 * 2. SessionManager.initialize() with PRD validation
 * 3. Error handling and validation feedback
 */

import { describe, expect, it } from 'vitest';
import { PRDValidator } from '../../src/utils/prd-validator.js';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('PRD Validation Integration Tests', () => {
  const testDir = resolve('tests', 'tmp', 'integration-prd-validation');

  // Clean up before and after tests
  async function cleanup() {
    await rm(testDir, { recursive: true, force: true });
  }

  beforeEach(async () => {
    await cleanup();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('PRDValidator with real files', () => {
    it('should validate PRD.md from project root', async () => {
      const validator = new PRDValidator();
      const result = await validator.validate('PRD.md');

      // PRD.md should exist and be valid
      expect(result.prdPath).toContain('PRD.md');
      expect(result.summary.critical).toBe(0);
    });

    it('should detect missing PRD file', async () => {
      const validator = new PRDValidator();
      const result = await validator.validate('/nonexistent/path/to/PRD.md');

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBeGreaterThan(0);

      const issue = result.issues[0];
      if (issue) {
        expect(issue.severity).toBe('critical');
        expect(issue.category).toBe('existence');
      }
    });

    it('should detect empty PRD file', async () => {
      const emptyPRD = resolve(testDir, 'empty-prd.md');
      await writeFile(emptyPRD, '', 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(emptyPRD);

      expect(result.valid).toBe(false);
      expect(result.summary.critical).toBe(1);

      const issue = result.issues[0];
      if (issue) {
        expect(issue.category).toBe('content');
        expect(issue.message).toContain('too short');
      }
    });

    it('should validate complete PRD with all required sections', async () => {
      const completePRD = resolve(testDir, 'complete-prd.md');
      const content = `# Product Requirements Document

${'x'.repeat(200)}

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
      await writeFile(completePRD, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(completePRD);

      expect(result.valid).toBe(true);
      expect(result.summary.critical).toBe(0);
      expect(result.summary.warning).toBe(0);
    });

    it('should not warn about non-standard sections — PRDs are free-form', async () => {
      const incompletePRD = resolve(testDir, 'incomplete-prd.md');
      const content = `# Test PRD

${'x'.repeat(200)}

## Introduction

This PRD uses non-standard section headings.
`;
      await writeFile(incompletePRD, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(incompletePRD);

      // Valid with no structural warnings: section titles are not enforced.
      expect(result.valid).toBe(true);
      expect(result.summary.warning).toBe(0);

      const structureIssues = result.issues.filter(
        i => i.category === 'structure'
      );
      expect(structureIssues.length).toBe(0);
    });
  });

  describe('Validation result structure', () => {
    it('should return properly structured ValidationResult', async () => {
      const testPRD = resolve(testDir, 'structured-prd.md');
      const content = `# Test PRD

${'x'.repeat(200)}

## Executive Summary

Content.
`;
      await writeFile(testPRD, content, 'utf-8');

      const validator = new PRDValidator();
      const result = await validator.validate(testPRD);

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

      // Check summary structure
      expect(result.summary).toHaveProperty('critical');
      expect(result.summary).toHaveProperty('warning');
      expect(result.summary).toHaveProperty('info');
      expect(typeof result.summary.critical).toBe('number');
      expect(typeof result.summary.warning).toBe('number');
      expect(typeof result.summary.info).toBe('number');
    });
  });
});
