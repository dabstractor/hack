# Scout Report: Test Conventions for LLM/Agent-Calling Modules

Scope: how `tests/unit/**` mock `groundswell.createAgent` and `agent.prompt()`,
the prd-differ test style, the vitest config, the `DiffSummary` shape, whether
any PRD-diff classifier already exists, and the `tests/unit/agents/` mocking
patterns. Findings are concrete with exact paths/line numbers/snippets.

---

## 1. Mocking `groundswell.createAgent` / `agent.prompt()`

There are **two distinct unit-test mocking strategies** depending on whether
the unit under test owns the `createAgent` call or delegates to a factory.

### Strategy A — Mock the agent factory (`agent-factory.js`), return a fake agent with a spy `prompt`

Used by every workflow test that calls an agent. The factory's `createXxxAgent`
export is replaced with a `vi.fn()` whose `mockReturnValue` injects an object
bearing a `prompt: vi.fn()`. The mock is later re-pointed per-test.

Canonical example — `tests/unit/workflows/delta-analysis-workflow.test.ts:24-31`
and the per-test re-stub at `:107-119`:

```ts
// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock delta analysis prompt
vi.mock('../../../src/agents/prompts/delta-analysis-prompt.js', () => ({
  createDeltaAnalysisPrompt: vi.fn(),
}));

import { createQAAgent } from '../../../src/agents/agent-factory.js';
const mockCreateQAAgent = createQAAgent as any;

// ...inside beforeEach:
mockCreateQAAgent.mockReturnValue({
  prompt: vi.fn(),
});
```

Per-test wiring that returns an `AgentResponse` payload from `prompt()`
(`tests/unit/workflows/delta-analysis-workflow.test.ts:105-123`):

```ts
const mockAgent = {
  prompt: vi.fn().mockResolvedValue({
    status: 'success',
    data: {
      changes: [],
      patchInstructions: 'No changes',
      taskIds: [],
    },
    error: null,
    metadata: {
      agentId: 'test-qa-agent',
      timestamp: Date.now(),
    },
  }),
};
mockCreateQAAgent.mockReturnValue(mockAgent);
```

> The return shape from `prompt()` in these tests is `{ status, data, error,
> metadata }` (Groundswell `AgentResponse<T>`), NOT a bare string. The agent's
> payload type lives in `data`. This is the convention for any unit test that
> asserts on what a workflow extracts from the agent response.

Same pattern for `bug-hunt-workflow` — `tests/unit/workflows/bug-hunt-workflow.test.ts:27-39`
(also adds a hoisted `readFile` mock with `vi.hoisted`):

```ts
// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock bug hunt prompt
vi.mock('../../../src/agents/prompts/bug-hunt-prompt.js', () => ({
  createBugHuntPrompt: vi.fn(),
}));

// Mock session-utils
vi.mock('../../../src/core/session-utils.js', () => ({
  atomicWrite: vi.fn(),
}));

// Mock node:fs/promises for file-as-contract pattern in generateReport
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));
```

### Strategy B — Mock `groundswell`'s `createAgent` directly to capture the config

Used when the unit under test is the factory itself. The mock factory returns
`{ __cfg: cfg }` so the test can assert on the config object passed into
`createAgent` without instantiating a real agent.

`tests/unit/agents/commit-message-agent.test.ts:34-36`:

```ts
// Mock groundswell's createAgent to capture the config object passed in, so the
// test can assert the D1 overrides (maxTokens/enableReflection/enableCache/name)
// without instantiating a real agent.
vi.mock('groundswell', () => ({
  createAgent: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
}));
```

Plus its companion base-config mock at `:18-30`:

```ts
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createBaseConfig: vi.fn(() => ({
    name: 'ResearcherAgent',
    model: 'zai/glm-5.2',
    harness: 'pi',
    enableCache: true,
    enableReflection: true,
    maxTokens: 4096,
    system: 'placeholder',
    env: { ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '' },
  })),
}));
```

`cleanup-agent.test.ts:51-58` does the same but **preserves real groundswell
exports** via `importOriginal` (needed because the real `agent-factory.ts`
imports `MCPHandler`/`MCPServer` from groundswell):

```ts
vi.mock('groundswell', async importOriginal => {
  const actual = await importOriginal<typeof import('groundswell')>();
  return {
    ...actual,
    createAgent: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
  };
});
```

The factory-style `createAgent` mock — spreads real exports + overrides
`createAgent`/`createPrompt` — also appears in
`tests/unit/agents/cache-verification.test.ts:16-23`:

```ts
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});
```

### How a `prompt()` mock returns a response string

Bare-string returns from `prompt()` are wrapped by `#extractResponseContent`
in `prp-executor.ts`; the corresponding test mocks the `retry.js` helper so a
string result is auto-wrapped into the `AgentResponse` shape. See
`tests/unit/agents/prp-executor.test.ts:40-55`:

```ts
// Mock the retry module — wraps string returns in AgentResponse shape
// so that #extractResponseContent can extract the payload correctly.
vi.mock('../../../src/utils/retry.js', () => ({
  retryAgentPrompt: vi.fn(async (fn: () => Promise<unknown>, _ctx: unknown) => {
    const result = await fn();
    // Wrap string results in AgentResponse shape expected by #extractResponseContent
    if (typeof result === 'string') {
      return {
        status: 'success' as const,
        data: result,
        error: null,
      };
    }
    return result;
  }),
  ...
}));
```

For tests asserting on cached `prompt()` behaviour with controlled return
values, see `tests/unit/agents/cache-verification.test.ts:54-98`:

```ts
const mockAgent = {
  prompt: vi.fn(),
};
// ...
const mockResponse = { id: 'response-123', content: 'Cached result' };
mockAgent.prompt.mockResolvedValue(mockResponse);

const result1 = await mockAgent.prompt('Test prompt');
// per-call differentiation:
mockAgent.prompt
  .mockResolvedValueOnce(prompt1Response)
  .mockResolvedValueOnce(prompt2Response);
```

> **Convention note for a new agent test:** if the new agent is a factory (like
> commit-message / cleanup), follow Strategy B and assert on the captured
> config via `vi.mocked(createAgent).mock.calls[0][0]`. If the new code is a
> workflow that calls an existing factory agent, follow Strategy A and assert
> on the `AgentResponse<T>` returned from the injected `prompt` mock.

---

## 2. `tests/unit/core/prd-differ.test.ts` — Setup/Execute/Verify style

File: `tests/unit/core/prd-differ.test.ts` (full file read).

### Import pattern

Relative `.js` path with explicit type import; no `vi` needed (pure module,
no mocks). `tests/unit/core/prd-differ.test.ts:13-21`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parsePRDSections,
  normalizeMarkdown,
  diffPRDs,
  hasSignificantChanges,
  type DiffSummary,
} from '../../../src/core/prd-differ.js';
```

### Test style

- `describe('prd-differ')` → nested `describe('<fn name>')` → `describe('GIVEN <condition>')` → `it('SHOULD <behaviour>')`.
- Each `it` body uses `// SETUP`, `// EXECUTE`, `// VERIFY` comment blocks (exact labels).
- 100% branch coverage is achieved by an explicit edge-case per `GIVEN`
  (empty strings, whitespace-only, code blocks, Windows line endings,
  case-sensitivity, multiple changes, etc.).

Example body — `tests/unit/core/prd-differ.test.ts:157-188`:

```ts
describe('GIVEN PRD with new section added', () => {
  it('SHOULD detect added section', () => {
    // SETUP
    const oldPRD = `# Features

- User auth`;

    const newPRD = `# Features

- User auth

# API

REST API endpoints`;

    // EXECUTE
    const result = diffPRDs(oldPRD, newPRD);

    // VERIFY
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe('added');
    expect(result.changes[0].sectionTitle).toBe('API');
    expect(result.changes[0].newContent).toContain('REST API endpoints');
    expect(result.stats.totalAdded).toBe(1);
    expect(result.stats.sectionsAffected).toContain('API');
  });
});
```

The same Setup/Execute/Verify + GIVEN/SHOULD style recurs across all unit
tests (e.g. `agent-factory.test.ts`, `cleanup-agent.test.ts`,
`delta-analysis-workflow.test.ts`, `bug-hunt-workflow.test.ts`), confirming it
is the project-wide convention.

---

## 3. `vitest.config.ts` — FULL config

File: `vitest.config.ts` (full file read). Highlights:

| Setting | Value |
|---|---|
| `environment` | `'node'` |
| `globals` | `true` |
| `include` | `['tests/**/*.{test,spec}.ts']` |
| `exclude` | `['**/dist/**', '**/node_modules/**']` |
| `setupFiles` | `['./tests/setup.ts']` |
| `pool` | `'forks'` |
| `poolOptions.forks` | `minForks: 1`, `maxForks: min(os.cpus().length, 4)`, `memoryLimit: 4096` |
| `coverage.provider` | `'v8'` |
| `coverage.reporter` | `['text', 'json', 'html']` |
| `coverage.include` | `['src/**/*.ts']` |
| `coverage.exclude` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']` |
| **Coverage thresholds** | **`statements: 100`, `branches: 100`, `functions: 100`, `lines: 100`** ✅ 100% is required |

Resolve aliases (`vitest.config.ts:62-67`):

```ts
resolve: {
  alias: {
    '@': new URL('./src', import.meta.url).pathname,
    '#': new URL('./src/agents', import.meta.url).pathname,
    groundswell: new URL('../groundswell/dist/index.js', import.meta.url).pathname,
  },
  extensions: ['.ts', '.js', '.tsx'],
},
```

> The `groundswell` alias points at `../groundswell/dist/index.js` — i.e. a
> sibling `groundswell/` package at the repo root, built to `dist/`. Any
> `vi.mock('groundswell', …)` is intercepting this alias.

`tests/setup.ts` adds global hooks: `vi.clearAllMocks()` + an endpoint guard
(`validateProviderEndpoint`, blocks `api.anthropic.com`) in `beforeEach`, and
unhandled-rejection tracking + `vi.unstubAllEnvs()` + optional GC in
`afterEach`. Tests therefore do **not** need their own mock-clear `beforeEach`
for call-history reset (they still do it for clarity / per-file isolation).

---

## 4. `DiffSummary` type — construction in tests

**Source definition** — `src/core/prd-differ.ts:111-164` (canonical shape):

```ts
export interface SectionChange {
  readonly type: 'added' | 'modified' | 'removed';
  readonly sectionTitle: string;
  readonly lineNumber: number;
  readonly oldContent?: string;
  readonly newContent?: string;
  readonly impact: 'low' | 'medium' | 'high';
}

export interface DiffSummary {
  readonly changes: SectionChange[];
  readonly summaryText: string;
  readonly stats: {
    readonly totalAdded: number;
    readonly totalModified: number;
    readonly totalRemoved: number;
    readonly sectionsAffected: readonly string[];
  };
}
```

**Test construction pattern** — the test imports `type DiffSummary` from the
source and builds the object literal inline. From
`tests/unit/core/prd-differ.test.ts:498-513`:

```ts
// SETUP
const diff: DiffSummary = {
  changes: [],
  summaryText: 'No changes',
  stats: {
    totalAdded: 0,
    totalModified: 0,
    totalRemoved: 0,
    sectionsAffected: [],
  },
};
```

With changes populated (`tests/unit/core/prd-differ.test.ts:534-567`):

```ts
const diff: DiffSummary = {
  changes: [
    {
      type: 'added',
      sectionTitle: 'Section 1',
      lineNumber: 1,
      newContent: 'Small',
      impact: 'low',
    },
    // ...
  ],
  summaryText: '3 sections added',
  stats: {
    totalAdded: 3,
    totalModified: 0,
    totalRemoved: 0,
    sectionsAffected: ['Section 1', 'Section 2', 'Section 3'],
  },
};
```

A `DiffSummary` is also produced directly by `diffPRDs(oldPRD, newPRD)` (source
`src/core/prd-differ.ts:468`), then fed into `hasSignificantChanges(diff)`
(source `src/core/prd-differ.ts:564`). A new classifier consuming a
`DiffSummary` should accept the **read-only** shape above (all fields are
`readonly`) and follow the inline-literal construction style in tests.

---

## 5. Does a PRD-diff classifier (`COSMETIC` / `SUBSTANTIVE` / `CLEAN` / `DIRTY`) already exist?

**No.** Searched `src/` and `tests/` case-insensitively for
`classifier|classification|COSMETIC|SUBSTANTIVE|DIRTY|CLEAN` plus targeted
`classify*` / `classifyPRD` / `classifyDiff` / `classifyChange`. Results:

- **No** module named `classifier` / `*-classifier` exists.
- **No** `COSMETIC` / `SUBSTANTIVE` enum/constant anywhere.
- **No** `classifyDiff`, `classifyPRD`, `classifyChange`, or similar functions.
- The existing `classify*` functions are unrelated domains:
  - `src/core/task-retry-manager.ts:369` — `classifyError(error): 'retryable' | 'permanent' | 'unknown'` (error classification).
  - `src/utils/eslint-error-verifier.ts:183` — `classifyErrors()` (ESLint critical vs deferrable).
  - `src/utils/pass-rate-analyzer.ts:365` — `classifyFailures()` (test pass/acceptable).
- The string `cosmetic` appears ONLY in the **bug-severity** domain
  (`src/core/models.ts:1749` → `BugSeverity = 'critical' | 'major' | 'minor' | 'cosmetic'`),
  in the bug-hunt/fix-cycle workflows' severity filtering, and as a few-shot
  example label "Example 2: Cosmetic Change (Ignore)" in
  `src/agents/prompts.ts:903`. None of these constitute a diff classifier.
- `dirty` appears ONLY as a private session-state batching flag
  (`src/core/session-manager.ts:175` → `#dirty: boolean`).

> **Implication for the new task:** a PRD-diff `COSMETIC`/`SUBSTANTIVE`
> classifier is a **net-new** module. There is no existing classification
> scaffold to extend. The closest in-domain precedent is `hasSignificantChanges`
> in `src/core/prd-differ.ts:564`, which is a pure function taking a
> `DiffSummary` and returning `boolean` — a good structural template for a
> pure `classifyDiff(diff: DiffSummary): 'COSMETIC' | 'SUBSTANTIVE'` helper.

---

## 6. `tests/unit/agents/` — file list + mocking patterns

Directory: `tests/unit/agents/`

```
agent-factory.test.ts
cache-key-isolation.test.ts
cache-verification.test.ts
cleanup-agent.test.ts
commit-message-agent.test.ts
prompt-delivery.test.ts
prompts.test.ts
prp-executor.test.ts
prp-generator.test.ts
prp-runtime.test.ts
cache-verification.test.ts
_probe_g.test.ts  _probe_h.test.ts  _probe_i.test.ts  _probe_j.test.ts  _probe_k.test.ts  (probe files)
prompts/   (subdirectory)
```

### `agent-factory.test.ts` — NO top-level `vi.mock`

Notably, `tests/unit/agents/agent-factory.test.ts` does **not** mock
`groundswell` or itself at the module level. It calls the real
`createArchitectAgent()` / `createCoderAgent()` / etc. directly and only
asserts on the returned config object + that creation does not throw. It
stubs env vars per-block instead:

```ts
afterEach(() => {
  vi.unstubAllEnvs();
});
// ...
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
});
```

To satisfy 100% branch coverage it uses `it.each` over the full persona set,
including an **inline** `[['coder',true],['qa',true],['cleanup',true],['architect',false],['researcher',false]]`
array (deliberately NOT reusing the file-level `personas` array, which omits
`'cleanup'` — see the comment at `agent-factory.test.ts:139-141`).

### `cleanup-agent.test.ts` & `commit-message-agent.test.ts` — the factory-mock pattern

Both are the canonical templates for "test a factory that calls `createAgent`":

- `commit-message-agent.test.ts`: mocks `createBaseConfig` (sibling function in
  a separate module) AND `groundswell.createAgent` (captures config via
  `{ __cfg: cfg }`), imports `vi.mocked(createAgent)` as `mockCreateAgent`,
  then asserts on `mockCreateAgent.mock.calls[0][0] as { … }`.
- `cleanup-agent.test.ts`: mocks `groundswell.createAgent` with
  `importOriginal` (to keep `MCPHandler`/`MCPServer`), plus stubs
  `config/environment.js` and `config/harness.js` to avoid real env/harness
  resolution, then lets the REAL `createCleanupAgent` + `createBaseConfig`
  run end-to-end.

### Prompt mocks (when a prompt module exists to mock)

`prp-generator.test.ts:27-34` — mock the prompt-builder module to a `vi.fn()`:

```ts
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createResearcherAgent: vi.fn(),
}));

vi.mock('../../../src/agents/prompts/prp-blueprint-prompt.js', () => ({
  createPRPBlueprintPrompt: vi.fn(),
}));
```

`prp-executor.test.ts:29-31` — prompts module mocked to a constant string:

```ts
vi.mock('../../../src/agents/prompts.js', () => ({
  PRP_BUILDER_PROMPT: '# Execute BASE PRP\n\n## PRP File: $PRP_FILE_PATH',
}));
```

---

## Architecture (how the pieces connect)

```
tests/unit/core/prd-differ.test.ts ──imports──> src/core/prd-differ.ts
   (pure fns; no mocks)             defines     DiffSummary, SectionChange,
                                                  diffPRDs(), hasSignificantChanges()

tests/unit/workflows/<wf>.test.ts ──vi.mock──> src/agents/agent-factory.js
   (Strategy A)                      ──vi.mock──> src/agents/prompts/<prompt>.js
        │                            injects { prompt: vi.fn().mockResolvedValue(AgentResponse<T>) }
        └──> asserts on AgentResponse.data

tests/unit/agents/<factory>.test.ts ──vi.mock('groundswell')──> createAgent: (cfg) => ({ __cfg: cfg })
   (Strategy B)                      ──vi.mock──> src/agents/agent-factory.js (createBaseConfig)
        │                            lets real factory run, asserts on captured cfg
        └──> vi.mocked(createAgent).mock.calls[0][0]
```

Both strategies feed into the same vitest pipeline
(`pool: 'forks'`, `setupFiles: ['./tests/setup.ts']`, 100% thresholds). A new
agent/workflow test should pick the strategy that matches what the new code
owns: factory ⇒ Strategy B (capture config); workflow ⇒ Strategy A (inject
`prompt` spy returning `AgentResponse`).

---

## Start Here

1. **`tests/unit/core/prd-differ.test.ts`** — the canonical pure-function unit
   test: Setup/Execute/Verify + GIVEN/SHOULD style, `DiffSummary` literal
   construction, relative `.js` import. The first file to open if writing a
   pure `classifyDiff(diff)` unit test.
2. **`tests/unit/agents/commit-message-agent.test.ts`** — the canonical
   "test an agent factory" mock boilerplate (`vi.mock('groundswell', …)` with
   `{ __cfg: cfg }` capture). Open this if the new classifier is built as an
   agent factory.
3. **`tests/unit/workflows/delta-analysis-workflow.test.ts`** — the canonical
   "test a workflow that calls an agent" mock boilerplate (`vi.mock` on the
   factory + prompt, inject `{ prompt: vi.fn().mockResolvedValue(AgentResponse) }`).
   Open this if the new classifier is a workflow step.
4. **`src/core/prd-differ.ts:111-164`** — exact `DiffSummary`/`SectionChange`
   types the classifier will consume.

## Open questions / risks

- A PRD-diff classifier does not exist; it is net-new. The PRD (not examined in
  this scout) should be the source of truth for whether the classifier is
  (a) a pure function on `DiffSummary` (mirrors `hasSignificantChanges`) or
  (b) an LLM agent (mirrors `DeltaAnalysisWorkflow`). The mock strategy
  differs between the two (Strategy A vs no-mock pure-fn test).
- 100% branch coverage is enforced — any new module needs an explicit
  edge-case `GIVEN` block per branch.
- `groundswell` resolves to a sibling built package
  (`../groundswell/dist/index.js`); `vi.mock('groundswell', …)` is the only
  way to avoid hitting the real dist in unit tests.