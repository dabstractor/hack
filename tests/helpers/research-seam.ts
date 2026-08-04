/**
 * Shared test helper for the PRP-research seam (BUG-004 Category (a)).
 *
 * @remarks
 * ## The failure chain this helper closes
 *
 * `TaskOrchestrator.executeSubtask` → `researchQueue.researchNow`
 * (`src/core/research-queue.ts:343`) → `PRPGenerator.generate`
 * (`src/agents/prp-generator.ts:688`) → `createResearcherAgent().prompt()`
 * (`src/agents/agent-factory.ts:386`) → real Groundswell `Agent` → harness wraps the
 * uninitialized state into `{ status:'error', error:'PiHarness not initialized' }` →
 * `generate()` throws `AgentError('Researcher agent failed: ...')`.
 *
 * The real `pi` harness singleton is never registered/initialized in test setup, so any
 * suite that drives the real `TaskOrchestrator` / `PRPGenerator` hits this error before
 * it reaches its own SUBJECT. **None of this is a production defect** — the pipeline
 * code is in-spec; it is a test-isolation gap.
 *
 * ## THE critical contract — `generate()` reads the PRP from a FILE, not `result.data`
 *
 * `PRPGenerator.generate()` ignores `result.data`. After the agent call it:
 *   1. reads `r.status` only — throws if `'error'`;
 *   2. `readFile(prpOutputPath, 'utf-8')` — ENOENT ⇒ throws
 *      `'Researcher did not write PRP file at <path>'`;
 *   3. parses the text (raw JSON or a ```json fenced block) and runs
 *      `PRPDocumentSchema.safeParse`.
 *
 * `prpOutputPath = join(sessionPath, 'prps', \`${task.id.replace(/\./g, '_')}.json\`)`
 * — note the **`.json`** extension (the `.md` is a DIFFERENT artifact `PRPGenerator`
 * writes itself via `#writePRPToFile`). A leaf-level `createResearcherAgent` mock MUST
 * therefore ALSO place a schema-valid `.json` file at that path, or `generate()` throws.
 * {@link wireMockResearcherAgent} writes it automatically.
 *
 * ## Convention — pick the mock depth by the suite's SUBJECT (the S2 playbook)
 *
 * ### A) SUBJECT is NOT the research path (orchestration / commits / workflows /
 *    executors / traversal) → MOCK the seam for isolation.
 * Prefer the **class-level** mock (`research-queue.js` or `prp-generator.js`) to avoid
 * the `.json` file contract entirely; use the leaf mock only when you want `generate()`
 * to really run.
 *
 * ### B) SUBJECT IS the research path (`prp-generator` / `prp-runtime` suites) → LEAF
 *    mock (`createResearcherAgent`) + {@link wireMockResearcherAgent} (auto-writes the
 *    `.json`) so `generate()` runs for real against a stub agent.
 *
 * ### C) Rarely — a suite genuinely wants real harness plumbing →
 *    `beforeAll(initRealHarness)` (opt-in only; see {@link initRealHarness}).
 *
 * ## S2 per-suite recommendation (from `research/findings.md` §5)
 *
 * | # | File | SUBJECT | Recommended path |
 * |---|------|---------|------------------|
 * | 1 | `tests/integration/smart-commit.test.ts` | smart-commit (NOT research) | class mock — `research-queue.js` |
 * | 2 | `tests/integration/core/task-orchestrator-e2e.test.ts` | E2E orchestration (NOT research) | class mock — `research-queue.js` |
 * | 3 | `tests/integration/core/task-orchestrator-runtime.test.ts` | ResearchQueue integration (borderline) | class mock — `research-queue.js` |
 * | 4 | `tests/integration/prp-generator-integration.test.ts` | **RESEARCH path** | leaf mock + file contract (current mock is STALE) |
 * | 5 | `tests/integration/prp-runtime-integration.test.ts` | **RESEARCH path** | leaf mock + file contract (keep `generate()` real) |
 * | 6 | `tests/integration/bug-hunt-workflow-integration.test.ts` | QA workflow (NOT research) | class mock — `research-queue.js` (diagnose mock completeness) |
 * | 7 | `tests/integration/fix-cycle-workflow-integration.test.ts` | fix-cycle (NOT research) | diagnose — already partially isolated |
 * | 8 | `tests/integration/prp-executor-integration.test.ts` | executor (NOT research) | class mock — `research-queue.js` |
 * | 9 | `tests/integration/core/task-orchestrator.test.ts` | traversal/executionQueue (NOT research) | class mock — `research-queue.js` |
 *
 * ## `vi.mock` hoisting constraint
 *
 * `vi.mock(path, factory)` is **hoisted** above static imports; the factory cannot
 * reference ordinary imports (only `vi` + `vi.hoisted`). Therefore this helper NEVER
 * calls `vi.mock` itself — it EXPORTS pure fixtures + wiring helpers. Each test file
 * keeps its own top-level self-contained `vi.mock(...)` of bare `vi.fn()` stubs (the
 * proven repo pattern from `prp-generator-integration.test.ts`), then calls a wiring
 * helper in `beforeEach` to set the implementation + write any needed file.
 *
 * @module tests/helpers/research-seam
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';

// `import type` is erased at compile time — it does NOT pull `src/` into the module
// graph, so a suite that mocks these modules elsewhere is unaffected. Only the SHAPE
// is needed for the fixture return type.
import type { PRPDocument } from '../../src/core/models.js';

// ───────────────────────────── Pure fixtures (vitest-free) ──────────────────────────────

/**
 * Build a schema-valid minimal `PRPDocument` for the given task id.
 *
 * @remarks
 * DRYs the duplicated `createMockPRPDocument` fixture that lives in both
 * `tests/integration/prp-generator-integration.test.ts:97-121` and
 * `tests/integration/prp-runtime-integration.test.ts`. The returned object is
 * guaranteed to pass `PRPDocumentSchema.safeParse` (the self-test at
 * `tests/unit/helpers/research-seam.test.ts` proves this).
 *
 * Provides 4 validation gates (levels 1–3 automated, level 4 manual) and 2
 * success criteria, matching the real PRP template.
 *
 * @param taskId - The work-item id (e.g. `'P3.M3.T1.S1'`).
 * @returns A `PRPDocument`-shaped object satisfying `PRPDocumentSchema`.
 */
export function createMockPRPDocument(taskId: string): PRPDocument {
  return {
    taskId,
    objective: 'Implement PRPGenerator class',
    context: '## Context\nFull implementation context',
    implementationSteps: ['Step 1: Create class', 'Step 2: Add retry logic'],
    validationGates: [
      { level: 1, description: 'Lint', command: 'npm run lint', manual: false },
      { level: 2, description: 'Test', command: 'npm test', manual: false },
      {
        level: 3,
        description: 'Integration',
        command: 'npm run test:integration',
        manual: false,
      },
      { level: 4, description: 'Manual', command: null, manual: true },
    ],
    successCriteria: [
      { description: 'Tests pass', satisfied: false },
      { description: 'Code complete', satisfied: false },
    ],
    references: ['src/agents/prp-generator.ts'],
  };
}

/**
 * The canonical default fixture — `createMockPRPDocument('P3.M3.T1.S1')`.
 *
 * @remarks
 * Use this when a suite does not care about the specific task id and just needs
 * *a* valid `PRPDocument`. Re-exported so suites share one object identity.
 */
export const MOCK_PRP_DOCUMENT: PRPDocument =
  createMockPRPDocument('P3.M3.T1.S1');

/**
 * `JSON.stringify` of {@link MOCK_PRP_DOCUMENT} — the exact bytes
 * {@link wireMockResearcherAgent} writes to the `.json` file.
 *
 * @remarks
 * Provided so suites can assert on / reuse the serialized form without
 * re-stringifying. Round-trips through `JSON.parse` to the original `taskId`.
 */
export const MINIMAL_PRP_JSON_STRING: string =
  JSON.stringify(MOCK_PRP_DOCUMENT);

/**
 * Build a success-shaped Groundswell `AgentResponse` carrying `data`.
 *
 * @remarks
 * `generate()` reads only `response.status` (must be `!== 'error'`), but other
 * consumers (e.g. `PRPExecutor.#extractResponseContent`) read `response.data`, and
 * the `AgentResponse` discriminated-union requires `metadata.agentId` +
 * `metadata.timestamp` on every variant (`node_modules/groundswell/dist/types/agent.d.ts`).
 * This builder produces the full success shape so all consumers are safe.
 *
 * @param data - The payload to carry (defaults to {@link MOCK_PRP_DOCUMENT}).
 * @returns A `{ status: 'success', data, error: null, metadata }` response.
 */
export function createSuccessAgentResponse(data: unknown = MOCK_PRP_DOCUMENT): {
  status: 'success';
  data: unknown;
  error: null;
  metadata: { agentId: string; timestamp: number };
} {
  return {
    status: 'success',
    data,
    error: null,
    metadata: { agentId: 'mock-researcher', timestamp: Date.now() },
  };
}

// ───────────────────────────── Path util ────────────────────────────────────────────────

/**
 * Compute the PRP `.json` output path `PRPGenerator.generate()` reads from.
 *
 * @remarks
 * Mirrors `PRPGenerator`'s own computation
 * (`join(sessionPath, 'prps', \`${taskId.replace(/\./g, '_')}.json\`)`,
 * `src/agents/prp-generator.ts:~650-656`). Used by {@link wireMockResearcherAgent} to
 * place the file at the exact path `generate()` expects, and by suites that need to
 * assert on / read back the written artifact.
 *
 * **Note the `.json` extension** — the `.md` is a different artifact `PRPGenerator`
 * writes itself; writing `.md` here would let `generate()` throw
 * `'Researcher did not write PRP file'`.
 *
 * @param sessionPath - The session directory path.
 * @param taskId - The work-item id (dots become underscores).
 * @returns The absolute `<sessionPath>/prps/<sanitizedId>.json` path.
 */
export function prpJsonPath(sessionPath: string, taskId: string): string {
  const sanitizedId = taskId.replace(/\./g, '_');
  return join(sessionPath, 'prps', `${sanitizedId}.json`);
}

// ───────────────────────────── Wiring helpers (call in beforeEach) ──────────────────────
//
// Each test file owns its top-level self-contained `vi.mock(...)` of bare `vi.fn()`
// stubs (hoisting forbids referencing imports inside the factory). These helpers are
// called in `beforeEach` to set the implementation + write any needed file. Each
// returns the mock (or `void`) so the suite can assert on it.

/**
 * Wire a leaf-level `createResearcherAgent` mock AND write the `.json` file contract.
 *
 * @remarks
 * For suites whose SUBJECT is the research path (`prp-generator` / `prp-runtime`) —
 * keeps `PRPGenerator.generate()` real while stubbing the agent. This closes the trap
 * the stale `prp-generator-integration.test.ts` fell into: it returned a bare
 * `PRPDocument` and never wrote the `.json`, so `generate()` throws
 * `'Researcher did not write PRP file'`. This helper writes a schema-valid file at
 * {@link prpJsonPath} automatically.
 *
 * Copy-paste the matching top-level `vi.mock`:
 * ```ts
 * vi.mock('../../src/agents/agent-factory.js', () => ({
 *   createResearcherAgent: vi.fn(),
 * }));
 * // then in beforeEach:
 * const { prompt } = await wireMockResearcherAgent({
 *   createResearcherAgent,
 *   sessionPath,
 *   taskId,
 * });
 * ```
 *
 * @param opts.createResearcherAgent - The imported `vi.mocked` `createResearcherAgent` fn.
 * @param opts.sessionPath - The session directory path (where `prps/` lives).
 * @param opts.taskId - The work-item id the agent is prompted for.
 * @param opts.prpDocument - Optional override doc (defaults to a taskId-derived fixture).
 * @returns `{ prompt }` — the mock prompt fn, for assertions.
 */
export async function wireMockResearcherAgent(opts: {
  createResearcherAgent: unknown;
  sessionPath: string;
  taskId: string;
  prpDocument?: PRPDocument;
}): Promise<{ prompt: ReturnType<typeof vi.fn> }> {
  const doc = opts.prpDocument ?? createMockPRPDocument(opts.taskId);
  const prompt = vi.fn().mockResolvedValue(createSuccessAgentResponse(doc));
  (opts.createResearcherAgent as any).mockReturnValue({ prompt });

  // Write the `.json` file contract at the exact path generate() reads.
  await mkdir(join(opts.sessionPath, 'prps'), { recursive: true });
  await writeFile(
    prpJsonPath(opts.sessionPath, opts.taskId),
    JSON.stringify(doc),
    'utf-8'
  );

  return { prompt };
}

/**
 * Wire a class-level `PRPGenerator` mock that bypasses `generate()` entirely.
 *
 * @remarks
 * For suites whose SUBJECT is NOT the research path but that construct a real
 * `ResearchQueue` (which `new`s a `PRPGenerator`). No `.json` file is written —
 * `generate()` is fully stubbed.
 *
 * Copy-paste the matching top-level `vi.mock`:
 * ```ts
 * vi.mock('../../src/agents/prp-generator.js', () => ({
 *   PRPGenerator: vi.fn(),
 * }));
 * // then in beforeEach:
 * wireMockPRPGenerator({ PRPGenerator });
 * ```
 *
 * @param opts.PRPGenerator - The imported `vi.mocked` `PRPGenerator` class fn.
 * @param opts.prpDocument - Optional override doc (defaults to {@link MOCK_PRP_DOCUMENT}).
 */
export function wireMockPRPGenerator(opts: {
  PRPGenerator: unknown;
  prpDocument?: PRPDocument;
}): void {
  const doc = opts.prpDocument ?? MOCK_PRP_DOCUMENT;
  (opts.PRPGenerator as any).mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue(doc),
    // Mirror the real getter shape in case anything reads it.
    getCachePath: vi.fn().mockReturnValue(''),
  }));
}

/**
 * Wire a class-level `ResearchQueue` mock that stubs EVERY method `TaskOrchestrator`
 * calls — full isolation of the research path.
 *
 * @remarks
 * For suites whose SUBJECT is orchestration / commits / workflows / executors /
 * traversal. This is the strongest isolation: the real `ResearchQueue`,
 * `PRPGenerator`, and agent are never constructed, so the
 * `'PiHarness not initialized'` chain is unreachable. Stubs the full surface
 * `TaskOrchestrator` touches (`enqueue`, `processNext`, `getStats`, `getPRP`,
 * `waitForPRP`, `researchNow`, `deletePRP`) plus the readonly fields read directly
 * (`queue`, `researching`, `results`, `abandoned`, `maxSize`, `sessionManager`,
 * getter `depth`). `getStats()` returns `{ queued, researching, cached }`.
 *
 * Copy-paste the matching top-level `vi.mock`:
 * ```ts
 * vi.mock('../../src/core/research-queue.js', () => ({
 *   ResearchQueue: vi.fn(),
 * }));
 * // then in beforeEach:
 * wireMockResearchQueue({ ResearchQueue });
 * ```
 *
 * @param opts.ResearchQueue - The imported `vi.mocked` `ResearchQueue` class fn.
 * @param opts.prpDocument - Optional override doc (defaults to {@link MOCK_PRP_DOCUMENT}).
 */
export function wireMockResearchQueue(opts: {
  ResearchQueue: unknown;
  prpDocument?: PRPDocument;
}): void {
  const doc = opts.prpDocument ?? MOCK_PRP_DOCUMENT;
  (opts.ResearchQueue as any).mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue(undefined),
    processNext: vi.fn().mockResolvedValue(undefined),
    researchNow: vi.fn().mockResolvedValue(doc),
    waitForPRP: vi.fn().mockResolvedValue(doc),
    getPRP: vi.fn().mockReturnValue(doc),
    deletePRP: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
    isResearching: vi.fn().mockReturnValue(false),
    isAbandoned: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
    // Readonly fields TaskOrchestrator may read directly.
    queue: [],
    researching: new Map(),
    results: new Map(),
    abandoned: new Set(),
    maxSize: 3,
    sessionManager: undefined,
    depth: 0,
  }));
}

// ───────────────────────────── Real harness (opt-in beforeAll) ──────────────────────────

/**
 * Initialize the real `pi` harness singleton (opt-in `beforeAll` only).
 *
 * @remarks
 * Calls `configureHarness()` then `await ensureHarnessInitialized()`
 * (`src/config/harness.ts:~124` / `:~209`). Both are idempotent (guard on
 * `HarnessRegistry.has('pi')`) and make NO network/LLM call themselves — but once
 * run, a *real* `agent.prompt()` WILL make a real LLM call (needs keys + network).
 * So this is NOT a blanket fix for unit-style suites; reserve it for suites that
 * explicitly test research integration.
 *
 * **Do NOT add this to `tests/setup.ts` globally** — it would register the real
 * harness for ALL tests, turning the obvious `'PiHarness not initialized'`
 * isolation signal into a silent real-LLM call (or a confusing auth error), masking
 * the real fix (mock the seam). Opt-in `beforeAll` only.
 *
 * Uses a **dynamic** `import(...)` so a suite that mocks `harness.js` elsewhere
 * isn't fighting a static top-level import. Does NOT call `runAuthPreflight()`
 * (it throws `AuthPreflightError` without keys).
 *
 * Usage:
 * ```ts
 * import { initRealHarness } from '../helpers/research-seam';
 * beforeAll(initRealHarness);
 * ```
 */
export async function initRealHarness(): Promise<void> {
  const { configureHarness, ensureHarnessInitialized } =
    await import('../../src/config/harness.js');
  configureHarness();
  await ensureHarnessInitialized();
}
