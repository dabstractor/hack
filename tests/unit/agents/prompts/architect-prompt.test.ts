/**
 * Unit tests for Architect prompt generator
 *
 * @remarks
 * Tests validate that createArchitectPrompt() correctly generates the
 * Architect Agent prompt with the LEAD TECHNICAL ARCHITECT system persona
 * and the PRD content in the user prompt — prefixed with the PRD §2.3
 * pre-merged declaration so the agent does not chase @include directives.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { createArchitectPrompt } from '#/prompts/index.js';

// Test fixtures
const mockPRD = `# My Feature PRD

## Requirements

Build a user authentication system with login and registration.

## Success Criteria

- Users can register with email and password
- Users can login with credentials
`;

describe('agents/prompts/architect-prompt', () => {
  describe('createArchitectPrompt', () => {
    it('should return a Prompt object with correct structure', () => {
      // EXECUTE: Generate the prompt
      const prompt = createArchitectPrompt(mockPRD);

      // VERIFY: Prompt has expected properties
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      // Groundswell stores system prompt as systemOverride
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
    });

    it('should include PRD content in user prompt', () => {
      // EXECUTE: Generate the prompt
      const prompt = createArchitectPrompt(mockPRD);

      // VERIFY: PRD content is in the user prompt
      expect(prompt.user).toContain('My Feature PRD');
      expect(prompt.user).toContain(
        'Build a user authentication system with login and registration'
      );
    });

    it('should inject pre-merged PRD declaration before PRD content (PRD §2.3)', () => {
      // EXECUTE: Generate the prompt
      const prompt = createArchitectPrompt(mockPRD);

      // VERIFY: The declaration is present adjacent to (before) the PRD content
      expect(prompt.user).toContain(
        'do not chase @include directives yourself'
      );
      expect(prompt.user).toContain('already the complete, merged document');

      const declarationIndex = prompt.user.indexOf(
        'do not chase @include directives yourself'
      );
      const prdIndex = prompt.user.indexOf('My Feature PRD');
      expect(declarationIndex).toBeGreaterThanOrEqual(0);
      expect(prdIndex).toBeGreaterThan(declarationIndex);
    });

    it('should keep the architect system persona', () => {
      // EXECUTE: Generate the prompt
      const prompt = createArchitectPrompt(mockPRD);

      // VERIFY: System prompt is the LEAD TECHNICAL ARCHITECT persona
      expect(prompt.systemOverride).toContain('LEAD TECHNICAL ARCHITECT');
      expect(prompt.systemOverride).toContain('PROJECT SYNTHESIZER');
    });

    it('should declare the PRD is pre-merged in the system channel too (PRD §2.3)', () => {
      // EXECUTE: Generate the prompt
      const prompt = createArchitectPrompt(mockPRD);

      // VERIFY: The system persona (TASK_BREAKDOWN_PROMPT) also carries the
      // declaration transitively via the shared constant.
      expect(prompt.systemOverride).toContain(
        'do not chase @include directives yourself'
      );
    });

    it('should accept an optional sessionPath without dropping the declaration', () => {
      // EXECUTE: Generate the prompt with a session path
      const prompt = createArchitectPrompt(mockPRD, '/abs/plan/001_abc');

      // VERIFY: Declaration + PRD content are both still present
      expect(prompt.user).toContain(
        'do not chase @include directives yourself'
      );
      expect(prompt.user).toContain('My Feature PRD');
    });
  });
});
