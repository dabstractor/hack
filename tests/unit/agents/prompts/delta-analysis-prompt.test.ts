/**
 * Unit tests for delta analysis prompt generator
 *
 * @remarks
 * Tests validate that createDeltaAnalysisPrompt() correctly constructs
 * prompts with PRD comparison data and completed tasks context.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { createDeltaAnalysisPrompt } from '../../../../src/agents/prompts/delta-analysis-prompt.js';
import { DELTA_PRD_PROMPT } from '../../../../src/agents/prompts.js';

// Test fixtures
const mockOldPRD = `
# Phase 1: Foundation

## P1.M1.T1: Initialize Project
Set up the project structure.

## P1.M2.T1: Define Models
Create data models.
`;

const mockNewPRD = `
# Phase 1: Foundation

## P1.M1.T1: Initialize Project
Set up the project structure with TypeScript.

## P1.M2.T1: Define Models
Create data models with Zod validation.

# Phase 2: Core System

## P2.M1.T1: Implement Agent System
Build the agent framework.
`;

const mockCompletedTaskIds = ['P1.M1.T1', 'P1.M2.T1'];

describe('agents/prompts/delta-analysis-prompt', () => {
  describe('createDeltaAnalysisPrompt', () => {
    it('should return a Prompt object with correct structure', () => {
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        mockCompletedTaskIds
      );

      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include old PRD in user prompt', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.user).toContain('## Previous PRD');
      expect(prompt.user).toContain(mockOldPRD);
    });

    it('should include new PRD in user prompt', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.user).toContain('## Current PRD');
      expect(prompt.user).toContain(mockNewPRD);
    });

    it('should include completed tasks when provided', () => {
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        mockCompletedTaskIds
      );
      expect(prompt.user).toContain('## Completed Tasks');
      expect(prompt.user).toContain('P1.M1.T1');
      expect(prompt.user).toContain('P1.M2.T1');
    });

    it('should omit completed tasks section when not provided', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.user).not.toContain('## Completed Tasks');
    });

    it('should omit completed tasks section when empty array provided', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD, []);
      expect(prompt.user).not.toContain('## Completed Tasks');
    });

    it('should include system prompt content', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.systemOverride).toContain('PRD Delta Analysis');
      expect(prompt.systemOverride).toContain('Requirements Change Analyst');
    });

    it('should have responseFormat configured', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.responseFormat).toBeDefined();
    });

    it('should have enableReflection set to true', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.enableReflection).toBe(true);
    });

    it('should handle empty PRD strings', () => {
      const prompt = createDeltaAnalysisPrompt('', '');
      expect(prompt).toBeDefined();
      expect(prompt.user).toContain('## Previous PRD');
      expect(prompt.user).toContain('## Current PRD');
    });

    it('should include all completed task IDs in the prompt', () => {
      const completedIds = ['P1.M1.T1', 'P1.M2.T1', 'P2.M1.T1'];
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        completedIds
      );

      for (const id of completedIds) {
        expect(prompt.user).toContain(id);
      }
    });

    it('should include preservation message in completed tasks section', () => {
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        mockCompletedTaskIds
      );
      expect(prompt.user).toContain(
        'should be preserved unless critically affected'
      );
    });

    it('should handle single completed task ID', () => {
      const singleTask = ['P1.M1.T1'];
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        singleTask
      );
      expect(prompt.user).toContain('P1.M1.T1');
      expect(prompt.user).toContain('## Completed Tasks');
    });
  });

  describe('prompt content structure', () => {
    it('should have PRD sections in correct order', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      const userPrompt = prompt.user;

      const previousPrdIndex = userPrompt.indexOf('## Previous PRD');
      const currentPrdIndex = userPrompt.indexOf('## Current PRD');

      expect(previousPrdIndex).toBeGreaterThanOrEqual(0);
      expect(currentPrdIndex).toBeGreaterThanOrEqual(0);
      expect(previousPrdIndex).toBeLessThan(currentPrdIndex);
    });

    it('should place completed tasks after current PRD', () => {
      const prompt = createDeltaAnalysisPrompt(
        mockOldPRD,
        mockNewPRD,
        mockCompletedTaskIds
      );
      const userPrompt = prompt.user;

      const completedTasksIndex = userPrompt.indexOf('## Completed Tasks');
      const currentPrdIndex = userPrompt.indexOf('## Current PRD');

      expect(completedTasksIndex).toBeGreaterThan(currentPrdIndex);
    });

    it('should include separator before system prompt', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.user).toContain('---');
    });
  });

  describe('system prompt validation', () => {
    it('should include change categories', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.systemOverride).toContain('Semantic Changes');
      expect(prompt.systemOverride).toContain('Syntactic Changes');
    });

    it('should include output format specification', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.systemOverride).toContain('Output Format');
      expect(prompt.systemOverride).toContain('changes');
      expect(prompt.systemOverride).toContain('patchInstructions');
      expect(prompt.systemOverride).toContain('taskIds');
    });

    it('should include critical rules', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.systemOverride).toContain('Critical Rules');
      expect(prompt.systemOverride).toContain('Be Conservative');
      expect(prompt.systemOverride).toContain('Preserve Completed Work');
    });

    it('should include few-shot examples', () => {
      const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
      expect(prompt.systemOverride).toContain('Few-Shot Examples');
      expect(prompt.systemOverride).toContain('Example 1:');
    });
  });

  describe('DELTA_PRD_PROMPT doc-impact declaration (PRD §6.4)', () => {
    it('should require each affected delta item to declare its documentation impact', () => {
      expect(DELTA_PRD_PROMPT).toMatch(/doc.?impact declaration/i);
      expect(DELTA_PRD_PROMPT).toMatch(/declare its documentation impact/i);
    });

    it('should specify Mode A via a DOCS: line (per-item doc)', () => {
      expect(DELTA_PRD_PROMPT).toMatch(/Mode A/i);
      expect(DELTA_PRD_PROMPT).toContain('DOCS:');
    });

    it('should specify Mode B as a changeset-level note', () => {
      expect(DELTA_PRD_PROMPT).toMatch(/Mode B/i);
      expect(DELTA_PRD_PROMPT).toMatch(/changeset-level|changeset level/i);
    });

    it('should reference the §6.1 two-mode rule', () => {
      expect(DELTA_PRD_PROMPT).toMatch(/§6.1|two-mode/i);
    });
  });
});
