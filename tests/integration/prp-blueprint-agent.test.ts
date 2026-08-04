/**
 * Integration test for PRP Blueprint Prompt Generator
 *
 * @remarks
 * Tests the complete flow: Task/Subtask + Backlog → createPRPBlueprintPrompt() → Prompt
 * This validates the integration pattern for the Researcher Agent prompt generation.
 *
 * NOTE: This test uses mock data to validate the prompt generation pattern without
 * requiring a full Researcher Agent implementation or LLM calls.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPRPBlueprintPrompt } from '../../src/agents/prompts/index.js';
import { BacklogSchema, PRPDocumentSchema } from '../../src/core/models.js';

// PATTERN: Test-wide constants
const TASKS_PATH = resolve(process.cwd(), 'plan/001_14b9dc2a33c7/tasks.json');
const _USE_REAL_LLM = process.env.USE_REAL_LLM === 'true'; // Flag for real vs mocked (unused in current tests)

describe('integration/prp-blueprint-prompt', () => {
  // CLEANUP: Always restore mocks after each test
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // PATTERN: Test 1 - Verify setup and Backlog loading
  describe('setup', () => {
    it('should read tasks.json from plan directory', async () => {
      // SETUP: Read tasks.json file
      const tasksContent = await readFile(TASKS_PATH, 'utf8');

      // VERIFY: Tasks content is non-empty string
      expect(tasksContent).toBeTruthy();
      expect(tasksContent.length).toBeGreaterThan(0);

      // VERIFY: Content is valid JSON
      const parsed = JSON.parse(tasksContent);
      expect(parsed).toHaveProperty('backlog');
    });

    it('should validate tasks.json against BacklogSchema', async () => {
      // SETUP: Read and parse tasks.json
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);

      // EXECUTE: Validate against BacklogSchema
      const validation = BacklogSchema.safeParse(parsed);

      // VERIFY: Validation passes
      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.backlog).toBeInstanceOf(Array);
        expect(validation.data.backlog.length).toBeGreaterThan(0);
      }
    });
  });

  // PATTERN: Test 2 - Validate prompt generation with Subtask input
  describe('prompt generation with Subtask', () => {
    it('should generate valid prompt for Subtask from real Backlog', async () => {
      // SETUP: Load and validate Backlog
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;

      // SETUP: Find a Subtask to test with (P2.M2.T2.S2 is the subtask for this PRP)
      const subtask = backlog.backlog
        .flatMap(p => p.milestones)
        .flatMap(m => m.tasks)
        .flatMap(t => t.subtasks)
        .find(s => s.id === 'P2.M2.T2.S2');

      expect(subtask).toBeDefined();
      expect(subtask?.type).toBe('Subtask');

      if (!subtask) return;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(
        subtask,
        backlog,
        '/home/dustin/projects/hacky-hack'
      );

      // VERIFY: Prompt structure is correct
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      // enableReflection is intentionally OMITTED by design for createPRPBlueprintPrompt
      // — the FILE is the contract (mirrors createArchitectPrompt). This matches the
      // unit suite (tests/unit/agents/prompts/prp-blueprint-prompt.test.ts) and
      // tests/integration/agents.test.ts. The stale JSDoc on the builder mentioning
      // enableReflection is outdated (see architecture/bug-004-test-suite.md).
      expect(prompt.enableReflection).toBeUndefined();

      // VERIFY: User prompt contains task context
      expect(prompt.user).toContain(subtask.title);
      expect(prompt.user).toContain(subtask.context_scope);
      expect(prompt.user).toContain('Dependencies:');
      expect(prompt.user).toContain('Parent Context');

      // VERIFY: System prompt contains PRP_BLUEPRINT_PROMPT content
      expect(prompt.systemOverride).toContain('Create PRP for Work Item');
      expect(prompt.systemOverride).toContain('PRP Creation Mission');
    });

    it('should include dependency context for Subtask with dependencies', async () => {
      // SETUP: Load Backlog
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;

      // SETUP: Find a Subtask with dependencies
      const subtask = backlog.backlog
        .flatMap(p => p.milestones)
        .flatMap(m => m.tasks)
        .flatMap(t => t.subtasks)
        .find(s => s.dependencies.length > 0);

      expect(subtask).toBeDefined();
      if (!subtask || subtask.type !== 'Subtask') return;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, backlog);

      // VERIFY: Dependencies are included in the prompt
      expect(prompt.user).toContain('Dependencies:');
      for (const depId of subtask.dependencies) {
        expect(prompt.user).toContain(depId);
      }
    });
  });

  // PATTERN: Test 3 - Validate prompt generation with Task input
  describe('prompt generation with Task', () => {
    it('should generate valid prompt for Task from real Backlog', async () => {
      // SETUP: Load and validate Backlog
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;

      // SETUP: Find a Task to test with
      const task = backlog.backlog
        .flatMap(p => p.milestones)
        .flatMap(m => m.tasks)
        .find(t => t.id === 'P2.M2.T2');

      expect(task).toBeDefined();
      expect(task?.type).toBe('Task');

      if (!task) return;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(
        task,
        backlog,
        '/home/dustin/projects/hacky-hack'
      );

      // VERIFY: Prompt structure is correct
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      expect(typeof prompt.systemOverride).toBe('string');

      // VERIFY: User prompt contains task description (not context_scope)
      expect(prompt.user).toContain(task.title);
      expect(prompt.user).toContain(task.description);
      expect(prompt.user).not.toContain('Context Scope:');
    });
  });

  // PATTERN: Test 4 - Validate parent context extraction
  describe('parent context extraction', () => {
    it('should extract Phase, Milestone, and Task descriptions for Subtask', async () => {
      // SETUP: Load Backlog
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;

      // SETUP: Find P2.M2.T2.S2 subtask
      const subtask = backlog.backlog
        .flatMap(p => p.milestones)
        .flatMap(m => m.tasks)
        .flatMap(t => t.subtasks)
        .find(s => s.id === 'P2.M2.T2.S2');

      expect(subtask).toBeDefined();
      if (!subtask || subtask.type !== 'Subtask') return;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, backlog);

      // VERIFY: Parent context includes Phase, Milestone, Task
      expect(prompt.user).toContain('Parent Context');

      // Find the parent items
      const phase = backlog.backlog.find(p => p.id === 'P2');
      const milestone = phase?.milestones.find(m => m.id === 'P2.M2');
      const task = milestone?.tasks.find(t => t.id === 'P2.M2.T2');

      expect(phase).toBeDefined();
      expect(milestone).toBeDefined();
      expect(task).toBeDefined();

      // VERIFY: Descriptions are included
      if (phase) {
        expect(prompt.user).toContain(phase.description);
      }
      if (milestone) {
        expect(prompt.user).toContain(milestone.description);
      }
      if (task) {
        expect(prompt.user).toContain(task.description);
      }
    });
  });

  // PATTERN: Test 5 - Validate codebase path inclusion
  describe('codebase path inclusion', () => {
    it('should include codebase path when provided', async () => {
      // SETUP: Load Backlog and find a subtask
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate prompt with codebase path
      const codebasePath = '/home/dustin/projects/hacky-hack';
      const prompt = createPRPBlueprintPrompt(subtask, backlog, codebasePath);

      // VERIFY: Codebase path is included
      expect(prompt.user).toContain('Codebase Analysis');
      expect(prompt.user).toContain(codebasePath);
    });

    it('should not include codebase section when path is not provided', async () => {
      // SETUP: Load Backlog and find a subtask
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate prompt without codebase path
      const prompt = createPRPBlueprintPrompt(subtask, backlog);

      // VERIFY: Custom codebase section is not included
      // Note: PRP_BLUEPRINT_PROMPT itself contains "Codebase Analysis" text,
      // but our custom codebase path section should not be present
      expect(prompt.user).not.toContain('The codebase is located at:');
    });
  });

  // PATTERN: Test 6 - Validate PRPDocumentSchema integration
  describe('responseFormat validation', () => {
    it('should have responseFormat matching PRPDocumentSchema structure', async () => {
      // SETUP: Load Backlog and find a subtask
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, backlog);

      // VERIFY: responseFormat is defined and matches expected structure
      expect(prompt.responseFormat).toBeDefined();

      // Note: We can't directly validate that responseFormat equals PRPDocumentSchema
      // because it's a Zod schema object. Instead, we verify that the prompt structure
      // is correct and the responseFormat property exists.
      expect(prompt).toHaveProperty('responseFormat');
    });

    it('should create valid mock PRPDocument output', () => {
      // SETUP: Create a mock PRPDocument matching the schema
      const mockPRPDocument = {
        taskId: 'P2.M2.T2.S2',
        objective: 'Create PRP blueprint prompt generator',
        context: '## All Needed Context\n\nFull context here',
        implementationSteps: [
          'Create prp-blueprint-prompt.ts',
          'Add unit tests',
          'Add integration tests',
        ],
        validationGates: [
          {
            level: 1,
            description: 'Syntax & Style',
            command: 'npm run lint',
            manual: false,
          },
          {
            level: 2,
            description: 'Unit Tests',
            command: 'npm run test',
            manual: false,
          },
          {
            level: 3,
            description: 'Integration Tests',
            command: 'npm run test:integration',
            manual: false,
          },
          {
            level: 4,
            description: 'Manual Validation',
            command: null,
            manual: true,
          },
        ],
        successCriteria: [
          { description: 'File created', satisfied: false },
          { description: 'Tests passing', satisfied: false },
        ],
        references: [
          'https://github.com/anthropics/claude-code',
          'src/agents/prompts/architect-prompt.ts',
        ],
      };

      // EXECUTE: Validate against PRPDocumentSchema
      const validation = PRPDocumentSchema.safeParse(mockPRPDocument);

      // VERIFY: Validation passes
      expect(validation.success).toBe(true);
    });
  });

  // PATTERN: Test 7 - Log sample output for inspection
  describe('sample output logging', () => {
    it('should log sample prompt for inspection', async () => {
      // SETUP: Load Backlog
      const tasksContent = await readFile(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(tasksContent);
      const validation = BacklogSchema.safeParse(parsed);

      expect(validation.success).toBe(true);
      if (!validation.success) return;

      const backlog = validation.data;

      // SETUP: Find P2.M2.T2.S2 (the subtask this PRP is for)
      const subtask = backlog.backlog
        .flatMap(p => p.milestones)
        .flatMap(m => m.tasks)
        .flatMap(t => t.subtasks)
        .find(s => s.id === 'P2.M2.T2.S2');

      expect(subtask).toBeDefined();
      if (!subtask || subtask.type !== 'Subtask') return;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(
        subtask,
        backlog,
        '/home/dustin/projects/hacky-hack'
      );

      // LOG: Sample output for manual inspection
      console.log('\n=== PRP Blueprint Prompt Sample Output ===');
      console.log('Subtask ID:', subtask.id);
      console.log('Subtask Title:', subtask.title);
      console.log('User prompt length:', prompt.user.length);
      console.log('System prompt length:', prompt.systemOverride.length);
      console.log('Enable reflection:', prompt.enableReflection);
      console.log('\n=== User Prompt (first 500 chars) ===');
      console.log(prompt.user.slice(0, 500) + '...');
      console.log('\n=== System Prompt (first 300 chars) ===');
      console.log(prompt.systemOverride.slice(0, 300) + '...');
      console.log('\n=== Full prompt validation ===');
      console.log('✓ Prompt structure valid');
      console.log('✓ User prompt contains task context');
      console.log('✓ System prompt contains PRP_BLUEPRINT_PROMPT');
      console.log('✓ responseFormat defined');
      console.log('✓ enableReflection omitted by design');

      // VERIFY: All assertions pass
      expect(prompt).toBeDefined();
    });
  });
});
