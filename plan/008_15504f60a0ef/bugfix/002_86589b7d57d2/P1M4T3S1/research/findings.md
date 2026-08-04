# P1.M4.T3.S1 Research — coder-agent.test.ts (model rot + vi.mock hoisting + 2 MORE causes)

**Verified baseline (live run):** `npx vitest run tests/integration/coder-agent.test.ts` →
**24 failed | 6 passed (30)**. The 6 passing = Suite 1 (5× PRP_BUILDER_PROMPT structure) +
Suite 3 test 2 ("should use real BashMCP for validation" — constructs the executor but never
calls `execute()`, so no checkpoint write).

> ⚠️ The contract (item description + architecture doc) names only TWO causes (hoisting +
> model rot). The live run proves **FOUR** distinct causes. All four are test-only rot — the
> production code (`src/agents/prp-executor.ts`, `src/agents/agent-factory.ts`,
> `src/core/checkpoint-manager.ts`) is in-spec. Every fix below is test-only (rule 5).

---

## Cause map (24 failures → 4 root causes, all verified)

| # | Tests | Root cause (verified) | Fix |
|---|-------|-----------------------|-----|
| 1 | Suite 2 (7) `createCoderAgent configuration` | `vi.mock('../../src/agents/agent-factory.js')` declared at MODULE LEVEL (between suites) is **hoisted** by vitest to file top → applies to Suite 2 too → `createCoderAgent()` is `vi.fn()` → returns `undefined` → `gs.createAgent` NEVER called → all 7 `expect(gs.createAgent).toHaveBeenCalledWith(...)` fail at lines 240/256/272/288/303/322/338. | **Split** Suite 2 into its own file (no agent-factory mock). |
| 2 | Suite 2, test 1 (`model`) | Model rot: test expects `model:'GLM-4.7'`. Actual = `zai/glm-5-turbo` (see chain below). | Correct assertion → `'zai/glm-5-turbo'`. |
| 3 | Suites 4–8 + Suite 3 test 1 (16) | **CheckpointManager stale-file collision.** `new PRPExecutor(process.cwd())` ⇒ CheckpointManager writes to `<cwd>/artifacts/P1.M2.T2.S2/checkpoints.json`. A **STALE git-tracked** file there (written pre-`timedOut`, before P3.M2.T2.S2) lacks the now-required `validationResults[].timedOut: boolean` → `CheckpointFileSchema.parse` throws at `checkpoint-manager.ts:398` on the 2nd `saveCheckpoint` → `execute()` catch → returns `{success:false, validationResults:[], fixAttempts:0}` → every executor assertion fails. | Isolate: use a fresh `mkdtempSync` temp dir as `sessionPath` (repo convention), not `process.cwd()`. |
| 4 | Suite 3 test 1 (`should inject PRP path into prompt`) | **Prompt-object drift.** Test asserts `typeof promptArg === 'string'` + `.toContain('Execute BASE PRP')`. Impl now builds a real **Prompt object** via `createPrompt({user:`Execute the PRP located at: ${prpPath}…`})` (prp-executor.ts:~455) and passes THAT to `coderAgent.prompt()`. `createPrompt` is the mocked `gs.createPrompt` (returns `undefined`) → `promptArg` is `undefined`. | Assert on `gs.createPrompt` call args (user contains prpPath), not on `promptArg`. |

### Model resolution chain (verified, read the source)
`createCoderAgent()` → `createBaseConfig('coder','implementation')` (agent-factory.ts) →
`ROLE_CONFIG.implementation.tier === 'fast'` → `getModel('fast')` (environment.ts:237) →
no `PRP_MODEL_FAST`/legacy env → `qualifyModel(MODEL_NAMES.fast /* 'glm-5-turbo' */, 'zai')`
→ `'zai/glm-5-turbo'`. So **assert `model: 'zai/glm-5-turbo'`**. `maxTokens:4096` is STILL
correct (`PERSONA_TOKEN_LIMITS.coder === 4096`).

### Why split is safe (no harness-seam mock needed for the config suite)
The REAL `createCoderAgent()` → `resolvedHarness()` → `configureEnvironment()` + `configureHarness()`.
`configureHarness()` (harness.ts) does NOT throw in the default config: reads `PRP_AGENT_HARNESS`
(default `'pi'`), `getResolvedProvider()` → `'zai'`; the only forbidden combo is `claude-code`+`zai`,
so pi+zai passes; registers `PiHarness` idempotently (`registry.has('pi')` guard); calls
`configureHarnesses(...)` (the groundswell mock spreads `actual`, so this is the real fn — fine).
Then `createAgent(config)` is the **mocked** `gs.createAgent` → captures the config. ⇒ The split
config file needs ONLY the `groundswell` mock + a dynamic import of the real `createCoderAgent`.
No `initRealHarness()`, no harness/env mocking. (Contrast: the P1.M4.T2 suites need the seam
because they exercise the real agent/harness path; Suite 2's subject is the CONFIG, captured at
the mocked `createAgent` boundary.)

---

## Line-by-line audit of executor assertions (Suites 3–8) — ALL CORRECT, no production change

Read `src/agents/prp-executor.ts` against each assertion. Once Cause 3 (checkpoint) is isolated,
these pass as-written (except Cause 4's prompt test):

- **stop-on-first-failure** (Suite 4 test 2): `#runValidationGates` `break`s on first `!success`.
  With gates [L1 echo pass, L2 `false` fail, L3 …], each retry cycle yields [L1 pass, L2 fail]
  (L3 never runs); `validationResults` holds only the LAST cycle (while loop overwrites) =
  [L1,L2]. `nonSkippedResults.length === 2 ≤ 2` ✓. (fixAttempts reaches 2; L3 absent.)
- **fixAttempts === 2 on exhaustion** (Suite 5 test 1): `while (fixAttempts ≤ maxFixAttempts=2)`;
  increments 0→1→2, breaks when `fixAttempts < 2` is false ⇒ `fixAttempts === 2`, `success:false` ✓.
- **stdout capture** (Suite 6 test 2): `result.stdout` from `BashMCP.execute_bash` ✓.
- **stderr capture** (Suite 6 test 3): `sh -c "echo error >&2; echo success"` → `stderr` contains
  `'error'` ✓ (`exitCode 0`, `success:true`).
- **exitCode capture** (Suite 6 test 4): `result.exitCode ?? null`; a failed non-skipped gate has
  `exitCode !== 0` ✓.
- **skip manual gates** (Suite 4 test 3): `gate.manual || command===null` ⇒ `{success:true, skipped:true}` ✓.
- **skip null command** (Suite 4 test 4): `command === null` ⇒ skipped ✓.
- **4 levels sequential** (Suite 4 test 1): all pass ⇒ 4 results, levels [1,2,3,4] ✓.
- **JSON parsing** (Suite 8): `#parseCoderResult` strips ` ```json … ``` ` and `JSON.parse`-fallbacks
  to `{result:'error', message:…}` on garbage ✓.
- **validationResults structure / length 4 / fixAttempts+success+artifacts** (Suite 7): shape match ✓.

⇒ The ONLY executor-side assertion that is itself stale is the prompt-injection test (Cause 4).

---

## Fix design (chosen)

1. **SPLIT Suite 2** into new `tests/integration/coder-agent-config.test.ts`: groundswell mock only
   (spread actual + override `createAgent`/`createPrompt`), NO agent-factory mock, dynamic-import
   the real `createCoderAgent`, assert the 7 config fields with `model:'zai/glm-5-turbo'`.
   Remove Suite 2 from `coder-agent.test.ts` (the agent-factory mock then becomes collision-free).
2. **Model assertion** `'GLM-4.7'` → `'zai/glm-5-turbo'` (in the new config file).
3. **Checkpoint isolation** in `coder-agent.test.ts` Suites 3–8: add a shared `tempDir` via
   `mkdtempSync(join(tmpdir(),'coder-agent-'))` in `beforeEach`, `rmSync(tempDir,{recursive:true,force:true})`
   in `afterEach`; replace every `new PRPExecutor(process.cwd())` / `new PRPExecutor(sessionPath)`
   (where `sessionPath === process.cwd()`) with `new PRPExecutor(tempDir)`. Mirrors repo convention
   (`cli-task-status.test.ts`, `pipeline-main-loop.test.ts`, `core/*`).
4. **Prompt-drift assertion** (Suite 3 test 1): replace the stale `typeof promptArg==='string'` /
   `.toContain('Execute BASE PRP')` / `.toContain('Progressive Validation')` /
   `.not.toContain('$PRP_FILE_PATH')` block with an assertion on `gs.createPrompt` call args
   (`user` contains `prpPath`). Keep `expect(mockAgent.prompt).toHaveBeenCalled()`.

### Orthogonal observation (NOT required for green; out of minimal scope)
`git ls-files artifacts/` shows two STALE tracked checkpoint files
(`artifacts/P1.M2.T2.S2/checkpoints.json`, `artifacts/P1.M3.T3.S2/checkpoints.json`) written by
pre-`timedOut` code. The temp-dir fix means tests never touch them, so they no longer cause
failures. Deleting them is optional/orthogonal — flagged for the maintainer, not prescribed here
(keeps the change minimal + test-only; deletion of tracked artifacts is a separate judgment call).