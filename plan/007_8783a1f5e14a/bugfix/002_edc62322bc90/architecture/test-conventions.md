# Test Conventions & Patterns — Auth Preflight / Harness Config

Scout report covering the six specified test files plus the global setup file
and `vitest.config.ts`. All findings are quoted from actual code so downstream
implementation agents can mirror patterns exactly.

---

## 1. Test runner / framework

**Vitest**, ESM TypeScript, Node environment, globals enabled.

`vitest.config.ts` (lines 13-18):
```ts
test: {
  environment: 'node',
  globals: true,
  include: ['tests/**/*.{test,spec}.ts'],
  exclude: ['**/dist/**', '**/node_modules/**'],
  setupFiles: ['./tests/setup.ts'],
```

Imports in every test file follow this exact shape:
```ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
```

Coverage is enforced at **100% across statements/branches/functions/lines**
(`vitest.config.ts` lines 45-51) for `src/**/*.ts`. Pool is `forks` with a
4 GB memory limit.

`resolve.alias.groundswell` points at `../groundswell/dist/index.js` — this is
**critical**: in-process imports of `groundswell` hit the *fixed* sibling dist,
not `node_modules/groundswell`. Tests that need the *real* stale dist must run
in a subprocess (see §4).

---

## 2. process.env sandboxing

Two complementary techniques are used, always together:

### (a) `vi.stubEnv` / `vi.unstubAllEnvs`

Used for setting individual env vars in a test body or `beforeEach`. Restored
globally via `vi.unstubAllEnvs()` in `afterEach`.

### (b) Direct `delete process.env[...]` for a known var list

`vi.stubEnv` only stubs vars you set; it does NOT clear vars already present
(especially after `tests/setup.ts` runs `dotenv.config()` which pollutes
`.env`). So tests explicitly `delete` an enumerated auth-var list in
`beforeEach`.

**Canonical pattern — `tests/unit/config/auth-preflight.test.ts` (lines 39-62):**
```ts
const AUTH_VARS = [
  'ZAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'PRP_API_KEY',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'PRP_AGENT_HARNESS',
] as const;

let tmpAgentDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // Clear all auth env vars (tests/setup.ts runs dotenv.config() which pollutes from .env)
  for (const v of AUTH_VARS) {
    delete process.env[v];
  }
  // MANDATORY: AuthStorage.create() reads ~/.pi/agent/auth.json unless PI_CODING_AGENT_DIR
  // is overridden.
  tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpAgentDir, { recursive: true, force: true });
});
```

**Lighter pattern — `tests/unit/config/harness-provider-compat.test.ts` (lines 42-45):**
```ts
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PRP_AGENT_HARNESS;
  vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
});
afterEach(() => vi.unstubAllEnvs());
```

**Note:** `tests/setup.ts` already calls `vi.unstubAllEnvs()` in its own global
`afterEach`, but every test file ALSO calls it locally for belt-and-suspenders
isolation. Mirror this.

`PI_CODING_AGENT_DIR` is the **mandatory override** to avoid touching the real
`~/.pi/agent/auth.json`. It is set to a fresh `mkdtempSync` dir per test and
removed in `afterEach`.

---

## 3. Module isolation / import strategy

**No `vi.resetModules()` and no dynamic `import()` for fresh module state in any
of the six files.** Instead, modules are imported statically at top-level AFTER
all `vi.mock()` calls (Vitest hoists `vi.mock` automatically so the mock is in
place before the static import runs).

```ts
vi.mock('groundswell', () => ({ ... }));   // hoisted — runs first

import { configureHarness } from '../../../src/config/harness.js';  // resolves against the mock
```

### The `groundswell` mock (mandatory for any file importing `src/config/harness.ts`)

`harness.ts` imports `groundswell` at module top-level. Without this mock the
import fails with "Cannot find module 'groundswell'" in unit tests (the alias
points to a dist that may not exist in CI). The mock shape is identical across
`auth-preflight.test.ts`, `harness-provider-compat.test.ts`, and
`harness-config.test.ts`:

```ts
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));
```

### `vi.hoisted()` for controllable mock fns referenced inside the factory

When the mock factory needs to reference a `vi.fn()` that the test body will
later reconfigure, `vi.hoisted()` lifts it above the hoist boundary.
**`tests/unit/config/harness-config.test.ts` (lines 21-25):**
```ts
const { mockHas, mockRegister, mockInitializeProvider } = vi.hoisted(() => ({
  mockHas: vi.fn(() => false),
  mockRegister: vi.fn(),
  mockInitializeProvider: vi.fn(),
}));

vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({
      has: mockHas,
      register: mockRegister,
      initializeProvider: mockInitializeProvider,
    }),
  },
  PiHarness: class MockPiHarness {},
}));
```

### Other module mocks

`tests/unit/cli/index.test.ts` mocks `node:fs` and the logger:
```ts
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));
```

**Key implication for downstream agents:** if you add a new test that imports
anything from `src/config/harness.ts`, you MUST include the `groundswell`
`vi.mock` at the top, or the import will throw.

---

## 4. Exercising the built dist (subprocess)

Two distinct subprocess patterns exist. Neither uses `child_process.exec` —
both use `spawnSync` from `node:child_process`.

### Pattern A — spawn the compiled `dist/index.js` (acceptance / exit-code tests)

**`tests/unit/config/auth-preflight.test.ts` (lines 188-246):**
```ts
const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip('acceptance (a) — no-credential aborts at startup ...', () => {
  it('exits 1, prints the preflight message on stderr, creates no plan/ session dir', () => {
    const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
    const prdAbs = resolve(process.cwd(), 'PRD.md');
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: process.env.SHELL,
      PI_CODING_AGENT_DIR: tmpAgentDir, // SCRUBBED — no creds
    };
    // ...
    const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], {
      encoding: 'utf8',
      timeout: 20_000,
      env,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Authentication preflight failed');
```

**Conventions:**
- Guard with `existsSync(CLI)` and switch to `describe.skip` when no build
  exists (so `vitest` unit runs don't fail without a prior `tsc`/build).
- Pass a **scrubbed `env`** containing only `PATH`, `HOME`, `USER`, `SHELL`,
  and `PI_CODING_AGENT_DIR` — this prevents real dev credentials from leaking
  into the subprocess.
- Assert `res.status` (exit code), `res.stderr`/`res.stdout` (message text).

### Pattern B — spawn `tsx` to hit the REAL `node_modules/groundswell`

**`tests/integration/config/pi-harness-auth.test.ts` (lines 60-72, 117-140):**

A runner script is written to the project root at runtime
(`_pi-harness-auth-runner.mjs`, cleaned up in `afterEach`) and executed via
`node_modules/.bin/tsx`. Because the subprocess has no Vitest resolve alias,
its `import 'groundswell'` resolves to the real `node_modules/groundswell`.

```ts
const TSX = resolve('node_modules/.bin/tsx');
const RUNNER = resolve('_pi-harness-auth-runner.mjs');
// ...
const env: Record<string, string | undefined> = { ...process.env };
for (const k of AUTH_VARS) delete env[k];
env.PI_CODING_AGENT_DIR = tmp;
const res = spawnSync(TSX, [RUNNER], { env, encoding: 'utf8', timeout: 30_000 });
const m = (res.stdout ?? '').match(/RESULT key=(.*)$/m);
```

The runner uses a machine-parseable `RESULT key=<JSON>` / `RESULT ERROR=<msg>`
protocol printed to stdout. This file's header comment explicitly warns:
> Do NOT "simplify" to in-process await — the vitest alias would mask the bug.

---

## 5. Naming conventions for describe / it

| Element | Convention | Example |
|---|---|---|
| Top-level `describe` | The function or module under test | `'runAuthPreflight'`, `'config/harness'`, `'cli/index'` |
| Nested `describe` | A logical group / acceptance case | `'parseCLIArgs'`, `'constants'`, `'HarnessProviderMismatchError'`, `'ensureHarnessInitialized'` |
| `describe.skip` guard | For build-dependent subprocess suites | `const describeOrSkip = hasBuild ? describe : describe.skip;` |
| Acceptance `describe` | Prefixed `acceptance (X) — <summary>` citing PRD section | `'acceptance (a) — no-credential aborts at startup: exit 1, single message, NO session dir'` |
| `it` titles | Behaviour-focused, often with a leading `(letter)` tag matching a contract matrix | `'(a) pi + zai succeeds and resolves the default harness to pi'`, `'(b) claude-code + zai throws ...'` |
| `it` body comments | SETUP / EXECUTE / VERIFY section dividers inside the test body | ```// SETUP\ // EXECUTE & VERIFY``` |

File headers are rich JSDoc `@remarks` blocks citing the PRD section
(e.g. `PRD §9.2.7`, `PRD §9.4.3 / §9.2.4`) and listing the exact cases covered.

---

## 6. Existing exit-code / clean-error-message assertions

### AuthPreflightError — assertions exist in `auth-preflight.test.ts`

- **In-process throw + message contents** (lines 99-114, 153-184):
  ```ts
  await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
  // ...then re-run and inspect:
  expect(caught).toBeInstanceOf(AuthPreflightError);
  expect(caught!.message).toContain("provider 'zai'");
  expect(caught!.message).toContain('ZAI_API_KEY');
  expect(caught!.message).toContain('auth.json');
  expect(caught!.message).toContain('pi /login');
  ```
- **Structured error fields** (lines 153-184): `err.harness`, `err.provider`,
  `err.model`, `err.name === 'AuthPreflightError'`.
- **Subprocess exit code + stderr message + no session dir** (lines 215-246):
  ```ts
  expect(res.status).toBe(1);
  expect(res.stderr).toContain('Authentication preflight failed');
  expect(res.stderr).not.toContain('PRD file not found');
  // Compares plan/ dir listing before/after to prove no session dir created.
  ```

### HarnessProviderMismatchError — assertions exist in three files

- **`harness-provider-compat.test.ts`** (lines 76-103): full shape + message
  ```ts
  expect(err!).toBeInstanceOf(HarnessProviderMismatchError);
  expect(err!.name).toBe('HarnessProviderMismatchError');
  expect(err!.harness).toBe('claude-code');
  expect(err!.provider).toBe('zai');
  expect(err!.message).toContain('§9.2.4');
  expect(err!.message).toContain('pi');        // switch-harness remediation
  expect(err!.message).toContain('anthropic'); // switch-provider remediation
  expect(configureHarnesses).not.toHaveBeenCalled();
  ```
- **`harness-config.test.ts`** (lines 119-141): `expect(() => configureHarness()).toThrow(HarnessProviderMismatchError)` plus field/message checks.
- **`harness.test.ts`** (lines 95-130): class-level constructor tests for
  `HarnessProviderMismatchError` — `instanceof Error`, `.name`, `.harness`,
  `.provider`, message contains both values.

### process.exit assertions (CLI)

`tests/unit/cli/index.test.ts` mocks `process.exit` to throw, then asserts:
```ts
mockExit = vi.fn((code: number) => { throw new Error(`process.exit(${code})`); });
process.exit = mockExit as any;
// ...
expect(() => parseCLIArgs()).toThrow('process.exit(1)');
expect(mockExit).toHaveBeenCalledWith(1);
expect(mockLogger.error).toHaveBeenCalledWith(
  expect.stringContaining('PRD file not found')
);
```

---

## 7. Global setup nuances (`tests/setup.ts`)

- Runs `dotenv.config()` at load → **pollutes `process.env` from `.env`**. This
  is why every auth-touching test must `delete` auth vars in `beforeEach`.
- Provides a global `beforeEach` that calls `vi.clearAllMocks()` and
  `validateProviderEndpoint()` (z.ai safeguard).
- Provides a global `afterEach` that calls `vi.unstubAllEnvs()`, forces GC if
  available, and **fails the test on any unhandled promise rejection** captured
  during the test.
- Test files still define their OWN `beforeEach`/`afterEach` for
  file-specific cleanup; Vitest runs both global and local hooks.

---

## 8. Start-here summary for a downstream agent adding a new test

1. Copy the header JSDoc style; cite the PRD section you're covering.
2. Import `{ beforeEach, afterEach, describe, expect, it, vi } from 'vitest'`.
3. If the test imports anything from `src/config/harness.ts`, paste the
   mandatory `vi.mock('groundswell', ...)` block at the top.
4. In `beforeEach`: `vi.clearAllMocks()`, `delete` every auth-related env var
   from a `const AUTH_VARS = [...] as const` list, and
   `vi.stubEnv('PI_CODING_AGENT_DIR', mkdtempSync(...))`.
5. In `afterEach`: `vi.unstubAllEnvs()` and `rmSync(tmpDir, { recursive: true, force: true })`.
6. For exit-code/CLI acceptance tests: use `spawnSync(process.execPath, [CLI, ...])`
   with a scrubbed `env` object, guard with `describeOrSkip = existsSync(CLI) ? describe : describe.skip`.
7. For tests that must hit the REAL `node_modules/groundswell` (not the alias):
   write a runner `.mjs` to the project root, spawn via
   `node_modules/.bin/tsx`, parse a `RESULT key=<JSON>` protocol line.
