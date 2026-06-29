# P7.M1.T3.S2 — Verified Facts (Empirical)

T3.S2 writes the **full §9.2.7 acceptance matrix** for the fail-fast auth preflight. It runs in
parallel with T3.S1, which (per its PRP) ships `runAuthPreflight()` + `AuthPreflightError` + the
`main()` wiring + a **coverage-sufficient** `tests/unit/config/auth-preflight.test.ts`.

**At research time T3.S1 was ALREADY IMPLEMENTED (uncommitted) in the working tree.** Every claim
below was verified against the live files, so the "contract" here is the ACTUAL shipped code, not a
guess. T3.S2 EXTENDS `tests/unit/config/auth-preflight.test.ts` (the work item OUTPUT says "or extend")
and must NOT duplicate T3.S1's 6 coverage-sufficient cases.

---

## §1. What T3.S1 already shipped (the contract T3.S2 tests against) — DO NOT duplicate

`src/config/harness.ts` (`runAuthPreflight`, lines 226–242):
```ts
export async function runAuthPreflight(): Promise<void> {
  const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
  const model = getModel('sonnet');
  const provider = harness === 'claude-code' ? 'anthropic' : getResolvedProvider();
  if (resolveApiKeyForProvider(provider)) return;                       // override/env (trimmed)
  if (AuthStorage.create().getAuthStatus(provider).configured) return;  // auth.json (file-backed)
  throw new AuthPreflightError({ harness, provider, model });
}
```

`src/config/types.ts` (`AuthPreflightError` + module-local `buildPreflightMessage`):
- Structured fields: `readonly harness: string; readonly provider: string; readonly model: string;`
  constructor `{ harness, provider, model }`; `this.name = 'AuthPreflightError'`.
- Message (built in ctor) contains EXACTLY:
  - `Authentication preflight failed: no credential configured for provider '<provider>' (harness '<harness>', model '<model>').`
  - `Checked sources (all empty):` → `Override: PRP_API_KEY` · `Environment: <envVars>` · `pi auth.json: <authPath>`
    - envVars: `zai`→`ZAI_API_KEY`; `anthropic`→`ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN`; else `<PROV>_API_KEY`
    - authPath: `process.env.PI_CODING_AGENT_DIR ? ${PI_CODING_AGENT_DIR}/auth.json : ~/.pi/agent/auth.json`
  - `Remediation (pick one):` → `pi /login # writes <authPath>` · `export <PROVIDER>_API_KEY=<your-key>`

`src/index.ts` (wiring — verified present):
- L39 `import { ensureHarnessInitialized, runAuthPreflight } from './config/harness.js';`
- L40 `import { AuthPreflightError } from './config/types.js';`
- L113 `configureEnvironment();` → **L119 `await runAuthPreflight();`** → L120 `await ensureHarnessInitialized();`
  (preflight runs AFTER configureEnvironment, BEFORE ensureHarnessInitialized / `new PRPPipeline`).
- L~312 top-level `.catch()`: `if (error instanceof AuthPreflightError) { console.error(\`\n❌ ${error.message}\`); process.exit(1); }`
  (ONE message → **stderr** via `console.error`, not stdout) then falls through to the generic handler.

T3.S1's `tests/unit/config/auth-preflight.test.ts` (6 cases — DO NOT re-add these):
1. proceeds when ZAI_API_KEY set · 2. proceeds when only auth.json present (+ message fragments) ·
3. throws when no credential (+ message fragments) · 4. whitespace-only ZAI_API_KEY throws ·
5. claude-code checks anthropic (+ message fragments) · 6. claude-code proceeds with ANTHROPIC_API_KEY.

**Boundary:** T3.S2 owns the cases T3.S1 did NOT cover: (a) end-to-end "no session dir + exit 1",
(d) AUTH_TOKEN provider-conditional, and the FULL error-shape + complete message-contents matrix.

---

## §2. CRITICAL — `parseCLIArgs` exits 1 BEFORE the preflight if `--prd` is absent

`src/cli/index.ts`:
- L257: `--prd` option **defaults to `./PRD.md`**.
- L640–643: `if (!existsSync(options.prd)) { logger().error(\`PRD file not found: ${options.prd}\`); ... process.exit(1); }`

**Implication for the subprocess "no session dir" test (case a):** to actually reach the preflight
(after `configureEnvironment()`), the spawned `dist/index.js` MUST be given a `--prd` path that
**exists**. Spawning with a bogus `--prd` (or wrong cwd) exits 1 with `PRD file not found` — a
FALSE setup that looks like a pass (exit 1) but never exercised the preflight. **Mitigation:** spawn
with `cwd = <repo root>` and `--prd ./PRD.md` (the repo's real PRD.md exists) OR pass an absolute
path to the real PRD. Then assert the captured **stderr** contains the preflight message (NOT
`PRD file not found`).

(The other `process.exit` calls at L384/389/445/450/573/578 are inside subcommand handlers —
artifacts/cache/etc. The default pipeline path with a valid `--prd` returns `ValidatedCLIArgs` and
reaches `configureEnvironment()` → `runAuthPreflight()`.)

---

## §3. The "no session dir on abort" guarantee (why case (a) is an end-to-end property)

The session directory is created ONLY inside `PRPPipeline.run()`:
`src/workflows/prp-pipeline.ts:1762` → `this.sessionManager = new SessionManagerClass(...)` and the
`initializeSession()` step call `createSessionDirectory(prdPath, sequence, planDir = resolve('plan'))`
(`src/core/session-utils.ts:291`) which does `await mkdir(join(planDir, '<NNN>_<hash>'), {recursive:true})`.

Because `runAuthPreflight()` (index.ts:119) runs BEFORE `new PRPPipeline(...)` (index.ts ~L204), a
preflight throw guarantees: no `PRPPipeline` constructed → no `SessionManager` → no
`createSessionDirectory` → **no `plan/<NNN>_<hash>/` dir, no agent invoked.**

This is fundamentally a `main()`/process-level property. `main()` is NOT exported and `index.ts`
auto-invokes `void main().catch(...)` at module load, so it cannot be unit-tested by import. The
authoritative proof is a **subprocess spawn** of the built `dist/index.js` (the exact pattern
`tests/unit/utils/logger-teardown.test.ts` uses: `spawnSync(process.execPath, [CLI, ...args], {env})`
with `CLI = resolve(cwd, 'dist/index.js')` + a `describeOrSkip` guard for the unbuilt case).

---

## §4. Subprocess test isolation — the env MUST be scrubbed (else a false pass)

`tests/setup.ts` runs `dotenv.config()` → the test `process.env` is polluted from the dev `.env`
(which may contain real `ZAI_API_KEY` / `ANTHROPIC_*`). The spawned child MUST NOT inherit that:

```ts
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  SHELL: process.env.SHELL,
  PI_CODING_AGENT_DIR: tmpAgentDir,   // temp empty dir → no real ~/.pi/agent/auth.json
  // NO ZAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_OAUTH_TOKEN, PRP_API_KEY
};
```
- `PI_CODING_AGENT_DIR` → temp empty dir: `AuthStorage.create().getAuthStatus('zai').configured === false`.
- Absent auth vars: `resolveApiKeyForProvider('zai') === undefined`. → preflight throws → exit 1.
- Capture: `spawnSync(..., { encoding: 'utf8', env, cwd })` → assert `status === 1` AND
  `stderr` (console.error writes to stderr) contains `Authentication preflight failed`.
- "no session dir": snapshot `readdirSync(resolve(cwd,'plan'))` (filter `/\d{3}_[0-9a-f]{12}/`) before
  and after the spawn → assert the set is UNCHANGED (the preflight aborted before `createSessionDirectory`).

The `describeOrSkip` pattern (from logger-teardown) gates on `existsSync(CLI)` so `npm run validate`
without a build stays green; the PRP Level-3/4 gate runs `npm run build` first.

---

## §5. Case (d) — AUTH_TOKEN provider-conditional (the one missing unit case)

`runAuthPreflight()` calls `resolveApiKeyForProvider(provider)`, which for `anthropic` reads
`process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY` (NOT `ANTHROPIC_AUTH_TOKEN`
directly). The `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY` map happens in `configureEnvironment()`
(`src/config/environment.ts`, T2.S1) — and ONLY when the resolved provider is `anthropic`
(`ANTHROPIC_DEFAULT_SONNET_MODEL` set to `anthropic/*`). The preflight runs AFTER
`configureEnvironment()`, so:

- **anthropic provider** (`ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'` +
  `ANTHROPIC_AUTH_TOKEN='tok'`): call `configureEnvironment()` first (maps AUTH_TOKEN→API_KEY),
  then `runAuthPreflight()` → `resolveApiKeyForProvider('anthropic')` finds the mapped key → **proceeds**.
- **default zai provider** (`ANTHROPIC_AUTH_TOKEN='tok'`, no model override):
  `configureEnvironment()` does NOT map for zai; `resolveApiKeyForProvider('zai')` reads only
  `ZAI_API_KEY` (absent) → undefined; `getAuthStatus('zai').configured === false` → **throws**.

So the (d) test MUST call `configureEnvironment()` before `runAuthPreflight()` in the
anthropic-proceeds case (mirrors the real startup order in index.ts L113→L119). `configureEnvironment`
is exported from `src/config/environment.ts` (imported the same way in `auth-resolution.test.ts`).

---

## §6. In-process error-shape assertions (the structured fields + full message matrix)

The `AuthPreflightError` exposes typed fields beyond the message. T3.S2 adds dedicated assertions
T3.S1's fragment-checks do not cover:
- `err instanceof AuthPreflightError` + `err.name === 'AuthPreflightError'`.
- Structured: `err.harness === 'pi'` (or `'claude-code'`); `err.provider === 'zai'` (or `'anthropic'`);
  `err.model` matches `zai/...` / `anthropic/...`.
- Full message (zai variant): contains `provider 'zai'`, `harness 'pi'`, `model 'zai/`,
  ALL three sources — `PRP_API_KEY`, `ZAI_API_KEY`, `auth.json` — and BOTH remediations —
  `pi /login`, `export ZAI_API_KEY=<your-key>`.
- Full message (anthropic variant, via `PRP_AGENT_HARNESS='claude-code'`): contains `provider 'anthropic'`,
  `ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN`, `export ANTHROPIC_API_KEY=<your-key>`.

`getModel('sonnet')` default → `zai/glm-5.2` (provider `zai`); with `ANTHROPIC_DEFAULT_SONNET_MODEL`
override it reflects the override. The temp `PI_CODING_AGENT_DIR` makes `authPath` in the message =
`<tmp>/auth.json` — assert on the stable substring `auth.json`, not the absolute path.

---

## §7. Test-isolation constants & helpers (reuse from T3.S1's existing file)

The existing `tests/unit/config/auth-preflight.test.ts` already defines (T3.S1 shipped them — REUSE,
do not redeclare):
- `vi.mock('groundswell', () => ({ configureHarnesses, HarnessRegistry:{getInstance:()=>({has:()=>false,register:vi.fn()})}, PiHarness: class {} }))` — REQUIRED (harness.ts imports groundswell at module level).
- `AUTH_VARS = ['ZAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_OAUTH_TOKEN','PRP_API_KEY','ANTHROPIC_DEFAULT_SONNET_MODEL','PRP_AGENT_HARNESS']`.
- `beforeEach`: `vi.clearAllMocks()` + `delete process.env[v]` for all AUTH_VARS + `tmpAgentDir = mkdtempSync(join(tmpdir(),'preflight-'))` + `vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir)`.
- `afterEach`: `vi.unstubAllEnvs()` + `rmSync(tmpAgentDir,{recursive:true,force:true})`.

T3.S2 ADDS imports it needs: `configureEnvironment` from `'../../../src/config/environment.js'`;
subprocess test adds `{ spawnSync } from 'node:child_process'`, `{ readdirSync, existsSync } from 'node:fs'`,
`{ resolve } from 'node:path'`.

---

## §8. Validation commands (verified working in this tree)

```bash
cd ~/projects/hacky-hack
npm run build                 # REQUIRED before the subprocess (case-a) test (describeOrSkip gates on dist/index.js)
npm run typecheck
npm run lint && npm run format:check
npx vitest run tests/unit/config/auth-preflight.test.ts   # the (extended) file
npx vitest run tests/unit/config/                          # all config tests green
npm run validate              # lint + format:check + typecheck + test:run
npm run test:coverage         # 100% on src/** (tests-only change → coverage cannot drop)
```

## §9. Acceptance greps (the §9.2.7 invariants remain green after T3.S2)
```bash
rg -n "runAuthPreflight" src/index.ts                      # ≥1 hit, between configureEnvironment and ensureHarnessInitialized
rg -n "export (async )?function runAuthPreflight" src/config/harness.ts
rg -n "class AuthPreflightError" src/config/types.ts
rg -n "AuthPreflightError" src/index.ts                    # the catch handler
```

## §10. Scope boundaries (TEST-ONLY — T3.S2 touches NO src/ file)
- **IN:** EXTEND `tests/unit/config/auth-preflight.test.ts` with (a) end-to-end subprocess abort,
  (d) AUTH_TOKEN provider-conditional, and full error-shape + message-contents matrix.
- **OUT (do NOT touch):** any `src/` file (runAuthPreflight/AuthPreflightError/index.ts wiring are T3.S1's,
  DONE); `resolveApiKeyForProvider`/`configureEnvironment`/`getModel`/`getResolvedProvider` (T2.S1 DONE —
  consume); `endpoint-guard.ts`; groundswell repo; README.md (Mode B → T4.S1);
  PRD.md/tasks.json/prd_snapshot.md/.gitignore (READ ONLY). Do NOT duplicate T3.S1's 6 coverage cases.
