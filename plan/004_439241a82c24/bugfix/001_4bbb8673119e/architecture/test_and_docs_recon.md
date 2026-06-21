# Test & Docs Recon

Pure research — no files modified. All paths absolute; tests live under `/home/dustin/projects/hacky-hack/`.

## 1. `vitest.config.ts` — how tests run

File: `/home/dustin/projects/hacky-hack/vitest.config.ts` (whole file).

- Runner: `vitest` (invoked via `npm test` / `npm run test:run` / `test:watch` / `test:coverage` / `test:bail` — see `package.json` scripts lines 31-36).
- `test.environment: 'node'`, `test.globals: true`.
- `test.include: ['tests/**/*.{test,spec}.ts']`; `exclude: dist + node_modules`.
- **Setup/teardown**: `test.setupFiles: ['./tests/setup.ts']` (single global setup file — see §1a).
- **Mock modules**: no `server.deps.inline` / `vi.mock` declared at config level. Per-file `vi.mock(...)` is used inside individual test files (e.g. `tests/unit/groundswell/imports.test.ts:40` mocks `@anthropic-ai/sdk`). Globals `vi`, `beforeEach`, `afterEach`, `describe/it/expect` are available globally (no per-file import required, though files still import them).
- Coverage: `provider: 'v8'`, reporters `text/json/html`, **100% thresholds on statements/branches/functions/lines**, `include: ['src/**/*.ts']`.
- `resolve.alias`: `@` → `./src`, `#` → `./src/agents`, `groundswell` → `../groundswell/dist/index.js`. Extensions: `.ts`, `.js`, `.tsx`.
- `fs.allow: ['.', '..']` (lets tests reach the sibling `../groundswell` checkout).
- `esbuild.target: 'esnext'`; `tsconfigRaw` enables `experimentalDecorators` + `emitDecoratorMetadata`.

### 1a. Global setup (`tests/setup.ts`)

File: `/home/dustin/projects/hacky-hack/tests/setup.ts` (whole file). Runs once before all tests and via hooks per test.

- Loads `.env` via `dotenv` (quiet; missing file is fine).
- **z.ai API safeguard**: calls `validateProviderEndpoint()` (imported from `../src/config/endpoint-guard.js`) immediately on load AND inside every `beforeEach`. Throws on `api.anthropic.com`, warns on non-z.ai.
- `beforeEach`: `vi.clearAllMocks()`, re-validates endpoint, resets `unhandledRejections = []`, attaches a `process.on('unhandledRejection', …)` handler.
- `afterEach`: detaches the handler, **fails the test** if any unhandled promise rejections were captured (prints each), `vi.unstubAllEnvs()`, and runs `global.gc()` if `--expose-gc`.

Implication for Issue 1/2 work touching `src/config/harness.ts`: any new env-var reads inside harness logic will be exercised under `vi.stubEnv` patterns and must not leak (afterEach restores envs). Tests are expected to clear mocks between cases.

## 2. Test files under `tests/unit/` — relevant subset

Full listing of `tests/unit/**` is large (~95 files). Relevant to the issues:

### `tests/unit/config/harness.test.ts` ✅ exists (4252 bytes)
Top-level `describe('config/harness', …)`. Nested blocks + `it` titles (lines 28-119):
- `describe('constants')`
  - it: exports `PRP_AGENT_HARNESS` as the env-var name string
  - it: exports `DEFAULT_HARNESS` as `"pi"`
  - it: exports `DEFAULT_MODEL_PROVIDER` as `"zai"`
  - it: exports `SUPPORTED_HARNESSES` as a readonly tuple `["pi","claude-code"]`
- `describe('types')`
  - it: accepts valid `AgentHarness` values at compile time
  - it: accepts known `ModelProvider` values at compile time
  - it: accepts arbitrary strings for `ModelProvider` (open set)
- `describe('HarnessProviderMismatchError')`
  - it: is an instance of `Error`
  - it: has the correct error `name`
  - it: carries the harness value as a readonly field
  - it: carries the provider value as a readonly field
  - it: includes both harness and provider in the `message`

Note: this file currently exercises only constants, types, and the `HarnessProviderMismatchError` class. Any change to the harness *resolution* logic (Issue 1/2) likely needs new test cases here or in `harness-config.test.ts` / `harness-provider-compat.test.ts`.

### `tests/unit/config/environment.test.ts` (8586 bytes, lines 25-250)
Top-level `describe('config/environment', …)`:
- `describe('configureEnvironment')`
  - it: maps `AUTH_TOKEN` → `API_KEY` when `API_KEY` not set
  - it: preserves existing `API_KEY` when `AUTH_TOKEN` also set
  - it: is idempotent
  - it: sets default `BASE_URL` when not provided
  - it: preserves custom `BASE_URL` when already set
- `describe('getModel')`
  - it: returns qualified default model for opus/sonnet/haiku tiers (×3)
  - it: qualifies environment override for opus/sonnet/haiku tiers (×3)
- `describe('qualifyModel')`
  - it: qualifies a bare name with the default provider
  - it: does not double-prefix an already-qualified name
  - it: honors an explicit provider argument
  - it: qualifies an env override end-to-end via `getModel`
  - it: does not double-prefix an already-qualified env override
- `describe('validateEnvironment')`
  - it: passes when all required variables are set
  - it: throws when `API_KEY` missing
  - it: throws when `BASE_URL` missing
  - it: throws when both required variables are missing
  - it: includes missing variable name in error

### `tests/unit/tools/mcp-tool-parity.test.ts` (lines 15-137)
Top-level `describe('MCP tool discovery & execution parity across harnesses (PRD §9.3.3 / §9.4.4)', …)`:
- it: both harness configs reference the identical `MCP_TOOLS` set (object identity)
- it: the two configs differ ONLY in the `harness` field
- it: discovers the identical namespaced tool-name set under both harnesses
- it: the canonical set is exactly 9 tools across 3 inprocess servers
- it: a stub toolExecutor delegating to MCPHandler returns an equivalent result under both harnesses
- it: `MCPHandler.executeTool` is a pure `(name, input)` function — harness-agnostic, incl. the error path

### `tests/unit/agents/cache-key-isolation.test.ts` (lines 22-220)
Top-level `describe('Groundswell cache-key isolation — harness × provider/model (PRD §9.4.3)', …)`:
- `describe('generateCacheKey — direct key-builder isolation')`
  - it: keys differ when ONLY the harness differs (pi vs claude-code), same provider/model
  - it: keys differ when ONLY the provider differs (zai vs anthropic), same harness+model
  - it: keys differ when ONLY the model differs (GLM-4.7 vs GLM-4.5-Air), same harness+provider
  - it: pipeline scenario: pi+zai/GLM-4.7 vs claude-code+anthropic/claude-sonnet-4 → distinct
  - it: all `(harness, provider, model)` tuples in the cross-product yield DISTINCT keys
  - it: CONTROL — identical inputs produce the identical key (deterministic)
  - it: harness actually feeds the digest: omitting it yields a DIFFERENT key
  - it: provider actually feeds the digest: omitting it yields a DIFFERENT key
- `describe('LLMCache get/set surface — store-level partitioning')`
  - it: set under pi key → get under claude-code key is a MISS
  - it: set under zai/GLM-4.7 key → get under anthropic/claude key is a MISS
  - it: CONTROL — identical axes round-trip the value (HIT)

## 3. `tests/unit/config/` directory — does `harness.test.ts` exist?

Directory listing (5 files):

| File | Size | Last modified |
|---|---|---|
| `endpoint-guard.test.ts` | 6528 | Jun 20 20:35 |
| `environment.test.ts` | 8586 | Jun 21 00:09 |
| `harness-config.test.ts` | 3388 | Jun 20 20:08 |
| `harness-provider-compat.test.ts` | 4656 | Jun 20 21:09 |
| `harness.test.ts` | 4252 | Jun 20 19:56 |

**Yes, `harness.test.ts` exists.** Its current scope (per §2 above) is narrow: constants + types + the `HarnessProviderMismatchError` class. Sibling files likely also cover harness: `harness-config.test.ts` and `harness-provider-compat.test.ts` (titles not extracted for those — request was scoped to `harness.test.ts`). **A change to `src/config/harness.ts` must keep all three green and may need additional cases here.**

## 4. Docs section headings

### `docs/CONFIGURATION.md` (lines 1-518) — `^#` headings
- `# Configuration Reference` (1)
- `## Table of Contents` (9)
- `## Quick Reference` (33)
- `## Environment Variables` (47)
  - `### API Authentication` (49)
  - `### Model Selection` (72)
  - `### Agent Runtime (Harness)` (89)
  - `### Pipeline Control` (116)
  - `### Bug Hunt Configuration` (126)
  - `### Advanced Configuration` (136)
- `## CLI Options` (146)
  - `### Required Options` (150)
  - `### Execution Mode` (156)
  - `### Boolean Flags` (177)
  - `### Limit Options` (189)
- `## Model Selection` (198)
  - `### Model Tiers` (202)
  - `### When to Use Each Tier` (210)
  - `### Model Override` (230)
- `## Configuration Priority` (246)
  - `### Example: Priority in Action` (255)
  - `### Special Case: AUTH_TOKEN vs API_KEY` (269)
- `## Security` (279)
  - `### API Key Security` (281)
  - `### API Endpoint Security` (299)
- `## Example Configuration` (316)
- `## Common Gotchas` (395)
  - `### "API key not working"` (397)
  - `### "Tests fail with wrong API endpoint"` (418)
  - `### "Scope format rejected"` (435)
  - `### "Model selection affecting cost"` (457)
  - `### "Harness appearing in the model string is invalid"` (472)
  - `### "Using claude-code with a z.ai key"` (494)
- `## See Also` (518)

### `docs/GROUNDSWELL_GUIDE.md` (lines 1-142) — `^#` headings
- `# Groundswell Guide` (1)
- `## Table of Contents` (12)
- `## Overview` (23)
- `## Harness System` (38)
  - `### Supported Harnesses` (47)
  - `### Configuration` (58)
  - `### Critical Rules` (84)
  - `### Capability Reference` (102)
  - `### Integration Example` (114)
- `## See Also` (142)

(For reference, full `docs/` directory: `api/`, `ARCHITECTURE.md`, `CLI_REFERENCE.md`, `CONFIGURATION.md`, `CUSTOM_AGENTS.md`, `CUSTOM_TOOLS.md`, `CUSTOM_WORKFLOWS.md`, `GROUNDSWELL_GUIDE.md`, `INSTALLATION.md`, `research/`, `TESTING.md`, `user-guide.md`, `WORKFLOWS.md`.)

## 5. `markdownlint-cli` in devDependencies? — NOT present

- Grep across `package.json` and `package-lock.json` for `markdownlint` returns **only** two npm scripts (no dependency entries):
  - `package.json:56` — `"docs:lint": "markdownlint \"docs/**/*.md\""`
  - `package.json:57` — `"docs:lint:fix": "markdownlint \"docs/**/*.md\" --fix"`
- `package.json` `dependencies` (lines shown in full) and `devDependencies` (shown in full) contain **no** `markdownlint`, `markdownlint-cli`, or `markdownlint-cli2` entry.
- `find node_modules -name "markdownlint*"` returns **zero matches** anywhere under `node_modules` (not hoisted, not nested).

**Implication:** `npm run docs:lint` will fail with `markdownlint: command not found` on a clean install. Any doc-only fix that wants to validate markdown formatting cannot rely on this script unless a dep is added (out of scope per criterion-1 — do not widen scope).

## 6. `.prettierignore` and `.eslintignore`

`.prettierignore`:
```
node_modules/
dist/
coverage/
package-lock.json
pnpm-lock.yaml
.eslintcache
```

`.eslintignore`:
```
node_modules/
dist/
coverage/
*.config.js
.eslintcache
```

**Note for the bugfix:** neither file excludes `tests/`, `docs/`, or `*.md`. Lint/format changes that touch Markdown or tests will be picked up by `npm run lint` (`eslint . --ext .ts`) and `npm run format` (`prettier --write "**/*.{ts,js,json,md,yml,yaml}"`). `*.config.js` is eslint-ignored but `vitest.config.ts` is **not** (it's a `.ts` file).

## 7. `@anthropic-ai/claude-agent-sdk` under `node_modules`? — NOT installed

- `ls node_modules/@anthropic-ai/claude-agent-sdk` → **`No such file or directory`**.
- `cat node_modules/@anthropic-ai/claude-agent-sdk/package.json` → **empty / no output**.
- `find node_modules -path "*claude-agent-sdk*"` → **zero matches** (not hoisted, not nested, no `.bin` link).
- The package IS declared as a dependency of the yalc'd groundswell: `.yalc/groundswell/package.json` contains `"@anthropic-ai/claude-agent-sdk": "^0.1.0"`. It is simply **not installed** in this repo's `node_modules` tree.
- Existing tests already work around Anthropic-shaped imports with `vi.mock('@anthropic-ai/sdk', …)` (see `tests/unit/groundswell/imports.test.ts:40`). Tests that exercise groundswell's harness surface must mock the SDK rather than import it live.

## Start Here
For harness-related fixes (Issue 1/2 touching `src/config/harness.ts`): open `tests/unit/config/harness.test.ts` first (its scope is currently constants/types/`HarnessProviderMismatchError` only) and cross-reference `tests/unit/config/harness-config.test.ts` + `tests/unit/config/harness-provider-compat.test.ts`. For test-execution concerns, consult `tests/setup.ts` (endpoint guard runs in `beforeEach`) and `vitest.config.ts` (100% coverage thresholds on `src/**/*.ts`).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only recon only: zero files outside the designated output path were modified. Output file written to plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/test_and_docs_recon.md. All seven requested items answered with file paths and line numbers."
    }
  ],
  "changedFiles": [
    "plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/test_and_docs_recon.md (created — research output only, outside source tree)"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "cat vitest.config.ts",
      "result": "passed",
      "summary": "Full vitest config: node env, globals, setupFiles=[tests/setup.ts], 100% v8 coverage thresholds on src/**/*.ts, aliases @/#/groundswell."
    },
    {
      "command": "cat tests/setup.ts",
      "result": "passed",
      "summary": "Global setup: dotenv load, validateProviderEndpoint() on load + beforeEach, unhandled-rejection tracking, vi.clearAllMocks()/unstubAllEnvs(), optional gc()."
    },
    {
      "command": "find tests/unit -type f",
      "result": "passed",
      "summary": "~95 test files; harness.test.ts, environment.test.ts, tools/mcp-tool-parity.test.ts, agents/cache-key-isolation.test.ts all present."
    },
    {
      "command": "grep -nE '^\\s*(describe|it|test)\\(' on harness/environment/mcp-tool-parity/cache-key-isolation tests",
      "result": "passed",
      "summary": "Extracted describe/it titles only (no bodies) for the four requested test files."
    },
    {
      "command": "ls tests/unit/config/",
      "result": "passed",
      "summary": "Confirmed harness.test.ts exists (4252 B) alongside harness-config, harness-provider-compat, environment, endpoint-guard."
    },
    {
      "command": "grep -nE '^#{1,6} ' docs/CONFIGURATION.md docs/GROUNDSWELL_GUIDE.md",
      "result": "passed",
      "summary": "Captured all section headings for both docs."
    },
    {
      "command": "grep markdownlint in package.json + package-lock.json; find node_modules -name 'markdownlint*'",
      "result": "passed",
      "summary": "markdownlint-cli NOT a dependency and NOT installed; only an npm script 'docs:lint' references the (missing) binary."
    },
    {
      "command": "cat .prettierignore .eslintignore",
      "result": "passed",
      "summary": "Neither ignore file excludes tests/docs/*.md; *.config.js is eslint-ignored but vitest.config.ts is not."
    },
    {
      "command": "ls node_modules/@anthropic-ai/claude-agent-sdk + find node_modules -path '*claude-agent-sdk*'",
      "result": "passed",
      "summary": "Package not installed anywhere in node_modules (not hoisted/nested). Declared only inside .yalc/groundswell/package.json (^0.1.0)."
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "harness-config.test.ts and harness-provider-compat.test.ts titles were not extracted (task scoped to harness.test.ts); a harness.ts change must keep those two green and the parent may want to scout them separately.",
    "100% coverage threshold on src/**/*.ts means any new branch in src/config/harness.ts must be exercised by a test or 'vitest run --coverage' fails.",
    "tests/setup.ts runs validateProviderEndpoint() in beforeEach via src/config/endpoint-guard.js — if the fix changes endpoint resolution, this guard may fire during tests.",
    "npm run docs:lint is broken (no markdownlint binary installed); parent should not rely on it for doc validation."
  ],
  "noStagedFiles": true,
  "notes": "Research-only subagent. No source/test files touched. Output written to the requested plan path. The parent owns any code edits."
}
```
