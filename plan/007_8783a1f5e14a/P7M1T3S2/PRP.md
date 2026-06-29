---
name: "P7.M1.T3.S2 — Harness-specific + acceptance tests for the auth preflight (PRD §9.2.7)"
description: |
  EXTEND `tests/unit/config/auth-preflight.test.ts` with the full §9.2.7 acceptance matrix that the
  parallel T3.S1 deliberately left to T3.S2. T3.S1 ships `runAuthPreflight()` + `AuthPreflightError` +
  the `main()` wiring + a **coverage-sufficient** 6-case suite; T3.S2 is TEST-ONLY and adds the three
  things T3.S1 did NOT cover: (a) the END-TO-END "no credential → abort at startup with exit 1 + NO
  session dir + single message" guarantee (subprocess spawn of the built CLI, mirroring
  `logger-teardown.test.ts`); (d) the `ANTHROPIC_AUTH_TOKEN` provider-conditional case (proceeds ONLY
  under the `anthropic` provider, throws under the default `zai` path); and the FULL `AuthPreflightError`
  shape + complete message-contents matrix (structured `harness`/`provider`/`model` fields + every
  checked source + both remediation commands, for both the `zai` and `anthropic` variants). Mocks the
  harness provider (subprocess aborts before `ensureHarnessInitialized()`, so no real LLM call occurs)
  and uses temp-dir `PI_CODING_AGENT_DIR` isolation. Does NOT duplicate T3.S1's 6 coverage cases.
---

## Goal

**Feature Goal**: Prove — with zero network/LLM calls — every acceptance criterion in PRD §9.2.7 for
the fail-fast auth preflight that T3.S1 wired onto the startup path. A future regression that lets a
missing credential reach the agent layer (the original §9.2.7 "Problem": a deep
`No API key found for zai.` after a session dir + `ERROR_REPORT.md` are already written) must turn one
of these tests red.

**Deliverable**: An EXTENDED `tests/unit/config/auth-preflight.test.ts` (the work-item OUTPUT contract:
"tests/unit/config/auth-preflight.test.ts (or extend)") containing the three NEW test groups T3.S1 left
to T3.S2 — never touching any `src/` file. Specifically:

1. **Acceptance case (a) — end-to-end subprocess abort** (NEW describe block, `describeOrSkip`-gated
   on the built `dist/index.js` like `logger-teardown.test.ts`): spawn the built CLI with a scrubbed
   env (no credential + temp `PI_CODING_AGENT_DIR`) and an existing `--prd`; assert exit code `1`, the
   single `Authentication preflight failed` message on **stderr**, and that **NO new `plan/<NNN>_<hash>/`
   session directory was created** (snapshot `plan/` before/after).
2. **Acceptance case (d) — `ANTHROPIC_AUTH_TOKEN` provider-conditional** (NEW describe block, in-process):
   AUTH_TOKEN proceeds ONLY when the resolved provider is `anthropic` (model override +
   `configureEnvironment()` maps AUTH_TOKEN→API_KEY, which `runAuthPreflight()` then resolves); AUTH_TOKEN
   is NOT consulted for the default `zai` path (throws `AuthPreflightError`).
3. **Full `AuthPreflightError` shape + message-contents matrix** (NEW describe block, in-process):
   assert the structured `harness`/`provider`/`model` fields and that the message names EVERY checked
   source (`PRP_API_KEY`, the provider env-var name, the `auth.json` path) and BOTH remediation commands
   (`pi /login`, `export <PROVIDER>_API_KEY=…`) — for both the `zai` and `anthropic` variants.

**Success Definition** (maps 1:1 to PRD §9.2.7 acceptance + the work-item OUTPUT/LOGIC):
- A no-credential run aborts at startup with exit code `1`, emits a single actionable message, and
  creates **no** `plan/` session directory and invokes no agent — proven by the subprocess test.
- `ANTHROPIC_AUTH_TOKEN` succeeds **only** under the `anthropic` provider and is **not** required by the
  default `pi`+`zai` path — proven by the (d) test group.
- The thrown `AuthPreflightError` carries the structured shape + the complete actionable message
  (harness, provider/model, checked sources, remediation) — proven by the shape/matrix group.
- The (b) auth.json-only, (c) `ZAI_API_KEY`-only, and (e) claude-code-requires-anthropic cases are
  already covered by T3.S1 (cross-referenced, NOT duplicated).
- `npm run build && npm run validate` passes; `npm run test:coverage` stays at **100%** on `src/**`
  (this is a tests-only change, so coverage cannot drop; new tests may only add).

## User Persona (if applicable)

**Target User**: The hacky-hack maintainer / regression-guard. The user is a future change to the auth
or startup path that accidentally re-introduces the §9.2.7 failure mode (a missing credential slipping
past startup into `decomposePRD`). This suite must catch that before merge.

**Use Case**: CI gate + local pre-merge confidence: `npm run build && npx vitest run
tests/unit/config/auth-preflight.test.ts` proves the fail-fast contract still holds end-to-end.

**Pain Points Addressed**: The §9.2.7 "Problem" — `validateEnvironment()` was never on the startup path;
the single most common install failure (a bad/missing credential) was not detected until a deep,
misleading error inside `decomposePRD`, after a session dir + `ERROR_REPORT.md` were already written.

## Why

- **Business value**: This is the acceptance-test half of the auth-preflight workstream (T2.S1 → T3.S1 →
  **T3.S2**). T3.S1 wired the gate; T3.S2 makes its contract regression-proof. The most expensive
  failure mode to debug (opaque deep crash after a session dir exists) now has a deterministic,
  end-to-end red light.
- **Integration with existing features**: Consumes the T3.S1-shipped `runAuthPreflight()` /
  `AuthPreflightError` / `main()` wiring VERBATIM (no src/ edits). Reuses the T2.S1 resolver
  (`resolveApiKeyForProvider`), `configureEnvironment()`, `getModel`/`getResolvedProvider`, and pi's
  file-backed `AuthStorage.create().getAuthStatus(provider).configured`.
- **Problems solved / for whom**: For every installer — the contract "a bad credential never reaches the
  agent layer, and never creates a session dir first" is now machine-verified, not aspirational.

## What

User-visible behavior: none (test-only). Internally, three new test groups are added to the existing
`tests/unit/config/auth-preflight.test.ts`, extending T3.S1's 6 coverage-sufficient cases to the FULL
§9.2.7 acceptance matrix.

### Success Criteria

- [ ] `tests/unit/config/auth-preflight.test.ts` is EXTENDED (not replaced); T3.S1's 6 cases remain green.
- [ ] Case (a): a subprocess run of the built `dist/index.js --prd <existing>` with a scrubbed env
      (no credential + temp `PI_CODING_AGENT_DIR`) exits `1`, prints the single preflight message to
      **stderr**, and creates **no** new `plan/<NNN>_<hash>/` session dir (snapshot before/after unchanged).
- [ ] Case (a) is `describeOrSkip`-gated on `existsSync(dist/index.js)` so `npm run validate` without a
      build stays green (mirrors `logger-teardown.test.ts`); the PRP Level-3/4 gate runs `npm run build`.
- [ ] Case (d): with `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/…'` + `ANTHROPIC_AUTH_TOKEN` +
      `configureEnvironment()` first, `runAuthPreflight()` resolves; with `ANTHROPIC_AUTH_TOKEN` alone
      (default `zai`), `runAuthPreflight()` rejects with `AuthPreflightError`.
- [ ] Shape/matrix: `AuthPreflightError` asserts `instanceof` + `name` + structured
      `harness`/`provider`/`model` fields; the message contains ALL checked sources + BOTH remediation
      commands for both the `zai` and `anthropic` variants.
- [ ] No `src/` file is modified (test-only). `npm run build && npm run validate` passes;
      `npm run test:coverage` stays at 100% on `src/**`.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed? **Yes.** The
authoritative contract is the T3.S1-shipped code (verified present in the working tree and quoted
verbatim in `research/verified_facts.md §1`): the exact `runAuthPreflight()` predicate, the
`AuthPreflightError` fields + `buildPreflightMessage` output, and the `index.ts` L113→L119→L120 wiring.
The two load-bearing gotchas — (§2) `parseCLIArgs` exits 1 on a missing `--prd` BEFORE the preflight
(so the subprocess test MUST pass an existing PRD), and (§4) the spawned env MUST be scrubbed of
`.env`/setup-polluted credentials + pointed at a temp `PI_CODING_AGENT_DIR` (else a false pass) — are
documented with the exact env object to pass. The subprocess pattern is copied from
`logger-teardown.test.ts` (cited). The provider-conditional (d) ordering (call `configureEnvironment()`
before `runAuthPreflight()`) is explained in §5. The files to edit, the imports to add, the validation
commands, and the scope boundaries are all listed.

### Documentation & References

```yaml
# MUST READ — the authoritative contract T3.S2 tests against (T3.S1 is DONE; this is the live code)
- file: plan/007_8783a1f5e14a/P7M1T3S2/research/verified_facts.md
  why: "§1 the verbatim runAuthPreflight() + AuthPreflightError + buildPreflightMessage output + the
        index.ts wiring (the EXACT strings to assert against); §2 the parseCLIArgs --prd existsSync
        gotcha; §3 why 'no session dir' is an end-to-end (subprocess) property; §4 the scrubbed-env
        object + the plan/ snapshot technique; §5 the configureEnvironment-before-preflight ordering
        for case (d); §6 the structured-field + full-message assertions; §7 the isolation helpers
        already in the file (reuse, don't redeclare); §8–§10 validation + scope."
  section: "§1–§10 (read all)"

# MUST READ — the file under edit (T3.S1 already created it; EXTEND, don't replace)
- file: tests/unit/config/auth-preflight.test.ts
  why: "The 6 coverage-sufficient cases T3.S1 shipped (DO NOT duplicate). Reuses its vi.mock('groundswell')
        factory, AUTH_VARS list, and beforeEach/afterEach temp-dir PI_CODING_AGENT_DIR isolation."
  pattern: "vi.mock('groundswell', factory); AUTH_VARS; beforeEach clear+mkdtemp+stubEnv; afterEach
            unstubAllEnvs+rmSync. Add new describe BLOCKS after the existing one; share the scaffolding."

# MUST READ — the subprocess spawn pattern to copy for case (a)
- file: tests/unit/utils/logger-teardown.test.ts
  why: "The established pattern for testing the REAL startup path: spawnSync(process.execPath,
        [CLI,...args], {encoding,env,timeout}); CLI = resolve(cwd,'dist/index.js');
        describeOrSkip = hasBuild ? describe : describe.skip; assert status + captured output."
  pattern: "const CLI = resolve(process.cwd(),'dist/index.js'); const hasBuild = existsSync(CLI);
            const describeOrSkip = hasBuild ? describe : describe.skip;"

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.2.7 is the requirement + the 4 acceptance bullets (no-cred→exit1+no-session-dir;
        auth.json-only succeeds; ZAI-only succeeds; AUTH_TOKEN succeeds only under anthropic).
        §9.2.6 is the auth model the preflight mirrors; §9.4.1 claude-code is Anthropic-only."
  section: "9.2.7 (primary), 9.2.6 (auth order), 9.4.1 (claude-code anthropic-only)"

# REFERENCE — the shipped code under test (confirm before asserting against exact strings)
- file: src/config/harness.ts
  why: "runAuthPreflight() (L226–242) — the predicate; confirm the provider = claude-code?'anthropic':getResolvedProvider()."
- file: src/config/types.ts
  why: "AuthPreflightError (L185) + buildPreflightMessage — the structured fields + the EXACT message
        text to assert against (envVars/authPath/exportCmd branches per provider)."
- file: src/index.ts
  why: "L119 await runAuthPreflight(); (after configureEnvironment L113, before ensureHarnessInitialized);
        the top-level .catch() prints ONE message to stderr + exit 1."

# REFERENCE — case (d) depends on the configureEnvironment AUTH_TOKEN→API_KEY map (T2.S1, DONE)
- file: src/config/environment.ts
  why: "configureEnvironment() maps ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY ONLY when resolved provider
        is anthropic; exported + imported the same way in auth-resolution.test.ts."
- file: tests/unit/config/auth-resolution.test.ts
  why: "The DONE T2.S3 matrix proves the resolver+forwarding halves; T3.S2's case (d) proves the
        PREFLIGHT half mirrors the same provider-conditional behavior."

# REFERENCE — the session-dir creation primitive (what case (a) proves is NOT reached)
- file: src/core/session-utils.ts
  why: "createSessionDirectory(prdPath, sequence, planDir=resolve('plan')) does mkdir(join(planDir,'<NNN>_<hash>'))."
  section: "L291 createSessionDirectory (the plan/<NNN>_<hash>/ shape — used by the snapshot regex)"
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts               # L113 configureEnvironment → L119 runAuthPreflight → L120 ensureHarnessInitialized (DONE T3.S1)
  config/
    harness.ts           # runAuthPreflight() L226–242 (DONE T3.S1 — UNDER TEST, do not edit)
    types.ts             # AuthPreflightError L185 + buildPreflightMessage (DONE T3.S1 — UNDER TEST)
    environment.ts       # configureEnvironment (DONE T2.S1 — consumed by case d)
  cli/index.ts           # parseCLIArgs L640 existsSync(--prd)→exit1 BEFORE preflight (the §2 gotcha)
  core/session-utils.ts  # createSessionDirectory → mkdir plan/<NNN>_<hash> (the §3 guarantee target)
tests/
  setup.ts               # dotenv.config() pollutes env → subprocess env MUST be scrubbed (§4)
  unit/config/
    auth-preflight.test.ts            # ← EXTEND (T3.S1's 6 cases + T3.S2's 3 new groups)
    auth-resolution.test.ts           # REFERENCE (T2.S3 resolver+forwarding matrix)
    harness-provider-compat.test.ts   # REFERENCE (vi.mock('groundswell') + env stub pattern)
  unit/utils/logger-teardown.test.ts  # REFERENCE (spawnSync + describeOrSkip pattern for case a)
vitest.config.ts                       # 100% coverage gate on src/** (tests-only → cannot drop)
plan/007_8783a1f5e14a/
  architecture/implementation_notes.md # §T3.S2 contract (the 5 acceptance cases)
  P7M1T3S1/PRP.md                      # INPUT contract (runAuthPreflight — DONE)
  P7M1T3S2/research/verified_facts.md  # THIS item's verified findings
```

### Desired Codebase tree with files added/changed

```bash
tests/unit/config/auth-preflight.test.ts   # EXTENDED — +3 describe blocks (case a subprocess, case d, shape/matrix)
# (NO src/ changes. NO new files. PRD.md/tasks.json/prd_snapshot.md/.gitignore — READ ONLY, never touch.)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — case (a) subprocess test MUST pass an EXISTING --prd. parseCLIArgs (src/cli/index.ts:640)
// does `if (!existsSync(options.prd)) { logger().error('PRD file not found'); process.exit(1); }`
// BEFORE configureEnvironment()/runAuthPreflight(). A bogus --prd exits 1 with 'PRD file not found' —
// a FALSE pass (right exit code, never reached the preflight). Mitigation: spawn with cwd = <repo root>
// and --prd ./PRD.md (the repo PRD.md exists) OR an absolute existing path; then assert stderr contains
// 'Authentication preflight failed' (NOT 'PRD file not found').

// CRITICAL — the spawned child env MUST be SCRUBBED. tests/setup.ts runs dotenv.config() → the test
// process.env is polluted from the dev .env (may hold real ZAI_API_KEY/ANTHROPIC_*). Do NOT spread
// process.env into the child. Pass a minimal env: PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR=<temp>.
// Absent auth vars + empty temp PI_CODING_AGENT_DIR → AuthStorage.getAuthStatus('zai').configured===false
// AND resolveApiKeyForProvider('zai')===undefined → preflight throws → exit 1.

// CRITICAL — the preflight message goes to STDERR (console.error in main()'s catch), not stdout.
// spawnSync captures both: assert res.stderr contains 'Authentication preflight failed'.
// (logger-teardown asserts res.stdout for --help because commander prints help to stdout — different path.)

// CRITICAL — main() is NOT exported and index.ts auto-runs `void main().catch(...)` at module load.
// You CANNOT unit-test main() by importing it. The end-to-end 'exit 1 + no session dir' guarantee is
// therefore a PROCESS-level property → prove it with spawnSync (the logger-teardown pattern). Do NOT
// attempt to refactor/export main() — that is a src/ change, out of scope (test-only work item).

// GOTCHA — case (d) MUST call configureEnvironment() BEFORE runAuthPreflight() for the
// anthropic-proceeds branch. The ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY map lives in configureEnvironment
// (T2.S1) and runs ONLY when the provider is anthropic; runAuthPreflight() relies on it. For the
// default-zai-throws branch, configureEnvironment() does NOT map (so AUTH_TOKEN is invisible to the
// zai resolver) → preflight throws. (Mirrors the real index.ts L113→L119 order.)

// GOTCHA — reuse the scaffolding T3.S1 already put in the file: the vi.mock('groundswell', factory)
// (REQUIRED — harness.ts imports groundswell at module level; without the mock the import throws), the
// AUTH_VARS list, and the beforeEach/afterEach temp-dir PI_CODING_AGENT_DIR isolation. ADD new describe
// blocks; do NOT redeclare these helpers (duplicate identifiers = a lint/compile error).

// GOTCHA — the subprocess test is describeOrSkip-gated on existsSync(dist/index.js). `npm run validate`
// (test:run) does NOT build first, so an unconditional describe would fail in a build-less run.
// The PRP Level-3/4 gate runs `npm run build` before the test so the block actually executes.

// GOTCHA — the temp PI_CODING_AGENT_DIR makes buildPreflightMessage's authPath = '<tmp>/auth.json'.
// Assert on the stable substring 'auth.json' (and 'pi /login'), NOT the absolute temp path.

// GOTCHA — 100% coverage gate is on src/** (vitest.config.ts). This is a TESTS-ONLY change: it cannot
// reduce coverage (no src/ edits). New assertions may only keep/raise it. Do not add a src/ file.

// GOTCHA — DO NOT duplicate T3.S1's 6 coverage cases (ZAI-proceeds, auth.json-proceeds, no-cred-throws,
// whitespace-throws, claude-code-throws, claude-code-proceeds). T3.S2 adds the MISSING acceptance cases
// only: (a) end-to-end, (d) provider-conditional, and the full shape/matrix. Cross-reference (b)/(c)/(e)
// in a comment rather than re-testing them.
```

## Implementation Blueprint

### Data models and structure

No data-model changes (test-only). The new test groups assert against the T3.S1-shipped shapes:

```ts
// The function under test (src/config/harness.ts:226 — DONE, do not edit):
export async function runAuthPreflight(): Promise<void>;   // throws AuthPreflightError on no-credential

// The error under test (src/config/types.ts:185 — DONE, do not edit):
export class AuthPreflightError extends Error {
  readonly harness: string;   // 'pi' | 'claude-code'
  readonly provider: string;  // 'zai' | 'anthropic'
  readonly model: string;     // 'zai/glm-5.2' | 'anthropic/claude-sonnet-4' | …
  constructor(opts: { harness: string; provider: string; model: string });
  // message built by buildPreflightMessage (see verified_facts §1 for the EXACT text)
}

// The auth.json gate primitive used by the preflight (pi-side, DONE T2.S2):
AuthStorage.create().getAuthStatus(provider).configured   // boolean — false for the 'environment' source
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY the T3.S1 contract is present (gate — T3.S2 depends on it)
  - RUN: rg -n "export async function runAuthPreflight" src/config/harness.ts     # 1 hit
  - RUN: rg -n "class AuthPreflightError" src/config/types.ts                     # 1 hit
  - RUN: rg -n "await runAuthPreflight" src/index.ts                              # 1 hit (between configureEnvironment & ensureHarnessInitialized)
  - RUN: rg -n "AuthPreflightError" src/index.ts                                  # ≥1 hit (the catch handler)
  - RUN: ls tests/unit/config/auth-preflight.test.ts                              # EXISTS (T3.S1 created it)
  - EXPECT: all present. If any missing → T3.S1 is not yet landed; STOP and surface it (T3.S2 cannot
    proceed without its input). At research time all were verified present (uncommitted).

Task 1: EXTEND tests/unit/config/auth-preflight.test.ts — add imports + scaffolding reuse
  - ADD imports at the top (alongside the existing vi/fs/os/path imports):
      import { configureEnvironment } from '../../../src/config/environment.js';   # for case (d)
  - ADD (for the subprocess group only — Task 4):
      import { spawnSync } from 'node:child_process';
      import { readdirSync, existsSync } from 'node:fs';
      import { resolve } from 'node:path';
  - DO NOT redeclare vi.mock('groundswell', …), AUTH_VARS, tmpAgentDir, beforeEach, afterEach — they
    already exist (T3.S1). Reuse them. Confirm by reading the file first.
  - DEPENDENCY: Task 0.

Task 2: ADD describe('acceptance (d) — ANTHROPIC_AUTH_TOKEN is provider-conditional')  [in-process]
  - CASE d-anthropic (proceeds):
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok');
      configureEnvironment();                 # maps AUTH_TOKEN→ANTHROPIC_API_KEY (provider is anthropic)
      await expect(runAuthPreflight()).resolves.toBeUndefined();   # resolver finds the mapped key
      expect(process.env.ANTHROPIC_API_KEY).toBe('tok');           # proves the map ran (sanity)
  - CASE d-zai (throws — AUTH_TOKEN NOT consulted for the default path):
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok');   # NO model override → provider stays 'zai'
      configureEnvironment();                      # does NOT map AUTH_TOKEN for zai
      await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();      # proves NO map for zai
  - NAMING: 'acceptance (d) — ANTHROPIC_AUTH_TOKEN is provider-conditional'.
  - WHY configureEnvironment() first: mirrors index.ts L113→L119; the AUTH_TOKEN→API_KEY map the
    anthropic branch depends on lives in configureEnvironment (T2.S1). See verified_facts §5.
  - DEPENDENCY: Task 1.

Task 3: ADD describe('AuthPreflightError — full shape + message matrix (PRD §9.2.7)')  [in-process]
  - SHAPE test (zai): clear env (beforeEach does it); catch the throw; assert
      err instanceof AuthPreflightError; err.name === 'AuthPreflightError';
      err.harness === 'pi'; err.provider === 'zai'; err.model matches /^zai\// (default 'zai/glm-5.2').
  - MESSAGE-zai test: assert the caught message contains ALL of:
      "provider 'zai'", "harness 'pi'", "model 'zai/" (the 3 identity tokens),
      'PRP_API_KEY', 'ZAI_API_KEY', 'auth.json' (the 3 checked sources),
      'pi /login', 'export ZAI_API_KEY=<your-key>' (both remediations).
  - MESSAGE-anthropic test: vi.stubEnv('PRP_AGENT_HARNESS','claude-code'); catch; assert message contains
      "provider 'anthropic'", 'ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN', 'export ANTHROPIC_API_KEY=<your-key>'.
  - NOTE: T3.S1 already checks SOME message fragments in its 'throws' + 'claude-code' cases. T3.S2's job
    here is the STRUCTURED-FIELD assertions + the COMPLETE source/remediation matrix (the parts T3.S1
    omits). Keep the assertions non-overlapping where possible; overlap is harmless but wasteful.
  - Assert on 'auth.json' / 'pi /login' substrings (the temp PI_CODING_AGENT_DIR makes the path absolute).
  - DEPENDENCY: Task 1.

Task 4: ADD describeOrSkip('acceptance (a) — no-credential aborts at startup: exit 1, single message, NO session dir')  [subprocess]
  - SCAFFOLDING (mirror logger-teardown.test.ts exactly):
      const CLI = resolve(process.cwd(), 'dist/index.js');
      const hasBuild = existsSync(CLI);
      const describeOrSkip = hasBuild ? describe : describe.skip;
  - HELPER inside the block:
      function runNoCredCli(tmpAgentDir: string, prdAbs: string) {
        const env = {                              # SCRUBBED — no creds, temp agent dir
          PATH: process.env.PATH, HOME: process.env.HOME,
          USER: process.env.USER, SHELL: process.env.SHELL,
          PI_CODING_AGENT_DIR: tmpAgentDir,
        };
        return spawnSync(process.execPath, [CLI, '--prd', prdAbs], {
          encoding: 'utf8', timeout: 20_000, env,
        });
      }
  - CASE a test:
      - mkdtemp a temp agent dir (or reuse tmpAgentDir — but the subprocess is a SEPARATE process, so the
        in-process vi.stubEnv does NOT apply; pass PI_CODING_AGENT_DIR explicitly in env).
      - prdAbs = resolve(process.cwd(), 'PRD.md') (the repo PRD — EXISTS; avoids the parseCLIArgs existsSync trap).
      - Snapshot plan/ session dirs BEFORE: const before = new Set(readdirSync(resolve(cwd,'plan')).filter(s=>/^\d{3}_[0-9a-f]{12}$/.test(s))).
        (Guard: if plan/ absent, before = empty Set.)
      - res = runNoCredCli(tmpAgentDir, prdAbs).
      - ASSERT exit: expect(res.status).toBe(1).
      - ASSERT single message on STDERR: expect(res.stderr).toContain('Authentication preflight failed');
        expect(res.stderr).not.toContain('PRD file not found')   # proves we reached the preflight, not parseCLIArgs.
      - ASSERT no session dir: const after = new Set(readdirSync(...).filter(regex)); expect([...after]).toEqual([...before]).
      - (Optional) ASSERT no agent invoked: expect(res.stderr).not.toContain('No API key found for zai')
        (the OLD deep-failure signature — proves the fail-fast replaced it).
  - NAMING: 'acceptance (a) — no-credential aborts at startup: exit 1, single message, NO session dir'.
  - WHY spawnSync (not in-process): main() is not exported + index.ts auto-runs; 'exit 1 + no session dir'
    is a process-level property. See verified_facts §3.
  - DEPENDENCY: Tasks 1–3 (file is coherent first).

Task 5: VALIDATE (the full gate)
  - RUN: npm run build                  # REQUIRED so the describeOrSkip (case a) block actually runs
  - RUN: npm run typecheck
  - RUN: npm run lint && npm run format:check     (run npm run format if it complains)
  - RUN: npx vitest run tests/unit/config/auth-preflight.test.ts   # T3.S1's 6 + T3.S2's new groups all green
  - RUN: npx vitest run tests/unit/config/                         # all config tests green (no regressions)
  - RUN: npm run validate                # lint + format:check + typecheck + test:run
  - RUN: npm run test:coverage           # 100% on src/** (tests-only → cannot drop)
  - RUN: the acceptance greps (verified_facts §9) — all green.
  - DEPENDENCY: Task 4.
```

### Implementation Patterns & Key Details

```ts
// ── Case (d): provider-conditional AUTH_TOKEN (in-process) ────────────────────────────────
it('AUTH_TOKEN proceeds ONLY under the anthropic provider', async () => {
  vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok');
  configureEnvironment();                       // maps AUTH_TOKEN → ANTHROPIC_API_KEY (provider=anthropic)
  await expect(runAuthPreflight()).resolves.toBeUndefined();
  expect(process.env.ANTHROPIC_API_KEY).toBe('tok');
});

it('AUTH_TOKEN is NOT consulted for the default zai path (throws)', async () => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok');    // no model override → provider stays 'zai'
  configureEnvironment();                       // does NOT map AUTH_TOKEN for zai
  await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
  expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
});

// ── Shape + message matrix (in-process) ───────────────────────────────────────────────────
it('AuthPreflightError carries structured fields + the complete actionable message (zai)', async () => {
  const err = await runAuthPreflight().catch(e => e as AuthPreflightError);
  expect(err).toBeInstanceOf(AuthPreflightError);
  expect(err.name).toBe('AuthPreflightError');
  expect(err.harness).toBe('pi');
  expect(err.provider).toBe('zai');
  expect(err.model).toMatch(/^zai\//);
  for (const token of ["provider 'zai'", "harness 'pi'", 'PRP_API_KEY', 'ZAI_API_KEY',
                        'auth.json', 'pi /login', 'export ZAI_API_KEY=<your-key>']) {
    expect(err.message).toContain(token);
  }
});

// ── Case (a): end-to-end subprocess abort (the logger-teardown pattern) ───────────────────
const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip('acceptance (a) — no-credential aborts at startup: exit 1, single message, NO session dir', () => {
  it('exits 1, prints the preflight message on stderr, creates no plan/ session dir', () => {
    const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
    const prdAbs = resolve(process.cwd(), 'PRD.md');          // EXISTS — avoids the parseCLIArgs trap
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
                  SHELL: process.env.SHELL, PI_CODING_AGENT_DIR: tmpAgentDir };  // SCRUBBED
    const planDir = resolve(process.cwd(), 'plan');
    const sessRe = /^\d{3}_[0-9a-f]{12}$/;
    const before = existsSync(planDir)
      ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set<string>();

    const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs],
      { encoding: 'utf8', timeout: 20_000, env });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Authentication preflight failed');
    expect(res.stderr).not.toContain('PRD file not found');   // reached the preflight, not parseCLIArgs

    const after = existsSync(planDir)
      ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set<string>();
    expect([...after].sort()).toEqual([...before].sort());    // NO new session dir created
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });
});
```

### Integration Points

```yaml
TESTS (EXTEND — the ONLY file touched):
  - tests/unit/config/auth-preflight.test.ts
    + import { configureEnvironment } from '../../../src/config/environment.js'        # case (d)
    + import { spawnSync } from 'node:child_process'; readdirSync, existsSync from 'node:fs'; resolve from 'node:path'  # case (a)
    + describe('acceptance (d) — ANTHROPIC_AUTH_TOKEN is provider-conditional')        # 2 tests
    + describe('AuthPreflightError — full shape + message matrix (PRD §9.2.7)')        # 3 tests (shape, msg-zai, msg-anthropic)
    + describeOrSkip('acceptance (a) — no-credential aborts at startup …')             # 1 subprocess test

NO CHANGES TO:
  src/**                                (test-only work item; runAuthPreflight/AuthPreflightError/index.ts are DONE T3.S1)
  src/config/environment.ts, harness.ts resolver, constants.ts, endpoint-guard.ts   (DONE T2.S1 / READ ONLY)
  src/cli/index.ts, src/core/session-utils.ts, src/workflows/prp-pipeline.ts         (understood, not edited)
  ~/projects/groundswell/**             (T2.S2 owns the file-backed AuthStorage)
  README.md                             (Mode B → T4.S1)
  PRD.md, tasks.json, prd_snapshot.md, .gitignore   (READ ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding. All commands run in `~/projects/hacky-hack`.

### Level 1: Contract presence + Syntax & Style (after Tasks 0–1)

```bash
cd ~/projects/hacky-hack

# Task 0 gate — T3.S1 is landed (T3.S2's input).
rg -n "export async function runAuthPreflight" src/config/harness.ts   # 1 hit
rg -n "class AuthPreflightError" src/config/types.ts                    # 1 hit
rg -n "await runAuthPreflight" src/index.ts                             # 1 hit
ls tests/unit/config/auth-preflight.test.ts                             # exists

npm run typecheck     # catches a bad import (configureEnvironment/spawnSync) or a duplicate identifier
npm run lint          # eslint . --ext .ts — zero errors
npm run format:check  # run `npm run format` if it complains
```
Expected: all pass. typecheck is the primary catcher of a wrong import path or a redeclared helper.

### Level 2: Unit tests (after Tasks 2–4)

```bash
cd ~/projects/hacky-hack

npm run build        # REQUIRED: the case-(a) describeOrSkip block runs only if dist/index.js exists

# The extended file alone (fast iteration on the in-process groups; the subprocess group also runs post-build).
npx vitest run tests/unit/config/auth-preflight.test.ts
# Expected: T3.S1's 6 cases + T3.S2's ~6 new cases (d×2, shape/msg-zai/msg-anthropic×3, case-a×1) all pass.

# Full config suite — no regressions in T2.S1/T2.S3/T3.S1 tests.
npx vitest run tests/unit/config/
# Expected: all green — auth-resolver, auth-resolution, environment, harness-config,
#           harness-provider-compat, endpoint-guard, harness, issue-retry-max, research-timeout + the file.

npm run validate          # lint + format:check + typecheck + test:run
npm run test:coverage     # 100% statements/branches/functions/lines on src/**
# Expected: all pass; coverage unchanged at 100% (tests-only change).
```

### Level 3: Acceptance greps (the §9.2.7 invariants stay green)

```bash
cd ~/projects/hacky-hack
# runAuthPreflight still wired between the two startup calls (T3.S1 — unchanged by T3.S2).
rg -n "runAuthPreflight" src/index.ts                      # ≥1 hit, between configureEnvironment & ensureHarnessInitialized
rg -n "export (async )?function runAuthPreflight" src/config/harness.ts   # 1 hit
rg -n "class AuthPreflightError" src/config/types.ts       # 1 hit
rg -n "AuthPreflightError" src/index.ts                    # ≥1 hit (the catch handler)

# T3.S2 made NO src/ edits (test-only).
git diff --stat src/                                       # Expected: (empty / no src changes)
# Expected: all greps return the stated results; git diff --stat src/ shows nothing.
```

### Level 4: Behavioral smoke (the §9.2.7 OUTPUT contract, manual sanity)

```bash
cd ~/projects/hacky-hack
npm run build   # ensure dist/index.js is fresh

# (a) No credential → exit 1 + the preflight message + NO session dir (manual repro of the subprocess test).
tmpdir_pf=$(mktemp -d)
node dist/index.js --prd ./PRD.md >/tmp/pf_out.txt 2>&1 < /dev/null; echo "exit=$?"
#   with a scrubbed env: PATH/HOME/USER/SHELL only + PI_CODING_AGENT_DIR=$tmpdir_pf
( env -i PATH="$PATH" HOME="$HOME" USER="$USER" SHELL="$SHELL" \
    PI_CODING_AGENT_DIR="$tmpdir_pf" node dist/index.js --prd ./PRD.md ) >/tmp/pf_out.txt 2>&1; echo "exit=$?"
grep -q "Authentication preflight failed" /tmp/pf_out.txt && echo "MESSAGE OK"
rm -rf "$tmpdir_pf"
# Expected: exit=1 and 'MESSAGE OK'. (NO new plan/<hash>/ dir appears — verify with ls plan/ before/after.)

# (d) AUTH_TOKEN-only proceeds ONLY under anthropic (manual repro).
env -i PATH="$PATH" HOME="$HOME" ANTHROPIC_AUTH_TOKEN=tok PI_CODING_AGENT_DIR="$(mktemp -d)" \
  npx tsx -e "import('./src/config/environment.js').then(async e=>{e.configureEnvironment(); const {runAuthPreflight}=await import('./src/config/harness.js'); try{await runAuthPreflight();console.log('WRONGLY PROCEEDED')}catch(err){console.log('CORRECTLY ABORTED:',err.name)} })"
# Expected (default zai): 'CORRECTLY ABORTED: AuthPreflightError'.
# (Under ANTHROPIC_DEFAULT_SONNET_MODEL=anthropic/... it would proceed — see the case-d test.)
# Expected: each smoke prints the stated value (sanity; the authoritative matrix is Level 2).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: Task-0 contract greps all present (T3.S1 landed); `npm run typecheck`, `npm run lint`,
      `npm run format:check` all pass.
- [ ] Level 2: `npm run build` then `npx vitest run tests/unit/config/auth-preflight.test.ts` passes
      (T3.S1's 6 + T3.S2's new groups); `npx vitest run tests/unit/config/` fully green (no regressions);
      `npm run validate` passes; `npm run test:coverage` shows 100% on `src/**` (tests-only → unchanged).
- [ ] Level 3: acceptance greps return the stated results; `git diff --stat src/` is empty (test-only).
- [ ] Level 4: behavioral smokes print the expected values (no-cred → exit 1 + message, no new session dir;
      AUTH_TOKEN-only under default zai → aborts).

### Feature Validation (PRD §9.2.7 + work-item OUTPUT/LOGIC)
- [ ] Case (a): subprocess abort — exit `1`, single `Authentication preflight failed` on **stderr**, and
      **no** new `plan/<NNN>_<hash>/` session dir (snapshot before/after unchanged); no agent invoked
      (no `No API key found for zai` in output).
- [ ] Case (a) is `describeOrSkip`-gated on the build (green without a build; runs after `npm run build`).
- [ ] Case (d): `ANTHROPIC_AUTH_TOKEN` proceeds **only** under `anthropic` (after `configureEnvironment()`),
      and throws `AuthPreflightError` under the default `zai` path.
- [ ] Shape/matrix: `AuthPreflightError` asserts `instanceof` + `name` + structured
      `harness`/`provider`/`model`; message names every checked source + both remediation commands
      (zai + anthropic variants).
- [ ] (b)/(c)/(e) remain proven by T3.S1's existing cases (cross-referenced, NOT duplicated).

### Code Quality Validation
- [ ] Reuses T3.S1's `vi.mock('groundswell')` + `AUTH_VARS` + temp-dir `PI_CODING_AGENT_DIR` scaffolding
      (no redeclaration / duplicate identifiers).
- [ ] The subprocess env is SCRUBBED (no `process.env` spread; no auth vars leaked from `.env`/setup).
- [ ] The subprocess `--prd` points at an EXISTING file (avoids the `parseCLIArgs` existsSync trap).
- [ ] Assertions target stable substrings (`auth.json`, `pi /login`) not absolute temp paths.
- [ ] Follows existing test conventions (file header JSDoc; `describe`/`it` naming; vitest `expect` style).

### Documentation & Scope
- [ ] NO `src/` file modified (test-only). NO new files (the work item says "or extend").
- [ ] NO edits to README.md (Mode B → T4.S1), environment.ts/harness.ts resolver/constants.ts/endpoint-guard
      (DONE/READ ONLY), the groundswell repo, or PRD.md/tasks.json/prd_snapshot.md/.gitignore.
- [ ] T3.S1's 6 coverage cases are preserved (the file is EXTENDED, not replaced).

---

## Anti-Patterns to Avoid

- ❌ Don't duplicate T3.S1's 6 coverage-sufficient cases (ZAI-proceeds, auth.json-proceeds, no-cred-throws,
      whitespace-throws, claude-code-throws, claude-code-proceeds). T3.S2 adds the MISSING acceptance cases
      (a end-to-end, d provider-conditional, full shape/matrix) only.
- ❌ Don't spread `process.env` into the spawned subprocess — `tests/setup.ts` runs `dotenv.config()` so it
      may carry real creds → a false pass (or a real LLM call if the preflight somehow passed). Pass a
      minimal scrubbed env with a temp `PI_CODING_AGENT_DIR`.
- ❌ Don't pass a bogus/absent `--prd` to the subprocess — `parseCLIArgs` (src/cli/index.ts:640) exits 1 with
      `PRD file not found` BEFORE the preflight, giving a false pass. Use an existing PRD (the repo `./PRD.md`).
- ❌ Don't assert the preflight message on `res.stdout` — `console.error` writes to **stderr**. (Commander's
      `--help` goes to stdout; the preflight path is different.)
- ❌ Don't try to import/unit-test `main()` — it is not exported and `index.ts` auto-runs
      `void main().catch(...)`. The "exit 1 + no session dir" guarantee is process-level → use `spawnSync`.
- ❌ Don't refactor/export `main()` or touch any `src/` file to make testing "easier" — this is a test-only
      work item; the contract is already shipped by T3.S1.
- ❌ Don't call `runAuthPreflight()` for the case-(d) anthropic branch WITHOUT `configureEnvironment()` first
      — the `ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY` map the branch depends on lives in `configureEnvironment`
      (T2.S1) and the preflight relies on it (mirrors index.ts L113→L119).
- ❌ Don't redeclare `vi.mock('groundswell')`, `AUTH_VARS`, `tmpAgentDir`, `beforeEach`, `afterEach` — they
      already exist in the file (T3.S1). Reuse them; redeclaring is a duplicate-identifier compile error.
- ❌ Don't forget the `describeOrSkip` build gate on the subprocess block — `npm run validate` (test:run)
      does not build; an unconditional `describe` fails in a build-less run.
- ❌ Don't assert on the absolute temp `auth.json` path — the temp `PI_CODING_AGENT_DIR` makes it absolute
      and non-deterministic. Assert the stable substring `auth.json` (and `pi /login`).
- ❌ Don't touch README.md (Mode B → T4.S1), the groundswell repo, or
      PRD.md/tasks.json/prd_snapshot.md/.gitignore (READ ONLY).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood. The contract under test is ALREADY shipped and
verified present (T3.S1, uncommitted): the exact `runAuthPreflight()` predicate, the `AuthPreflightError`
fields + `buildPreflightMessage` output, and the `index.ts` L113→L119→L120 wiring are quoted verbatim in
`research/verified_facts.md §1`, so every assertion string is grounded. The subprocess pattern is copied
from the existing `logger-teardown.test.ts` (cited); the two load-bearing gotchas (parseCLIArgs
existsSync trap on `--prd`; scrubbed-env + temp `PI_CODING_AGENT_DIR` for the spawn) are documented with
the exact env object. The provider-conditional case (d) ordering (configureEnvironment-before-preflight)
is explained. The one residual risk is environmental: the case-(a) subprocess test depends on a clean
build + a real-existing `--prd`, both gated by `describeOrSkip` and the Level-2 `npm run build` step, so a
misconfigured local tree degrades to a skip (green) rather than a false failure. Coverage is a no-op
(tests-only; the gate cannot drop).
