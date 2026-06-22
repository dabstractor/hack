/**
 * PRD validation utilities for detecting missing, empty, and malformed PRDs
 *
 * @module utils/prd-validator
 *
 * @remarks
 * Provides comprehensive PRD validation with helpful error messages.
 * Detects missing files, empty content, and missing required sections.
 * Returns structured validation results with actionable suggestions.
 *
 * @example
 * ```typescript
 * import { PRDValidator } from './utils/prd-validator.js';
 *
 * const validator = new PRDValidator();
 * const result = await validator.validate('./PRD.md');
 *
 * if (!result.valid) {
 *   console.error('PRD validation failed:');
 *   for (const issue of result.issues) {
 *     console.error(`  [${issue.severity}] ${issue.message}`);
 *   }
 * }
 * ```
 */

import { parsePRDSections, type PRDSection } from '../core/prd-differ.js';
import { readUTF8FileStrict } from '../core/session-utils.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Validation severity levels
 */
export type ValidationSeverity = 'critical' | 'warning' | 'info';

/**
 * Validation category types
 */
export type ValidationCategory =
  | 'existence'
  | 'structure'
  | 'content'
  | 'quality';

/**
 * Single validation issue with actionable feedback
 *
 * @remarks
 * Represents a single validation problem found during PRD validation.
 * Includes severity, category, message, and optional suggestions for fixing.
 */
export interface ValidationIssue {
  /** Severity of the issue */
  severity: ValidationSeverity;

  /** Category of validation rule */
  category: ValidationCategory;

  /** Human-readable error message */
  message: string;

  /** Specific field or section that failed */
  field?: string;

  /** Expected value/format */
  expected?: string;

  /** Actual value found */
  actual?: string;

  /** Actionable suggestion for fixing */
  suggestion?: string;

  /** Reference to documentation or example */
  reference?: string;
}

/**
 * PRD validation options
 *
 * @remarks
 * Configurable options for PRD validation behavior.
 * Allows customization of content length thresholds and required sections.
 */
export interface PRDValidationOptions {
  /** Minimum content length in characters (default: 100) */
  minContentLength?: number;

  /** Required section titles (default: built-in list) */
  requiredSections?: readonly string[];

  /** Whether to include quality checks (default: false for now) */
  includeQualityChecks?: boolean;

  /** Whether to include suggestions (default: true) */
  includeSuggestions?: boolean;
}

/**
 * Validation result object
 *
 * @remarks
 * Complete result from PRD validation including validity status,
 * all issues found, summary counts, and timestamp.
 */
export interface ValidationResult {
  /** Overall validity */
  valid: boolean;

  /** PRD file path (absolute) */
  prdPath: string;

  /** All validation issues found */
  issues: readonly ValidationIssue[];

  /** Summary counts by severity */
  summary: {
    critical: number;
    warning: number;
    info: number;
  };

  /** Timestamp of validation */
  validatedAt: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default required PRD sections
 *
 * @remarks
 * These sections must be present in a valid PRD.
 * Section titles are case-sensitive and must match exactly.
 */
const DEFAULT_REQUIRED_SECTIONS = [
  '## Executive Summary',
  '## Functional Requirements',
  '## User Workflows',
] as const;

// ============================================================================
// PRD VALIDATOR CLASS
// ============================================================================

/**
 * PRD Validator for detecting missing, empty, and malformed PRDs
 *
 * @remarks
 * Provides comprehensive PRD validation with:
 * - File existence checking with helpful error messages
 * - Content length validation (minimum 100 characters)
 * - Required sections validation
 * - Actionable suggestions for fixing issues
 *
 * @example
 * ```typescript
 * const validator = new PRDValidator();
 * const result = await validator.validate('./PRD.md');
 *
 * console.log(`Valid: ${result.valid}`);
 * console.log(`Critical: ${result.summary.critical}`);
 * console.log(`Warnings: ${result.summary.warning}`);
 * ```
 */
export class PRDValidator {
  /**
   * Validates a PRD file for existence, content, and structure
   *
   * @param prdPath - Path to PRD file (relative or absolute)
   * @param options - Validation options
   * @returns Validation result with issues and summary
   *
   * @remarks
   * Performs validation in stages:
   * 1. File existence (critical - early return if fails)
   * 2. Content length (critical - early return if fails)
   * 3. Required sections (warning - collects all issues)
   *
   * Critical issues stop validation early; warnings collect all issues.
   */
  async validate(
    prdPath: string,
    options: PRDValidationOptions = {}
  ): Promise<ValidationResult> {
    const resolvedPath = resolve(prdPath);
    const issues: ValidationIssue[] = [];
    const startTime = Date.now();

    // 1. File existence validation (critical - early return)
    const fileIssue = await this.#validateFileExists(resolvedPath);
    if (fileIssue) {
      return this.#buildResult(resolvedPath, [fileIssue], startTime);
    }

    // 2. Read PRD content
    const content = await readUTF8FileStrict(resolvedPath, 'validate PRD');

    // 3. Content length validation (critical - early return)
    const lengthIssue = this.#validateContentLength(content, options);
    if (lengthIssue) {
      return this.#buildResult(resolvedPath, [lengthIssue], startTime);
    }

    // 4. Parse PRD sections
    const sections = parsePRDSections(content);

    // 5. Required sections validation (warning - continue for full report)
    const sectionIssues = this.#validateRequiredSections(sections, options);
    issues.push(...sectionIssues);

    return this.#buildResult(resolvedPath, issues, startTime);
  }

  /**
   * Validates PRD file exists and is a file (not directory)
   *
   * @param prdPath - Absolute path to PRD file
   * @returns Validation issue if invalid, null if valid
   * @private
   */
  async #validateFileExists(prdPath: string): Promise<ValidationIssue | null> {
    try {
      const stats = await stat(prdPath);

      // Check if path is a directory
      if (stats.isDirectory()) {
        return {
          severity: 'critical',
          category: 'existence',
          message: `PRD path is a directory, not a file: ${prdPath}`,
          field: 'prdPath',
          expected: 'Path to a markdown file',
          actual: prdPath,
          suggestion: 'Provide the path to your PRD.md file, not a directory',
        };
      }

      return null; // File exists and is a file
    } catch (error) {
      // File doesn't exist
      const errorCode = (error as NodeJS.ErrnoException).code;
      const isNotFound = errorCode === 'ENOENT';

      return {
        severity: 'critical',
        category: 'existence',
        message: isNotFound
          ? `PRD file not found: ${prdPath}`
          : `Cannot access PRD file: ${prdPath}`,
        field: 'prdPath',
        expected: 'Existing PRD markdown file',
        actual: prdPath,
        suggestion: isNotFound
          ? `Check that the path is correct. Current directory: ${process.cwd()}`
          : `Check file permissions for: ${prdPath}`,
      };
    }
  }

  /**
   * Validates PRD content meets minimum length requirement
   *
   * @param content - PRD content string
   * @param options - Validation options
   * @returns Validation issue if too short, null if valid
   * @private
   */
  #validateContentLength(
    content: string,
    options: PRDValidationOptions
  ): ValidationIssue | null {
    const minLength = options.minContentLength ?? 100;
    const actualLength = content.trim().length;

    if (actualLength < minLength) {
      return {
        severity: 'critical',
        category: 'content',
        message: `PRD content is too short (${actualLength} chars). Minimum: ${minLength} chars`,
        field: 'content',
        expected: `At least ${minLength} characters`,
        actual: `${actualLength} characters`,
        suggestion:
          'Add more content to your PRD. Include sections like Executive Summary, Functional Requirements, etc.',
        reference: 'See PRD.md in the project root for a template',
      };
    }

    return null;
  }

  /**
   * Validates required sections are present in PRD
   *
   * @param sections - Parsed PRD sections
   * @param options - Validation options
   * @returns Array of validation issues for missing sections
   * @private
   */
  #validateRequiredSections(
    sections: PRDSection[],
    options: PRDValidationOptions
  ): ValidationIssue[] {
    const requiredSections =
      options.requiredSections ?? DEFAULT_REQUIRED_SECTIONS;
    const issues: ValidationIssue[] = [];

    // Extract section titles with ## prefix for exact matching
    const presentTitles = new Set(sections.map(s => `## ${s.title}`));

    // Helper: strip leading numbering like "1. " or "5. " from a heading
    const stripNumbering = (heading: string): string =>
      heading.replace(/^(##\s+)?\d+\.\s+/, '$1');

    // Check each required section — match against both exact and numbered forms
    for (const required of requiredSections) {
      // required is e.g. "## Executive Summary"
      // Present titles may be e.g. "## 1. Executive Summary"
      // Strip numbering from both sides for comparison
      const strippedRequired = stripNumbering(required);

      const hasMatch =
        presentTitles.has(required) ||
        sections.some(
          s => stripNumbering(`## ${s.title}`) === strippedRequired
        );

      if (!hasMatch) {
        // Extract section name without ## prefix for message
        const sectionName = required.replace(/^##\s+/, '');

        issues.push({
          severity: 'warning',
          category: 'structure',
          message: `Missing required section: ${required}`,
          field: `sections.${sectionName}`,
          expected: `Section with title "${required}"`,
          actual: 'Section not found',
          suggestion: `Add a "${required}" section to your PRD`,
          reference: 'See PRD.md in the project root for an example',
        });
      }
    }

    return issues;
  }

  /**
   * Builds validation result from issues
   *
   * @param prdPath - Absolute path to PRD
   * @param issues - Array of validation issues
   * @param startTime - Validation start timestamp
   * @returns Complete validation result
   * @private
   */
  #buildResult(
    prdPath: string,
    issues: ValidationIssue[],
    startTime: number
  ): ValidationResult {
    // Count issues by severity
    const summary = {
      critical: issues.filter(i => i.severity === 'critical').length,
      warning: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
    };

    // Determine overall validity (critical issues = invalid)
    const valid = summary.critical === 0;

    return {
      valid,
      prdPath,
      issues,
      summary,
      validatedAt: new Date(startTime),
    };
  }
}

/**
 * Default export of PRDValidator class
 */
export default PRDValidator;
