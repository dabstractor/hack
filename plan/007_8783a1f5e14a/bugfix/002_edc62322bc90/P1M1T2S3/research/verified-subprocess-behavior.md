# Verified subprocess behavior — claude-code + zai mismatch (research note)

Captured 2026-06-30 against the working tree of `hacky-hack` to make the
P1.M1.T2.S3 PRP assertions concrete (not guessed).

## State of the working tree (verified)

- **S1 (lazy `resolvedHarness()` accessor)** — DONE in source.
  `src/agents/agent-factory.ts` (lines ~47–60):
  ```ts
  let _resolvedHarness: AgentHarness | undefined;
  const resolvedHarness = (): AgentHarness => {
    if (_resolvedHarness === undefined) {
      configureEnvironment();
      _resolvedHarness = configureHarness();
    }
    return _resolvedHarness;
  };
  ```
  → no module-eval `configureHarness()` side effect.

- **S2 (explicit `configureHarness()` + extended `main().catch()`)** — DONE in source.
  `src/index.ts` `main()` ordering (verified line numbers):
  - L130 `const logger = getLogger('App', {...})` (moved up)
  - L142 `if (args.dryRun)     { ...; return 0; }`        ← EARLY RETURN
  - L156 `if (args.validatePrd){ ...; return ...; }`      ← EARLY RETURN
  - L211 `configureHarness();`                            ← reached ONLY on agent path
  - L212 `await runAuthPreflight();`
  - L217 `await ensureHarnessInitialized();`
  `main().catch()` (L334–345):
  ```ts
  void main().catch((error: unknown) => {
    if (error instanceof AuthPreflightError)       { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof HarnessProviderMismatchError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    console.error('\n❌ Fatal error in main():', error); process.exit(1);
  });
  ```

- **`dist/` is STALE** (gitignored build artifact). `dist/agents/agent-factory.js`
  still contains `const RESOLVED_HARNESS = configureHarness();` (module-eval
  side effect). `dist/index.js` mtime < `src/index.ts` / `src/agents/agent-factory.ts`
  mtime. **`npm run build` is a mandatory prerequisite** before the new
  subprocess test can RUN and PASS (otherwise `describeOrSkip` skips when no
  build, or — if a stale build exists — the test FAILS showing the bug).

## BAD output — captured live against stale `dist/` (matches PRD §h3.3 verbatim)

Command: `PRP_AGENT_HARNESS=claude-code` + scrubbed env (no cred) +
`node dist/index.js --prd PRD.md --dry-run` (flag irrelevant at module load).

```
file:///home/dustin/projects/hacky-hack/dist/config/harness.js:119
        throw new HarnessProviderMismatchError(harness, resolvedProvider);
              ^

HarnessProviderMismatchError: Harness 'claude-code' is incompatible with provider 'zai' (PRD §9.2.4). Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.
    at configureHarness (file:///home/dustin/projects/hacky-hack/dist/config/harness.js:119:15)
    at file:///home/dustin/projects/hacky-hack/dist/agents/agent-factory.js:38:26
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async node:internal/modules/esm/loader:666:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  harness: 'claude-code',
  provider: 'zai'
}

Node.js v26.2.0
EXIT=1
```

### BAD-output discriminator substrings (these MUST be ABSENT after the fix)
- `Node.js v`                          ← the version banner
- `at ModuleJob.run`                   ← stack frame
- `at file://`                         ← stack frame (file:// URL frames)
- `at configureHarness`                ← stack frame
- `HarnessProviderMismatchError:`      ← the raw `ErrorClass:` header Node prepends
                                         only when printing an UNCAUGHT error object.
                                         (The clean path prints `\n❌ <message>` only.)

## GOOD output — format verified via the sibling clean-render path (AuthPreflightError)

Positive control (stale dist, default harness, no cred → preflight aborts cleanly):
```

❌ Authentication preflight failed: no credential configured for provider 'zai' (harness 'pi', model 'zai/glm-5.2').
...
EXIT=1
```
→ confirms `main().catch()` renders `\n❌ ${error.message}` to **stderr** + `exit 1`.
`HarnessProviderMismatchError` uses the identical arm, so after rebuild its clean
output is exactly:

```
\n❌ Harness 'claude-code' is incompatible with provider 'zai' (PRD §9.2.4). Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.
```
+ `EXIT=1`. No stack, no banner, no `HarnessProviderMismatchError:` line.

## HarnessProviderMismatchError message — exact text (src/config/types.ts L155–157)

```ts
`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
`Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
```

## CRITICAL command gotcha (resolves a latent inconsistency in the work item)

The work-item CONTRACT specifies `spawnSync(process.execPath, [CLI, '--prd', absPrd, '--dry-run'], …)`.
**After S1's reorder, `--dry-run` returns at `main()` L142 BEFORE `configureHarness()` at L211** —
so `--dry-run` + `PRP_AGENT_HARNESS=claude-code` exits **0** (DRY RUN banner) and the mismatch
is **never thrown**. Assertions `res.status === 1` and `stderr contains 'incompatible'` would
therefore FAIL if `--dry-run` is used.

**Correct command for the mismatch test:** `spawnSync(process.execPath, [CLI, '--prd', absPrd], …)`
— NO `--dry-run`, NO `--validate-prd`. This reaches the agent path → `configureHarness()` throws →
`main().catch()` renders cleanly. (Identical to the existing acceptance (a) command.)

`--dry-run` (with claude-code) is still useful as a SEPARATE regression control proving the
module-load crash is GONE (see PRP Task 2b): `--dry-run` + claude-code → exit 0, no stack.

## Default provider/model (verified)

With no `PRP_AGENT_HARNESS`/model override + scrubbed env, the resolved provider is `zai`
and model `zai/glm-5.2` (seen in the preflight positive-control output above). So
`PRP_AGENT_HARNESS=claude-code` alone (no model override) reliably reproduces the mismatch.

## Coverage realities (verified)

- `src/index.ts` is **0%** in the committed coverage report (`main()` is not exported;
  auto-runs via `void main().catch()`; exercised ONLY via subprocess `spawnSync`, which
  does NOT feed the v8 in-process instrumenter). **Do NOT chase 100% on index.ts; do NOT
  add `/* istanbul ignore */`.** The subprocess suite IS the authoritative acceptance path.
- `src/agents/agent-factory.ts` lazy `resolvedHarness()` accessor — in-process coverage DOES
  apply (normal importable module). The memoization branch is hit by any test that
  constructs an agent config (e.g. `tests/integration/agents.test.ts` builds configs for
  architect/researcher/coder/qa). Verify agent-factory.ts coverage is not reduced by S1.

## Build / runner commands (package.json)

- `npm run build`   → `tsc -p tsconfig.build.json` (MANDATORY before running the subprocess test)
- `npm run test`    → `vitest` (watch)
- `npm run test:run`→ `vitest run`
- vitest coverage gate: **100%** statements/branches/functions/lines (v8 provider);
  `src/index.ts` 0% is pre-existing (the wider suite already has 212 unrelated failures).
- `dist/` is gitignored (`git check-ignore dist/index.js` → matches).
