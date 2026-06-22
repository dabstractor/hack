/**
 * Unit tests for prompts module
 *
 * @remarks
 * Tests validate that all prompt constants are properly exported
 * and contain expected content.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import {
  TASK_BREAKDOWN_PROMPT,
  PRP_BLUEPRINT_PROMPT,
  PRP_BUILDER_PROMPT,
  DELTA_PRD_PROMPT,
  DELTA_ANALYSIS_PROMPT,
  BUG_HUNT_PROMPT,
  PROMPTS,
  type PromptKey,
} from '../../../src/agents/prompts.js';

describe('agents/prompts', () => {
  describe('prompt exports', () => {
    it('should export TASK_BREAKDOWN_PROMPT as a string', () => {
      expect(typeof TASK_BREAKDOWN_PROMPT).toBe('string');
      expect(TASK_BREAKDOWN_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export PRP_BLUEPRINT_PROMPT as a string', () => {
      expect(typeof PRP_BLUEPRINT_PROMPT).toBe('string');
      expect(PRP_BLUEPRINT_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export PRP_BUILDER_PROMPT as a string', () => {
      expect(typeof PRP_BUILDER_PROMPT).toBe('string');
      expect(PRP_BUILDER_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export DELTA_PRD_PROMPT as a string', () => {
      expect(typeof DELTA_PRD_PROMPT).toBe('string');
      expect(DELTA_PRD_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export DELTA_ANALYSIS_PROMPT as a string', () => {
      expect(typeof DELTA_ANALYSIS_PROMPT).toBe('string');
      expect(DELTA_ANALYSIS_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export BUG_HUNT_PROMPT as a string', () => {
      expect(typeof BUG_HUNT_PROMPT).toBe('string');
      expect(BUG_HUNT_PROMPT.length).toBeGreaterThan(100);
    });
  });

  describe('prompt content validation', () => {
    it('TASK_BREAKDOWN_PROMPT should contain expected header', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('LEAD TECHNICAL ARCHITECT');
      expect(TASK_BREAKDOWN_PROMPT).toContain('PROJECT SYNTHESIZER');
    });

    it('PRP_BLUEPRINT_PROMPT should contain expected header', () => {
      expect(PRP_BLUEPRINT_PROMPT).toContain('Create PRP for Work Item');
      expect(PRP_BLUEPRINT_PROMPT).toContain('PRP Creation Mission');
    });

    it('PRP_BUILDER_PROMPT should contain expected header', () => {
      expect(PRP_BUILDER_PROMPT).toContain('Execute BASE PRP');
      expect(PRP_BUILDER_PROMPT).toContain('One-Pass Implementation Success');
    });

    it('DELTA_PRD_PROMPT should contain expected header', () => {
      expect(DELTA_PRD_PROMPT).toContain('Generate Delta PRD from Changes');
      expect(DELTA_PRD_PROMPT).toContain('delta PRD');
    });

    it('DELTA_ANALYSIS_PROMPT should contain expected header', () => {
      expect(DELTA_ANALYSIS_PROMPT).toContain('PRD Delta Analysis');
      expect(DELTA_ANALYSIS_PROMPT).toContain('Requirements Change Analyst');
    });

    it('BUG_HUNT_PROMPT should contain expected header', () => {
      expect(BUG_HUNT_PROMPT).toContain('Creative Bug Finding');
      expect(BUG_HUNT_PROMPT).toContain('End-to-End PRD Validation');
    });
  });

  describe('PROMPTS lookup object', () => {
    it('should contain all six prompts', () => {
      const keys = Object.keys(PROMPTS) as PromptKey[];
      expect(keys).toHaveLength(6);
      expect(keys).toContain('TASK_BREAKDOWN');
      expect(keys).toContain('PRP_BLUEPRINT');
      expect(keys).toContain('PRP_BUILDER');
      expect(keys).toContain('DELTA_PRD');
      expect(keys).toContain('DELTA_ANALYSIS');
      expect(keys).toContain('BUG_HUNT');
    });

    it('should provide type-safe access to prompts', () => {
      expect(PROMPTS.TASK_BREAKDOWN).toBe(TASK_BREAKDOWN_PROMPT);
      expect(PROMPTS.PRP_BLUEPRINT).toBe(PRP_BLUEPRINT_PROMPT);
      expect(PROMPTS.PRP_BUILDER).toBe(PRP_BUILDER_PROMPT);
      expect(PROMPTS.DELTA_PRD).toBe(DELTA_PRD_PROMPT);
      expect(PROMPTS.DELTA_ANALYSIS).toBe(DELTA_ANALYSIS_PROMPT);
      expect(PROMPTS.BUG_HUNT).toBe(BUG_HUNT_PROMPT);
    });

    it('should use const assertion for literal types', () => {
      // This verifies that 'as const' was applied correctly
      const key: PromptKey = 'TASK_BREAKDOWN'; // Should compile
      const prompt = PROMPTS[key];
      expect(typeof prompt).toBe('string');
    });
  });

  describe('formatting preservation', () => {
    it('TASK_BREAKDOWN_PROMPT should preserve markdown code blocks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('```json');
      expect(TASK_BREAKDOWN_PROMPT).toContain('```');
    });

    it('PRP_BLUEPRINT_PROMPT should contain template placeholders', () => {
      expect(PRP_BLUEPRINT_PROMPT).toContain('<item_title>');
      expect(PRP_BLUEPRINT_PROMPT).toContain('<item_description>');
    });

    it('PRP_BUILDER_PROMPT should contain PRP-README placeholder', () => {
      expect(PRP_BUILDER_PROMPT).toContain('<PRP-README>');
      expect(PRP_BUILDER_PROMPT).toContain('</PRP-README>');
    });

    it('BUG_HUNT_PROMPT should contain bash command placeholder', () => {
      expect(BUG_HUNT_PROMPT).toContain('$(cat "$PRD_FILE")');
      expect(BUG_HUNT_PROMPT).toContain('$(cat "$TASKS_FILE")');
    });
  });

  describe('two-mode documentation sync rule (PRD §6.1)', () => {
    it('should declare documentation is never a standalone subtask, mirroring implicit TDD', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('never a standalone subtask');
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/mirror/i);
    });

    it('should define Mode A (doc-with-work) requiring a DOCS: line inside context_scope', () => {
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode A/i);
      expect(TASK_BREAKDOWN_PROMPT).toContain('DOCS:');
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/context_scope/i);
      // Mode A category list (PRD §6.1):
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/config/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/public API/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/CLI/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/env var/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/exported type/i);
    });

    it('should define Mode B (changeset-level) as a final doc-sync task depending on all implementing subtasks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode B/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/changeset-level|changeset level/i);
      // Mode B category list (PRD §6.1):
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/README/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/overview/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/architecture summar/i);
      // Mode B is a FINAL task that depends on all implementing subtasks:
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/final/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/depend/i);
    });

    it('should include the decision rule (per-file -> Mode A; whole-feature/overview -> Mode B; when in doubt, both)', () => {
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/per-file|per file/i);
      expect(TASK_BREAKDOWN_PROMPT).toMatch(
        /whole-feature|whole feature|overview/i
      );
      expect(TASK_BREAKDOWN_PROMPT).toMatch(/when in doubt/i);
    });
  });
});
