# Test Infrastructure & Regression Analysis

## Issue 1: Logger Regression — Detailed Analysis

### The Offending Code (on `main` at `4e6d2ef`)

**File**: `src/utils/logger.ts`, inside `getLogger()` function, at **line 447–449**:

```typescript
export function getLogger(context: string, options?: LoggerConfig): Logger {
  // Check cache first
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Prevent MaxListenersExceededWarning from pino transport workers
  // Each transport worker attaches an exit listener to process
  if (!loggerCache.size) {
    process.setMaxListeners(30);   // <-- LINE 448: throws under partial process stub
  }

  // Auto-generate correlation ID if not provided
  const correlationId = options?.correlationId || generateCorrelationId();
  // ...
```

**Note**: The `loggerCache` is `const loggerCache = new Map<string, Logger>()` at line 204.
The guard `if (!loggerCache.size)` means this only runs on the FIRST logger creation (when cache is empty).

### Why It Breaks Tests

`tests/unit/utils/progress-display.test.ts` stubs `process` like this (line ~174):

```typescript
let originalProcess: any;

beforeEach(() => {
  clearLoggerCache();
  originalProcess = process;
});

it('should accept default options', () => {
  vi.stubGlobal('process', {
    ...originalProcess,                           // spread copies OWN enumerable props only
    stdout: { isTTY: true, ...originalProcess.stdout },
    on: vi.fn(),
    off: vi.fn(),
  });
  const display = new ProgressDisplay({ progressMode: 'always' });
  // ...
});
```

`process.setMaxListeners` is **inherited** from `EventEmitter.prototype`:

```
$ node -e "console.log(process.hasOwnProperty('setMaxListeners'))"
false
```

Object spread (`...originalProcess`) only copies **enumerable own** properties, so `setMaxListeners`
is absent from the stub. When `new ProgressDisplay()` triggers `getLogger('ProgressDisplay')` (via
the class field `readonly #logger = getLogger('ProgressDisplay')` at line 141 of progress-display.ts),
the unguarded `process.setMaxListeners(30)` throws `TypeError: process.setMaxListeners is not a function`.

### The Fix

```typescript
if (!loggerCache.size) {
  process.setMaxListeners?.(30);   // optional chaining — no-op under partial stub
}
```

This preserves production behavior (real `process` always has `setMaxListeners`) while being safe
in test environments with partial stubs.

### Where to Add the Regression Test

**File**: `tests/unit/logger.test.ts` (NOT `tests/unit/utils/logger.test.ts` — the PRD's suggested
path was slightly wrong; the actual file is at `tests/unit/logger.test.ts`).

**Existing structure** (470 lines):
- Imports: `{ getLogger, LogLevel, Logger, LoggerConfig, clearLoggerCache, getGlobalConfig }`
  from `'../../src/utils/logger.js'`
- `beforeEach`/`afterEach`: calls `clearLoggerCache()`
- `describe('Logger utility', ...)` containing:
  - `describe('LogLevel enum', ...)`
  - `describe('getLogger()', ...)` — tests caching, context, log levels
  - `describe('Log level filtering', ...)`
  - etc.

**Regression test to add** (inside the existing `describe('getLogger()')` block or as a new
`describe` block):

```typescript
it('should not throw when process lacks setMaxListeners (partial stub)', () => {
  const originalSetMaxListeners = process.setMaxListeners;
  // Simulate a partial process stub (like progress-display tests do)
  // by deleting the inherited property
  try {
    // Temporarily remove inherited setMaxListeners
    delete (process as any).setMaxListeners;
    // Should not throw — optional chaining makes it a no-op
    expect(() => getLogger('PartialStubTest')).not.toThrow();
  } finally {
    // Restore by re-adding the reference from prototype
    if (originalSetMaxListeners) {
      Object.defineProperty(process, 'setMaxListeners', {
        value: originalSetMaxListeners,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
});
```

Alternatively, use `vi.stubGlobal('process', { ...process, on: vi.fn(), off: vi.fn() })` (omit
`setMaxListeners`) and then `vi.unstubAllGlobals()` in cleanup. This more closely mirrors the
actual test failure scenario.

## Issue 2: Validate Script

### Current State (on `main` at `4e6d2ef`)

**File**: `package.json`
```json
"validate": "npm run lint && npm run format:check && npm run typecheck"
```

### Fix

```json
"validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run"
```

### Related Documentation

- **`docs/TESTING.md`**: Full testing strategy doc. Sections include "Testing Philosophy",
  "100% Coverage Requirement", "Layered Testing Approach", "Unit vs Integration vs E2E Tests",
  "Mocking Strategies". Should mention that `npm run validate` now includes `test:run`.
- **`README.md`** line 631: `| npm run validate | Run all validation checks |` — this description
  is already accurate but could note it includes tests.
- **`CONTRIBUTING.md`**: Does NOT exist on main. No action needed for this file.

## Vitest Configuration

**File**: `vitest.config.ts` (on main at `4e6d2ef`)

Key settings:
- `environment: 'node'`
- `globals: true`
- `include: ['tests/**/*.{test,spec}.ts']`
- `setupFiles: ['./tests/setup.ts']`
- `pool: 'forks'` with `maxForks: Math.min(os.cpus().length, 4)`, `memoryLimit: 4096`
- **Coverage thresholds**: 100% for statements, branches, functions, lines
- Aliases: `@` → `./src`, `#` → `./src/agents`
- `fs.allow: ['.', '..']`

### `tests/setup.ts`
Global setup that:
1. Loads `.env` file if present
2. Validates provider endpoint (z.ai API, not Anthropic)
3. Provides `beforeEach`/`afterEach` hooks for mock cleanup

## Test File Locations (on `main` at `4e6d2ef`)

### Unit tests
- `tests/unit/logger.test.ts` — Logger tests (470 lines)
- `tests/unit/utils/progress-display.test.ts` — Progress display tests (14 failing)
- `tests/unit/core/research-queue.test.ts` — Research queue unit tests
- `tests/unit/core/task-orchestrator.test.ts` — Orchestrator issue-loop tests
- `tests/unit/core/tasks-json-recovery.test.ts` — Recovery tests (real tmpdir git repos)
- `tests/unit/config/research-timeout.test.ts` — RESEARCH_TIMEOUT config tests
- `tests/unit/config/issue-retry-max.test.ts` — ISSUE_RETRY_MAX config tests

### Integration tests (existing)
- `tests/integration/core/task-orchestrator-e2e.test.ts` — Full orchestrator workflow
- `tests/integration/core/research-queue.test.ts` — ResearchQueue with mocked generator
- `tests/integration/core/session-manager.test.ts` — SessionManager integration
- `tests/integration/core/delta-session.test.ts` — Delta session tests
- `tests/integration/core/session-structure.test.ts` — Session structure tests
- `tests/integration/core/task-orchestrator.test.ts` — Orchestrator integration
- `tests/integration/core/task-orchestrator-runtime.test.ts` — Orchestrator runtime
