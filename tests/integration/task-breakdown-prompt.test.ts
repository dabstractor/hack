/**
 * Integration test for TASK_BREAKDOWN_PROMPT
 *
 * @remarks
 * Tests the complete TASK_BREAKDOWN_PROMPT constant structure and content
 * to ensure the architect agent receives complete, validated prompt definitions.
 *
 * This integration test validates:
 * - Prompt export and loading
 * - All 5 requirements from the contract definition:
 *   (a) Architect role and responsibilities
 *   (b) Research-driven architecture (spawn subagents)
 *   (c) Strict JSON output format
 *   (d) Implicit TDD approach
 *   (e) Context scope requirements
 * - Hierarchy definitions
 * - Process section
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link https://github.com/anthropics/claude-code | Claude Code}
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_BREAKDOWN_PROMPT } from '../../src/agents/prompts.js';

describe('integration/task-breakdown-prompt', () => {
  // CLEANUP: Always restore mocks after each test
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // PATTERN: Test suite 1 - Verify prompt export and loading
  describe('prompt export and loading', () => {
    it('should export TASK_BREAKDOWN_PROMPT as a string', () => {
      expect(typeof TASK_BREAKDOWN_PROMPT).toBe('string');
      expect(TASK_BREAKDOWN_PROMPT.length).toBeGreaterThan(100);
    });

    it('should be a non-empty template literal with markdown content', () => {
      expect(TASK_BREAKDOWN_PROMPT).toBeTruthy();
      expect(TASK_BREAKDOWN_PROMPT.trim()).not.toBe('');
      expect(TASK_BREAKDOWN_PROMPT).toContain('# LEAD TECHNICAL ARCHITECT');
    });
  });

  // PATTERN: Test suite 2 - Requirement (a) - Architect Role Definition
  describe('requirement (a): architect role definition', () => {
    it('should define Lead Technical Architect & Project Synthesizer role', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('LEAD TECHNICAL ARCHITECT');
      expect(TASK_BREAKDOWN_PROMPT).toContain('PROJECT SYNTHESIZER');
    });

    it('should define role context and goal with proper markdown headings', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('> **ROLE:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('> **CONTEXT:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('> **GOAL:**');
    });

    it('should specify the role represents a senior panel consensus', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('senior panel');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Security');
      expect(TASK_BREAKDOWN_PROMPT).toContain('DevOps');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Backend');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Frontend');
      expect(TASK_BREAKDOWN_PROMPT).toContain('QA');
    });

    it('should define the goal as validating PRD and decomposing into hierarchy', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('Validate the PRD');
      expect(TASK_BREAKDOWN_PROMPT).toContain('decompose');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Phase');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Milestone');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Task');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Subtask');
    });
  });

  // PATTERN: Test suite 3 - Requirement (b) - Research-Driven Architecture
  describe('requirement (b): research-driven architecture', () => {
    it('should have RESEARCH-DRIVEN ARCHITECTURE as new priority section', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('RESEARCH-DRIVEN ARCHITECTURE');
      expect(TASK_BREAKDOWN_PROMPT).toContain('NEW PRIORITY');
    });

    it('should require validation before breaking down', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('VALIDATE BEFORE BREAKING DOWN');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'You cannot plan what you do not understand'
      );
    });

    it('should specify spawning subagents for research', () => {
      // Wording updated when subagent usage was de-escalated to optional; the
      // capability is still described in the PROCESS section. Assert the CURRENT
      // verbatim literals (src/agents/prompts.ts:112-114).
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**RESEARCH (SPAWN & VALIDATE):**'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**Spawn** subagents to map the codebase and verify PRD feasibility.'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**Spawn** subagents to find external documentation for new tech.'
      );
    });

    it('should require reality check against codebase state', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('REALITY CHECK');
      expect(TASK_BREAKDOWN_PROMPT).toContain('current codebase state');
    });

    it('should specify storing findings in architecture directory', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('$SESSION_DIR/architecture/');
      expect(TASK_BREAKDOWN_PROMPT).toContain('PERSISTENCE');
    });
  });

  // PATTERN: Test suite 4 - Requirement (c) - Strict JSON Output Format
  describe('requirement (c): strict JSON output format', () => {
    it('should specify output to ./tasks.json file', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('./$TASKS_FILE');
      expect(TASK_BREAKDOWN_PROMPT).toContain('CURRENT WORKING DIRECTORY');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'Do NOT output JSON to the conversation'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('WRITE IT TO THE FILE');
    });

    it('should define JSON structure with backlog array', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"backlog": [');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"type": "Phase"');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"type": "Milestone"');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"type": "Task"');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"type": "Subtask"');
    });

    it('should include JSON schema for Phase with all required fields', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"id": "P[#]"');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"title":');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"status":');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"description":');
    });

    it('should include JSON schema for Milestone with nested tasks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"milestones": [');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"id": "P[#].M[#]"');
    });

    it('should include JSON schema for Task with nested subtasks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"tasks": [');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"id": "P[#].M[#].T[#]"');
    });

    it('should include JSON schema for Subtask with all required fields', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"subtasks": [');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"id": "P[#].M[#].T[#].S[#]"');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"story_points":');
      expect(TASK_BREAKDOWN_PROMPT).toContain('"dependencies":');
    });

    it('should include context_scope in the JSON schema', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('"context_scope":');
      expect(TASK_BREAKDOWN_PROMPT).toContain('CONTRACT DEFINITION:');
    });
  });

  // PATTERN: Test suite 5 - Requirement (d) - Implicit TDD Approach
  describe('requirement (d): implicit TDD approach', () => {
    it('should forbid separate test subtasks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**DO NOT** create subtasks for "Write Tests."'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('IMPLICIT TDD & QUALITY');
    });

    it('should define implied test-first workflow', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('IMPLIED WORKFLOW:');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'Write the failing test -> Implement the code -> Pass the test'
      );
    });

    it('should specify that code is not complete without tests', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('DEFINITION OF DONE');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'Code is not complete without tests'
      );
    });
  });

  // PATTERN: Test suite 6 - Requirement (e) - Context Scope Requirements
  describe('requirement (e): context scope requirements', () => {
    it('should define context scope blinder section', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('THE "CONTEXT SCOPE" BLINDER');
    });

    it('should specify INPUT/OUTPUT/MOCKING requirements', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('INPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'What specific data/interfaces are available'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('OUTPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'What exact interface does this subtask expose'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('MOCKING:');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'What external services must be mocked'
      );
    });

    it('should specify context_scope must be strict set of instructions', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('strict set of instructions');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'developer who cannot see the rest of the project'
      );
    });

    it('should include context_scope template in JSON schema example', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '"context_scope": "CONTRACT DEFINITION:'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('RESEARCH NOTE:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('INPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('LOGIC:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('OUTPUT:');
    });
  });

  // PATTERN: Test suite 7 - Hierarchy Definitions
  describe('hierarchy definitions', () => {
    it('should define four hierarchy levels with time scales', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('**PHASE:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Project-scope goals');
      expect(TASK_BREAKDOWN_PROMPT).toContain('_Weeks to months._');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**MILESTONE:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Key objectives within a Phase');
      expect(TASK_BREAKDOWN_PROMPT).toContain('_1 to 12 weeks._');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**TASK:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'Complete features within a Milestone'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('_Days to weeks._');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**SUBTASK:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Atomic implementation steps');
      expect(TASK_BREAKDOWN_PROMPT).toContain('0.5, 1, or 2 Story Points (SP)');
    });

    it('should specify subtask story point limits', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('0.5, 1, or 2 Story Points');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Max 2 SP');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'do not break subtasks down further than 2 SP'
      );
    });

    it('should have HIERARCHY DEFINITIONS section header', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('## HIERARCHY DEFINITIONS');
    });
  });

  // PATTERN: Test suite 8 - Process Section
  describe('process section', () => {
    it('should define ULTRATHINK & PLAN process', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('## PROCESS');
      expect(TASK_BREAKDOWN_PROMPT).toContain('ULTRATHINK & PLAN');
    });

    it('should specify 4-step process: ANALYZE, RESEARCH, DETERMINE, DECOMPOSE', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('**ANALYZE**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('the attached or referenced PRD');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**RESEARCH');
      expect(TASK_BREAKDOWN_PROMPT).toContain('(SPAWN & VALIDATE):');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**DETERMINE**');
      expect(TASK_BREAKDOWN_PROMPT).toContain('highest level of scope');

      expect(TASK_BREAKDOWN_PROMPT).toContain('**DECOMPOSE**');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'strictly downwards to the Subtask level'
      );
    });

    it('should specify research subagent spawning instructions', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**Spawn** subagents to map the codebase'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**Spawn** subagents to find external documentation'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**Store** findings in `$SESSION_DIR/architecture/`'
      );
    });

    it('should specify using research to populate context_scope', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'using your research to populate the `context_scope`'
      );
    });
  });

  // PATTERN: Test suite 9 - Coherence & Continuity Constraints
  describe('coherence & continuity constraints', () => {
    it('should require no vacuums - architectural flow', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('NO VACUUMS');
      expect(TASK_BREAKDOWN_PROMPT).toContain('architectural flow');
    });

    it('should require explicit handoffs between subtasks', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('EXPLICIT HANDOFFS');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Subtask A');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Subtask B');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'explicitly instructed to consume'
      );
    });

    it('should require strict references from research phase', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('STRICT REFERENCES');
      expect(TASK_BREAKDOWN_PROMPT).toContain('Reference specific file paths');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'confirmed during your **Research Phase**'
      );
    });
  });

  // PATTERN: Test suite 10 - Output Format Section
  describe('output format section', () => {
    it('should have OUTPUT FORMAT section', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('## OUTPUT FORMAT');
    });

    it('should specify CONSTRAINT for writing to file', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('**CONSTRAINT:**');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'MUST write the JSON to the file'
      );
    });

    it('should include JSON code block example', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('```json');
      expect(TASK_BREAKDOWN_PROMPT).toContain('```');
    });
  });

  // PATTERN: Test suite 11 - Sample output logging
  describe('sample output logging', () => {
    it('should log sample prompt content for inspection', () => {
      console.log('\n=== TASK_BREAKDOWN_PROMPT Sample Output ===');
      console.log('Prompt length:', TASK_BREAKDOWN_PROMPT.length);
      console.log('\n=== Prompt (first 500 chars) ===');
      console.log(TASK_BREAKDOWN_PROMPT.slice(0, 500) + '...');
      console.log('\n=== Key sections verification ===');
      console.log(
        '✓ Contains LEAD TECHNICAL ARCHITECT:',
        TASK_BREAKDOWN_PROMPT.includes('LEAD TECHNICAL ARCHITECT')
      );
      console.log(
        '✓ Contains HIERARCHY DEFINITIONS:',
        TASK_BREAKDOWN_PROMPT.includes('## HIERARCHY DEFINITIONS')
      );
      console.log(
        '✓ Contains RESEARCH-DRIVEN ARCHITECTURE:',
        TASK_BREAKDOWN_PROMPT.includes('RESEARCH-DRIVEN ARCHITECTURE')
      );
      console.log(
        '✓ Contains PROCESS section:',
        TASK_BREAKDOWN_PROMPT.includes('## PROCESS')
      );
      console.log(
        '✓ Contains OUTPUT FORMAT:',
        TASK_BREAKDOWN_PROMPT.includes('## OUTPUT FORMAT')
      );
      console.log(
        '✓ Contains JSON schema:',
        TASK_BREAKDOWN_PROMPT.includes('"backlog": [')
      );

      // VERIFY: All assertions pass
      expect(TASK_BREAKDOWN_PROMPT).toBeDefined();
      expect(TASK_BREAKDOWN_PROMPT.length).toBeGreaterThan(100);
    });
  });
});
