# Scout Report: Retry/Resilience Infrastructure, Logger, Core Models, npm Scripts

Target: `src/utils/retry.ts`, `src/utils/logger.ts`, `src/core/models.ts`,
`src/core/index.ts`, workflow `agent.prompt()` wrapping, and `package.json`
scripts. All paths + line numbers below are from the current working tree.

---

## 1. `src/utils/retry.ts` — Full API Surface

File: `src/utils/retry.ts` (single file, ~810 lines, ESM with `.js` imports).

### 1.1 `RetryOptions` interface (lines 175-249)

```ts
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). Total = maxAttempts (1 initial + maxAttempts-1 retries). */
  maxAttempts?: number;
  /** Base delay before first retry in ms (default: 1000). */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 30000). */
  maxDelay?: number;
  /** Exponential backoff multiplier (default: 2). delay = min(baseDelay*backoffFactor^attempt, maxDelay) */
  backoffFactor?: number;
  /** Jitter factor 0-1 (default: 0.1). Positive-only jitter. */
  jitterFactor?: number;
  /** Custom predicate. If provided, OVERRIDES default isTransientError. */
  isRetryable?: (error: unknown) => boolean;
  /** Callback before each retry: (attempt1indexed, error, delayMs). */
  onRetry?: (attempt: number, error: unknown, delay: number) => void;
}
```

### 1.2 `retry()` function signature (lines ~546-602)

```ts
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T>
```

Defaults destructured inside (lines 549-556): `maxAttempts=3`, `baseDelay=1000`,
`maxDelay=30000`, `backoffFactor=2`, `jitterFactor=0.1`,
`isRetryable = isTransientError`, `onRetry` (optional).

Flow: try `fn()` → on throw, if `!isRetryable(error)` throw immediately;
if last attempt, throw; else `calculateDelay(...)` → `onRetry?.(...)`
→ `await sleep(delay)` → loop. Note: `attempt` is 0-indexed in the loop,
`onRetry` is called with `attempt + 1` (1-indexed).

Supporting helpers exported: `sleep(ms)` (line ~131), `calculateDelay(attempt, baseDelay, maxDelay, backoffFactor, jitterFactor)` (line ~156) — positive-only jitter.

### 1.3 Transient error detection — `isTransientError()` (lines ~311-395)

```ts
export function isTransientError(error: unknown): boolean
```

Order of checks (important — order matters):
1. **Null/primitive check** → `false` (lines ~315-317).
2. **Watchdog kill** (`isWatchdogKillResult`, lines ~270-286): `error.timedOut === true` OR `error.exitCode === 124` → **`false` (TERMINAL, PRD §9.3.2)**. Runs BEFORE message-pattern fallback.
3. **PipelineError** (`isPipelineError`, lines ~326-337): if message includes `parse`/`parsing` → `false`. Otherwise transient iff code is `ErrorCodes.PIPELINE_AGENT_TIMEOUT` OR `ErrorCodes.PIPELINE_AGENT_LLM_FAILED`.
4. **ValidationError** (`isValidationError`) → `false` (permanent).
5. **Node.js system error code** → `true` if in `TRANSIENT_ERROR_CODES`.
6. **HTTP status** (`err.response?.status`) → `true` if in `RETRYABLE_HTTP_STATUS_CODES`.
7. **Message-pattern fallback** → `true` if lowercase message contains any `TRANSIENT_PATTERNS` substring.

**`TRANSIENT_ERROR_CODES` set (lines 55-66):**
`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EPIPE`, `EAI_AGAIN`,
`EHOSTUNREACH`, `ENETUNREACH`, `ECONNABORTED`.

**`RETRYABLE_HTTP_STATUS_CODES` set (lines 78-85):**
`408` (Request Timeout), `429` (Too Many Requests / rate limit),
`500` (Internal Server Error / overloaded), `502` (Bad Gateway),
`503` (Service Unavailable), `504` (Gateway Timeout).

**`TRANSIENT_PATTERNS` array (lines 94-106):**
`'timeout'`, `'network error'`, `'temporarily unavailable'`,
`'service unavailable'`, `'connection reset'`, `'connection refused'`,
`'rate limit'`, `'too many requests'`, `'econnreset'`, `'etimedout'`.

**Note:** There is NO "empty output" detection in `isTransientError`. Empty
LLM output is not treated as transient here — it would only surface via a
thrown error matching the patterns above. The wrapping workflows handle
empty output downstream (e.g. `agentResponse.status !== 'success'` checks).

`isPermanentError(error)` (lines ~432-490) is the inverse — checks watchdog
kill, ValidationError, PIPELINE_AGENT_PARSE_FAILED, 4xx (except 408/429), and
`PERMANENT_PATTERNS`.

### 1.4 `retryAgentPrompt()` helper (lines ~668-698)

```ts
const AGENT_RETRY_CONFIG: Required<Omit<RetryOptions, 'isRetryable' | 'onRetry'>> = {
  maxAttempts: 3, baseDelay: 1000, maxDelay: 30000, backoffFactor: 2, jitterFactor: 0.1,
};

export async function retryAgentPrompt<T>(
  agentPromptFn: () => Promise<T>,
  context: { agentType: string; operation: string }
): Promise<T> {
  return retry(agentPromptFn, {
    ...AGENT_RETRY_CONFIG,
    onRetry: createDefaultOnRetry(`${context.agentType}.${context.operation}`),
  });
}
```

Uses default `isRetryable = isTransientError`. Logs via
`createDefaultOnRetry(operationName, maxAttempts)` (lines ~620-660) which
emits `logger().warn({operation, attempt, maxAttempts, delayMs, errorName, errorCode, errorMessage}, msg)`.

### 1.5 Other helpers in retry.ts

- `withAgentDeadline<T>(promise)` (lines ~704-735): races a promise against
  `RESEARCH_TIMEOUT` (from `getResearchTimeoutSeconds()`). On expiry throws a
  **transient** `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`) so the
  surrounding `retryAgentPrompt` re-attempts. Imported from
  `../config/constants.js`.
- `retryMcpTool<T>(toolFn, { toolName, operation })` (lines ~781-790):
  `MCP_RETRY_CONFIG` = `{ maxAttempts: 2, baseDelay: 500, maxDelay: 5000 }`,
  custom `isRetryable` extends `isTransientError` with message matches.

Imports in retry.ts (lines 28-32):
```ts
import { getLogger, type Logger } from './logger.js';
import { isValidationError, isPipelineError, ErrorCodes, AgentError, type PipelineError } from './errors.js';
import { getResearchTimeoutSeconds } from '../config/constants.js';
```

---

## 2. Workflow `agent.prompt()` Wrapping Pattern

All four call sites use **`retryAgentPrompt()` directly** (NOT bare `retry()`).
Consistent two-arg shape: `() => agent.prompt(prompt)` + `{ agentType, operation }`.

### 2.1 `src/workflows/bug-hunt-workflow.ts` (lines 34, 292-296)
```ts
import { retryAgentPrompt } from '../utils/retry.js';                       // line 34
// ...
const agentResponse = await retryAgentPrompt(
  () => qaAgent.prompt(prompt),
  { agentType: 'QA', operation: 'bugHunt' }
);
```

### 2.2 `src/workflows/delta-analysis-workflow.ts` (lines 26, 131-135)
```ts
import { retryAgentPrompt } from '../utils/retry.js';                       // line 26
// ...
const agentResponse = await retryAgentPrompt(
  () => qaAgent.prompt(prompt),
  { agentType: 'QA', operation: 'deltaAnalysis' }
);
```

### 2.3 `src/agents/prp-executor.ts` (lines 30, 332-336, 639-641)
```ts
import { retryAgentPrompt, withAgentDeadline } from '../utils/retry.js';    // line 30
// ...
const coderAgentResponse = await retryAgentPrompt(
  () => withAgentDeadline(this.#coderAgent.prompt(injectedPrompt)),
  { agentType: 'Coder', operation: 'executePRP' }
);
// ...
await retryAgentPrompt(() => this.#coderAgent.prompt(fixPrompt), {
  agentType: 'Coder', operation: 'applyFix',     // (line ~639-641 — fix loop)
});
```
**Pattern variant:** wraps the inner call in `withAgentDeadline(...)` to bound
hung LLM calls BEFORE retry. This is the deadline-bounded pattern.

### 2.4 Other call sites (for reference)
- `src/workflows/prp-pipeline.ts` (lines 53, 796-799): Architect agent,
  `{ agentType: 'Architect', operation: 'decomposePRD' }`.
- `src/agents/prp-generator.ts` (lines 32, 688-690): Researcher PRP
  generation; also uses `withAgentDeadline` (line ~717).

**Conclusion:** The wrapping convention is uniform — every agent.prompt()
call goes through `retryAgentPrompt(fn, { agentType, operation })`. Bare
`retry()` is used only in non-agent contexts (e.g. `utils/git-commit.ts:494`,
which uses `COMMIT_RETRY_*` constants per its own docstring, explicitly
NOT `retryAgentPrompt`).

---

## 3. `src/utils/logger.ts` — Logger API & Lazy Pattern

### 3.1 Public API
```ts
export function getLogger(context: string, options?: LoggerConfig): Logger   // line ~440
export function clearLoggerCache(): void                                     // line ~480
export function getGlobalConfig(): Readonly<LoggerConfig>                    // line ~490
export enum LogLevel { TRACE, DEBUG, INFO, WARN, ERROR, FATAL }              // line ~70
export interface Logger { trace/debug/info/warn/error/fatal(...); child(bindings): Logger }  // line ~90
export interface LoggerConfig { level?; machineReadable?; verbose?; correlationId?; component? }
```

`getLogger(context)` returns a **cached** child of a process-wide root pino
(one root per output mode: pretty vs JSON). Auto-generates a correlation ID
on first call. Importing `logger.ts` has **zero side effects** — pino is
loaded lazily inside the first `getLogger()` call.

### 3.2 Lazy-instantiation pattern used across core modules

The dominant idiom (a module-private accessor that memoizes the logger):

```ts
import { getLogger, type Logger } from '../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ModuleName'));
```

Confirmed identical pattern in (at least):
- `src/utils/retry.ts:628-629` — `getLogger('retry')`
- `src/core/dependency-validator.ts:44-45` — `'DependencyValidator'`
- `src/core/state-validator.ts:38-39` — `'StateValidator'`
- `src/core/task-patcher.ts:26-27` — `'TaskPatcher'`
- `src/core/session-utils.ts:47-48` — `'session-utils'`
- `src/core/file-lock.ts:76-77` — `'file-lock'`
- `src/core/cleanup-runner.ts:31-32` — `'CleanupRunner'` (uses `ReturnType<typeof getLogger>` for the var type)
- `src/core/tasks-json-recovery.ts:41-42` — `'tasks-json-recovery'`
- `src/agents/agent-factory.ts:64-65` — `'AgentFactory'`
- `src/agents/commit-message-agent.ts:53-54` — `'CommitMessageAgent'`
- `src/utils/build-logger.ts:37-38` — `'BuildLogger'`

**Variation:** Some modules (cleanup-runner, commit-message-agent) type the
private var as `ReturnType<typeof getLogger>` instead of importing the
`Logger` type alias — both are functionally identical.

**Legacy alternative also present:** Some modules (e.g. `prp-executor.ts`,
`bug-hunt-workflow.ts`) use a `this.#logger` / `this.logger` field assigned
in the constructor via `getLogger('...')` instead of the module-private
accessor — the lazy memoization is then lost (logger is created at
construction time). For new modules, prefer the module-private
`_logger ??= getLogger(...)` accessor idiom for true lazy instantiation.

---

## 4. `src/core/models.ts` & `src/core/index.ts` — Classification unions & re-exports

### 4.1 Existing union/enum patterns in `src/core/models.ts`

The file uses a **consistent dual-declaration** pattern: a TS string-literal
union type paired with a Zod `z.enum([...])` runtime schema. There is **no
single "classification" enum**; relevant existing unions are:

| Name | Type literals | Zod schema | Lines |
|---|---|---|---|
| `Status` | `'Planned' \| 'Researching' \| 'Ready' \| 'Implementing' \| 'Retrying' \| 'Complete' \| 'Failed' \| 'Obsolete'` | `StatusEnum` | ~160-185 |
| `ItemType` | `'Phase' \| 'Milestone' \| 'Task' \| 'Subtask'` | `ItemTypeEnum` | ~200-215 |
| `PRPCompressionLevel` | `'off' \| 'standard' \| 'aggressive'` | `PRPCompressionLevelSchema` | ~45-78 |
| `BugSeverity` | `'critical' \| 'major' \| 'minor' \| 'cosmetic'` | `BugSeverityEnum` | ~1786-1806 |
| `RequirementChange['type']` | `'added' \| 'modified' \| 'removed'` | inline `z.enum(...)` | ~1725-1745 |
| `PRPArtifact['status']` | `'Generated' \| 'Executing' \| 'Completed' \| 'Failed'` | `z.union([z.literal(...), ...])` | ~1610-1640 |
| `ValidationGate['level']` | `1 \| 2 \| 3 \| 4 \| 5` (numeric literal) | custom transform | ~1380-1420 |

Template to follow when adding a new classification union:
```ts
export type NewClassification = 'a' | 'b' | 'c';
export const NewClassificationEnum = z.enum(['a', 'b', 'c']);
```

### 4.2 `src/core/index.ts` re-export pattern

Two `export` blocks: one `export type { ... }` for types/interfaces, one
plain `export { ... }` for runtime values (classes, functions, Zod schemas).
Examples (full file ~75 lines):

```ts
// Type definitions and models
export type {
  Backlog, Phase, Milestone, Task, Subtask, Status, ItemType,
  SessionState, SessionMetadata, DeltaSession, ValidationGate,
  SuccessCriterion, PRPDocument, PRPArtifact, RequirementChange,
  DeltaAnalysis, BugSeverity, Bug, TestResults,
} from './models.js';

export {
  StatusEnum, ItemTypeEnum, BacklogSchema, PhaseSchema, MilestoneSchema,
  TaskSchema, SubtaskSchema, ContextScopeSchema, ValidationGateSchema,
  SuccessCriterionSchema, PRPDocumentSchema, PRPArtifactSchema,
  RequirementChangeSchema, DeltaAnalysisSchema, BugSeverityEnum,
  BugSchema, TestResultsSchema,
} from './models.js';
```

Also re-exports from siblings: `SessionManager`, `TaskOrchestrator`,
`ResearchQueue`, `ResearchTimeoutError`, session-utils helpers,
`EnvironmentError`, `diffPRDs`/`hasSignificantChanges`/`parsePRDSections`/
`normalizeMarkdown`, `generateSectionIndex`/`extractPRDSections`,
`patchBacklog`, and prd-differ types (`PRDSection`, `SectionChange`,
`DiffSummary`) + `SectionIndex`/`SelectorType`.

**To add a new union:** add the type to the `export type { ... } from './models.js'`
block and the Zod schema to the `export { ... } from './models.js'` block.

---

## 5. `package.json` — Exact npm script commands

File: `package.json`, `scripts` block. The exact command strings for the
five requested scripts:

| Script | Exact command |
|---|---|
| **`validate`** | `npm run lint && npm run format:check && npm run typecheck && npm run test:run` |
| **`test`** | `vitest` (watch mode by default) |
| **`test:run`** | `vitest run` (single-shot) |
| **`lint`** | `eslint . --ext .ts` |
| **`typecheck`** | `tsc --noEmit -p tsconfig.build.json` |
| **`build`** | `tsc -p tsconfig.build.json` |

Supporting/related (handy context):
- `lint:fix` = `eslint . --ext .ts --fix`
- `format` = `prettier --write "**/*.{ts,js,json,md,yml,yaml}"`
- `format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`
- `prebuild` = `npm run lint && npm run typecheck` (runs before `build`)
- `test:coverage` = `vitest run --coverage`
- `test:bail` = `vitest run --bail=1`
- `fix` = `npm run lint:fix && npm run format`

Notes:
- `validate` chains all four gates in order; `format:check` is between lint
  and typecheck. A failing script short-circuits the chain.
- `typecheck` and `build` both reference `tsconfig.build.json` (not
  `tsconfig.json`).
- `prebuild` does NOT include `format:check` (only `lint` + `typecheck`).

---

## Key Architecture / How Pieces Connect

1. **Resilience boundary = agent.prompt() call site.** Every LLM call is
   wrapped by `retryAgentPrompt(() => agent.prompt(prompt), {agentType, operation})`
   at the call site. The default `isRetryable = isTransientError` handles
   429/5xx/ECONN*/timeout/AgentError(PIPELINE_AGENT_TIMEOUT|LLM_FAILED).
2. **Deadline + retry are composable.** `withAgentDeadline()` converts a
   hung LLM call into a transient `AgentError`, then `retryAgentPrompt`
   re-attempts. Used in `prp-executor.ts` and `prp-generator.ts`.
3. **Watchdog kills are explicitly terminal.** `isWatchdogKillResult`
   (timedOut:true OR exitCode:124) short-circuits BEFORE the message-pattern
   fallback — so subprocess timeouts (PRD §9.3.2) are never retried, while
   LLM-call timeouts ARE retried. This distinction is critical.
4. **Logger is process-wide cached, lazy-loaded.** `getLogger(context)`
   builds a pino child off one of two memoized roots (pretty / JSON). New
   modules should use the `let _logger; const logger = () => (_logger ??= getLogger('Name'))`
   accessor for true lazy instantiation.
5. **Models use the type + Zod-enum dual-declaration convention.** New
   classification unions should add both a TS union and a `z.enum([...])`
   schema, then re-export both from `core/index.ts`.

---

## Start Here

Open `src/utils/retry.ts` first — it is self-contained and documents the
entire retry contract (`RetryOptions`, `retry()`, `isTransientError()`,
`isPermanentError()`, `isWatchdogKillResult()`, `retryAgentPrompt()`,
`withAgentDeadline()`, `retryMcpTool()`). Then read `src/utils/logger.ts`
for the lazy `getLogger()` pattern. For wrapping convention, copy any of
the four call sites (e.g. `src/workflows/delta-analysis-workflow.ts:131-135`).

## Risks / Open Questions

- **No "empty output" retry.** `isTransientError` only inspects thrown
  errors, not empty/success-but-empty responses. Workflows must continue to
  guard against `agentResponse.status !== 'success'` / empty `data`
  themselves (they do).
- **Two lazy-logger idioms coexist:** module-private `_logger ??=` accessor
  vs constructor-assigned `this.#logger = getLogger(...)`. Only the former
  is truly lazy. Pick the accessor form for new code.
- **`withAgentDeadline` imports `getResearchTimeoutSeconds`** from
  `../config/constants.js` (constants.ts:438, 496, 556 expose
  `*_MAX_ATTEMPTS`/`*_BASE_DELAY`/`*_MAX_DELAY` ms values feeding
  `retry()`'s options) — if you need retry config constants, look there.