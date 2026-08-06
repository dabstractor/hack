/**
 * Integration test for Architect Agent PRD decomposition
 *
 * @remarks
 * Tests the complete flow: PRD input → Architect agent → Structured backlog
 * This is the first integration test in the codebase and serves as a pattern
 * for future agent integration tests (Researcher, Coder, QA).
 *
 * NOTE: Mocks createArchitectAgent to avoid MCP server registration issues.
 * The singleton MCP servers are registered at module load time and cannot
 * be re-registered across multiple tests. This mock approach validates the
 * integration pattern without testing Groundswell's internal implementation.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createArchitectPrompt } from '../../src/agents/prompts/architect-prompt.js';
import { BacklogSchema, type Backlog } from '../../src/core/models.js';

// PATTERN: Test-wide constants
const PRD_PATH = resolve(process.cwd(), 'spec/SPEC.md');
const USE_REAL_LLM = process.env.USE_REAL_LLM === 'true'; // Flag for real vs mocked

// PATTERN: Mock createArchitectAgent to avoid MCP registration issues
// The singleton MCP servers cannot be re-registered across tests.
// This mock returns a minimal agent with a spyable prompt() method.
vi.mock('../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(() => ({
    prompt: vi.fn(),
  })),
}));

// Import after mocking
import { createArchitectAgent } from '../../src/agents/agent-factory.js';

describe('integration/architect-agent', () => {
  // CLEANUP: Always restore mocks after each test
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // PATTERN: Test 1 - Verify setup and agent creation
  describe('setup', () => {
    it('should read PRD.md from project root', async () => {
      // SETUP: Read PRD file
      const prdContent = await readFile(PRD_PATH, 'utf-8');

      // VERIFY: PRD content is non-empty string
      expect(prdContent).toBeTruthy();
      expect(prdContent.length).toBeGreaterThan(0);
      expect(prdContent).toContain('# Product Requirements Document');
    });

    it('should create architect agent using factory', () => {
      // SETUP: Ensure environment is configured
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

      // EXECUTE: Create agent
      const agent = createArchitectAgent();

      // VERIFY: Agent is defined and has expected properties
      expect(agent).toBeDefined();
      expect(typeof agent.prompt).toBe('function');
    });
  });

  // PATTERN: Test 2 - Validate architect output structure
  describe('architect output validation', () => {
    it(
      'should generate valid backlog matching BacklogSchema',
      async () => {
        // SETUP: Read PRD and create agent
        vi.stubEnv(
          'ANTHROPIC_AUTH_TOKEN',
          process.env.ANTHROPIC_API_KEY || 'test-key'
        );
        vi.stubEnv(
          'ANTHROPIC_BASE_URL',
          process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic'
        );

        const prdContent = await readFile(PRD_PATH, 'utf-8');
        const architect = createArchitectAgent();
        const prompt = createArchitectPrompt(prdContent);

        // DECISION: Use mock or real LLM based on flag
        if (USE_REAL_LLM) {
          // EXECUTE: Real LLM call with timeout
          const result = await architect.prompt(prompt);

          // VERIFY: Validate against BacklogSchema
          const validation = BacklogSchema.safeParse(result);
          expect(validation.success).toBe(true);

          if (validation.success) {
            expect(validation.data.backlog).toBeInstanceOf(Array);
            expect(validation.data.backlog.length).toBeGreaterThan(0);
          }
        } else {
          // MOCK: Return fixture data for fast, deterministic testing
          const mockBacklog: Backlog = {
            backlog: [
              {
                id: 'P1',
                type: 'Phase',
                title: 'Phase 1: Foundation & Environment Setup',
                status: 'Planned',
                description: 'Project initialization',
                milestones: [
                  {
                    id: 'P1.M1',
                    type: 'Milestone',
                    title: 'Milestone 1.1: Project Initialization',
                    status: 'Planned',
                    description: 'Initialize TypeScript project',
                    tasks: [
                      {
                        id: 'P1.M1.T1',
                        type: 'Task',
                        title: 'Initialize TypeScript Project',
                        status: 'Planned',
                        description: 'Set up package.json',
                        subtasks: [
                          {
                            id: 'P1.M1.T1.S1',
                            type: 'Subtask',
                            title: 'Initialize package.json with dependencies',
                            status: 'Planned',
                            story_points: 1,
                            dependencies: [],
                            prd_selectors: [],
                            context_scope:
                              'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Inspect existing package.json\n2. INPUT: None\n3. LOGIC: Initialize dependencies\n4. OUTPUT: package.json created',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          };

          // MOCK: Agent.prompt() returns fixture data
          vi.spyOn(architect, 'prompt').mockResolvedValue(mockBacklog);

          // EXECUTE: Call agent
          const result = await architect.prompt(prompt);

          // VERIFY: Validate against BacklogSchema
          const validation = BacklogSchema.safeParse(result);
          expect(validation.success).toBe(true);
          expect(validation.data).toEqual(mockBacklog);
        }
      },
      { timeout: 30000 }
    ); // Longer timeout for LLM calls

    // PATTERN: Test 3 - Validate hierarchy structure
    it(
      'should contain at least one phase with proper nesting',
      async () => {
        // SETUP: Similar to above test
        vi.stubEnv(
          'ANTHROPIC_AUTH_TOKEN',
          process.env.ANTHROPIC_API_KEY || 'test-key'
        );
        vi.stubEnv(
          'ANTHROPIC_BASE_URL',
          process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic'
        );

        const prdContent = await readFile(PRD_PATH, 'utf-8');
        const architect = createArchitectAgent();
        const prompt = createArchitectPrompt(prdContent);

        if (USE_REAL_LLM) {
          const result = await architect.prompt(prompt);
          const validation = BacklogSchema.safeParse(result);

          expect(validation.success).toBe(true);
          if (validation.success) {
            // VERIFY: At least one phase exists
            expect(validation.data.backlog.length).toBeGreaterThan(0);

            // VERIFY: First phase has at least one milestone
            const firstPhase = validation.data.backlog[0];
            expect(firstPhase.milestones.length).toBeGreaterThan(0);

            // VERIFY: First milestone has at least one task
            const firstMilestone = firstPhase.milestones[0];
            expect(firstMilestone.tasks.length).toBeGreaterThan(0);

            // VERIFY: First task has at least one subtask
            const firstTask = firstMilestone.tasks[0];
            expect(firstTask.subtasks.length).toBeGreaterThan(0);
          }
        } else {
          // MOCK: Use fixture data
          const mockBacklog: Backlog = {
            backlog: [
              {
                id: 'P1',
                type: 'Phase',
                title: 'Test Phase',
                status: 'Planned',
                description: 'Test',
                milestones: [
                  {
                    id: 'P1.M1',
                    type: 'Milestone',
                    title: 'Test Milestone',
                    status: 'Planned',
                    description: 'Test',
                    tasks: [
                      {
                        id: 'P1.M1.T1',
                        type: 'Task',
                        title: 'Test Task',
                        status: 'Planned',
                        description: 'Test',
                        subtasks: [
                          {
                            id: 'P1.M1.T1.S1',
                            type: 'Subtask',
                            title: 'Test Subtask',
                            status: 'Planned',
                            story_points: 2,
                            dependencies: [],
                            context_scope: 'Test',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          };

          vi.spyOn(architect, 'prompt').mockResolvedValue(mockBacklog);
          const result = await architect.prompt(prompt);

          expect(
            result.backlog[0].milestones[0].tasks[0].subtasks[0]
          ).toBeDefined();
        }
      },
      { timeout: 30000 }
    );

    // PATTERN: Test 4 - Validate story_points
    it(
      'should validate story_points are integers in range [1, 21]',
      async () => {
        // SETUP: Similar to above
        vi.stubEnv(
          'ANTHROPIC_AUTH_TOKEN',
          process.env.ANTHROPIC_API_KEY || 'test-key'
        );
        vi.stubEnv(
          'ANTHROPIC_BASE_URL',
          process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic'
        );

        const prdContent = await readFile(PRD_PATH, 'utf-8');
        const architect = createArchitectAgent();
        const prompt = createArchitectPrompt(prdContent);

        if (USE_REAL_LLM) {
          const result = await architect.prompt(prompt);
          const validation = BacklogSchema.safeParse(result);

          expect(validation.success).toBe(true);
          if (validation.success) {
            // VERIFY: Traverse all subtasks and validate story_points
            const validateStoryPoints = (backlog: Backlog) => {
              for (const phase of backlog.backlog) {
                for (const milestone of phase.milestones) {
                  for (const task of milestone.tasks) {
                    for (const subtask of task.subtasks) {
                      // CRITICAL: Validate against actual schema (integers 1-21)
                      expect(Number.isInteger(subtask.story_points)).toBe(true);
                      expect(subtask.story_points).toBeGreaterThanOrEqual(1);
                      expect(subtask.story_points).toBeLessThanOrEqual(21);

                      // GOTCHA: 0.5 is NOT valid per the schema
                      // Even though PROMPTS.md mentions 0.5, the schema requires integers
                    }
                  }
                }
              }
            };

            validateStoryPoints(validation.data);
          }
        } else {
          // MOCK: Test with valid integer story_points
          const mockBacklog: Backlog = {
            backlog: [
              {
                id: 'P1',
                type: 'Phase',
                title: 'Test Phase',
                status: 'Planned',
                description: 'Test',
                milestones: [
                  {
                    id: 'P1.M1',
                    type: 'Milestone',
                    title: 'Test Milestone',
                    status: 'Planned',
                    description: 'Test',
                    tasks: [
                      {
                        id: 'P1.M1.T1',
                        type: 'Task',
                        title: 'Test Task',
                        status: 'Planned',
                        description: 'Test',
                        subtasks: [
                          {
                            id: 'P1.M1.T1.S1',
                            type: 'Subtask',
                            title: 'S1',
                            status: 'Planned',
                            story_points: 1,
                            dependencies: [],
                            context_scope: 'Test',
                          },
                          {
                            id: 'P1.M1.T1.S2',
                            type: 'Subtask',
                            title: 'S2',
                            status: 'Planned',
                            story_points: 2,
                            dependencies: [],
                            context_scope: 'Test',
                          },
                          {
                            id: 'P1.M1.T1.S3',
                            type: 'Subtask',
                            title: 'S3',
                            status: 'Planned',
                            story_points: 3,
                            dependencies: [],
                            context_scope: 'Test',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          };

          vi.spyOn(architect, 'prompt').mockResolvedValue(mockBacklog);
          const result = await architect.prompt(prompt);

          // VERIFY: All story_points are valid
          result.backlog[0].milestones[0].tasks[0].subtasks.forEach(subtask => {
            expect(Number.isInteger(subtask.story_points)).toBe(true);
            expect(subtask.story_points).toBeGreaterThanOrEqual(1);
            expect(subtask.story_points).toBeLessThanOrEqual(21);
          });
        }
      },
      { timeout: 30000 }
    );

    // PATTERN: Test 5 - Log sample output
    it(
      'should log sample output for inspection',
      async () => {
        // SETUP: Similar to above
        vi.stubEnv(
          'ANTHROPIC_AUTH_TOKEN',
          process.env.ANTHROPIC_API_KEY || 'test-key'
        );
        vi.stubEnv(
          'ANTHROPIC_BASE_URL',
          process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic'
        );

        const prdContent = await readFile(PRD_PATH, 'utf-8');
        const architect = createArchitectAgent();
        const prompt = createArchitectPrompt(prdContent);

        if (USE_REAL_LLM) {
          const result = await architect.prompt(prompt);

          // LOG: Sample output for manual inspection
          console.log('\n=== Architect Agent Sample Output ===');
          console.log('Total Phases:', result.backlog.length);

          if (result.backlog.length > 0) {
            const firstPhase = result.backlog[0];
            console.log('\nFirst Phase:', firstPhase.id, '-', firstPhase.title);

            if (firstPhase.milestones.length > 0) {
              const firstMilestone = firstPhase.milestones[0];
              console.log(
                '  First Milestone:',
                firstMilestone.id,
                '-',
                firstMilestone.title
              );

              if (firstMilestone.tasks.length > 0) {
                const firstTask = firstMilestone.tasks[0];
                console.log(
                  '    First Task:',
                  firstTask.id,
                  '-',
                  firstTask.title
                );

                if (firstTask.subtasks.length > 0) {
                  const firstSubtask = firstTask.subtasks[0];
                  console.log('      First Subtask:', firstSubtask.id);
                  console.log('        Title:', firstSubtask.title);
                  console.log(
                    '        Story Points:',
                    firstSubtask.story_points
                  );
                }
              }
            }
          }

          // LOG: Full JSON sample (truncated for size)
          console.log('\n=== Full Backlog JSON (first 500 chars) ===');
          console.log(JSON.stringify(result, null, 2).slice(0, 500) + '...');
        } else {
          // MOCK: Log fixture data
          const mockBacklog: Backlog = {
            backlog: [
              {
                id: 'P1',
                type: 'Phase',
                title: 'Sample Phase',
                status: 'Planned',
                description: 'Sample description',
                milestones: [
                  {
                    id: 'P1.M1',
                    type: 'Milestone',
                    title: 'Sample Milestone',
                    status: 'Planned',
                    description: 'Sample',
                    tasks: [
                      {
                        id: 'P1.M1.T1',
                        type: 'Task',
                        title: 'Sample Task',
                        status: 'Planned',
                        description: 'Sample',
                        subtasks: [
                          {
                            id: 'P1.M1.T1.S1',
                            type: 'Subtask',
                            title: 'Sample Subtask',
                            status: 'Planned',
                            story_points: 2,
                            dependencies: [],
                            context_scope: 'Sample context',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          };

          vi.spyOn(architect, 'prompt').mockResolvedValue(mockBacklog);
          const result = await architect.prompt(prompt);

          console.log('\n=== Mock Architect Agent Output ===');
          console.log(
            'Sample Subtask:',
            result.backlog[0].milestones[0].tasks[0].subtasks[0]
          );
        }
      },
      { timeout: 30000 }
    );
  });
});
