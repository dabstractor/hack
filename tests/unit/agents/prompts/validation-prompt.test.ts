/**
 * Unit tests for Validation prompt generator
 *
 * @remarks
 * Tests validate that `createValidationPrompt()` correctly generates the
 * FILE-AS-CONTRACT prompt that instructs the reasoning agent to AUTHOR
 * `validate.sh` (PRD §4.4 step 1). Mirrors
 * `tests/unit/agents/prompts/bug-hunt-prompt.test.ts`.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { createValidationPrompt } from '#/prompts/index.js';

const mockPRD = `# My Feature PRD

## Requirements

Build a user authentication system with login and registration.

## Success Criteria

- Users can register with email and password
- Users can login with credentials
`;

const mockCodebasePath = '/home/user/projects/my-app';
const mockOutputPath = '/plan/001_abc123/validate.sh';

describe('agents/prompts/validation-prompt', () => {
  describe('createValidationPrompt', () => {
    it('should return a Prompt object with correct structure', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      // Groundswell stores system prompt as systemOverride
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include the FILE-AS-CONTRACT deliverable banner with the output path', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      // The banner must name the exact file the agent writes.
      expect(prompt.user).toContain('DELIVERABLE');
      expect(prompt.user).toContain(mockOutputPath);
      expect(prompt.user).toContain('validate.sh');
    });

    it('should instruct the agent to write a runnable bash script with set -euo pipefail', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.user).toContain('#!/usr/bin/env bash');
      expect(prompt.user).toContain('set -euo pipefail');
      expect(prompt.user).toContain('EXIT NON-ZERO');
    });

    it('should reference the codebase path for tool discovery', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.user).toContain(mockCodebasePath);
      expect(prompt.user).toContain('package.json');
    });

    it('should include the PRD content in the user prompt', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.user).toContain('## PRD (pre-merged)');
      expect(prompt.user).toContain('My Feature PRD');
      expect(prompt.user).toContain(
        'Build a user authentication system with login and registration'
      );
    });

    it('should use VALIDATION_PROMPT as the system prompt', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.systemOverride).toContain('VALIDATION_AGENT');
      expect(prompt.systemOverride).toContain('validate.sh');
      expect(prompt.systemOverride).toContain('set -euo pipefail');
    });

    it('should declare the PRD is pre-merged (PRD §2.3) in the system prompt', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.systemOverride).toContain(
        'do not chase @include directives yourself'
      );
      expect(prompt.systemOverride).toContain(
        'already the complete, merged document'
      );
    });

    it('should have enableReflection set to true', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt.enableReflection).toBe(true);
    });

    it('should include a permissive responseFormat (file is the contract)', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      // responseFormat is z.unknown() — the FILE is the contract, not the chat reply.
      expect(prompt.responseFormat).toBeDefined();
    });

    it('should instruct the agent NOT to wrap the script in an unbounded timeout', () => {
      const prompt = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      // PRD §9.3.2: the pipeline's VALIDATION_TIMEOUT governs the budget;
      // an inner `timeout SECS` would surface as exit 124 (terminal).
      expect(prompt.user).toContain('VALIDATION_TIMEOUT');
    });

    it('should maintain consistent structure across multiple calls', () => {
      const prompt1 = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );
      const prompt2 = createValidationPrompt(
        mockPRD,
        mockCodebasePath,
        mockOutputPath
      );

      expect(prompt1.user).toBe(prompt2.user);
      expect(prompt1.systemOverride).toBe(prompt2.systemOverride);
      expect(prompt1.enableReflection).toBe(prompt2.enableReflection);
    });
  });
});
