# PRP — P1.M2.T2.S2: Tests verifying clean rendering (no stack trace) for config validation errors

> Bugfix 001, **BUG-002 (Minor)** step 4 (the tests). `.hack` validation errors (BOM, TOML parse,
> secrets, type/range/enum) are now thrown as `HackConfigError` (P1.M2.T1.S1) and rendered by a
> dedicated clean arm in `main().catch()` (P1.M2.T2.S1) — a single `\n❌ <message>` line + exit 1,
> no stack trace. **This item proves that rendering end-to-end** via subprocess (`spawnSync tsx +
> src/index.ts`): a malformed `.hack` in a real git repo triggers the clean arm and prints exactly
> one `❌` line with the actionable message and NO `at …` stack frames and NO `Fatal error in main()`
> preamble. PRD §9.7.6/§9.7.7/§9.2.7 (actionable startup errors; fail-fast). **Test-only** — no
> `src/` changes; consumes the arms from S1. **DOCS: none.**

---

## Goal

**Feature Goal**: Add an integration test suite proving `.hack` config-validation errors
(`HackConfigError`) render through a clean `main().catch()` arm — a single `\n❌ <message>` line,
exit 1, **no stack trace** — for each error class the contract names: (a) a `[tasks_lock] poll_ms`
range error, (b) a `[auth] zai_api_key` secrets error, (b′) a BOM error, plus (c) a
`NotARepositoryError` contrast case as a regression guard that the S1 arms did not shadow the existing
clean arm. Locks PRD §9.7.6/§9.7.7/§9.2.7 (clean actionable startup-error rendering) as an executable
end-to-end invariant.

**Deliverable**:
1. **`tests/integration/config-error-rendering.test.ts`** — **CREATE**: a single `describe` block with
   a subprocess harness mirroring `tests/integration/repo-root-acceptance.test.ts` (`tsx` + absolute
   `src/index.ts`, `makeRepo()` via `git init`, `runCli(args, cwd)` via `spawnSync`, `finally`/afterEach
   cleanup). Four `it` cases: range, secrets, BOM, NotARepository contrast. Each spawns the real CLI in
   a controlled tmpdir, asserts `status === 1`, stderr contains `❌` + the message substring(s), and
   stderr does NOT match `/\n\s*at /` (stack trace) NOR contain `Fatal error in main()` (default-arm
   preamble). **No `src/` changes** (consumes S1's arms); **no docs** (rendering format is unchanged).

**Success Definition** (the contract from the work item):
- (a) Range: `[tasks_lock]\npoll_ms = -5` + `--dry-run` → exit 1; stderr has `❌` + `poll_ms` +
  `out of range`; NO `at ` stack frames; NO `Fatal error in main()`.
- (b) Secrets: `[auth] zai_api_key = "sk-…"` + `--dry-run` → exit 1; stderr has `❌` + a secrets
  mention (`Secret`/`zai_api_key`); NO stack trace.
- (b′) BOM: raw `0xEF 0xBB 0xBF` bytes + valid TOML → exit 1; stderr has `❌` + `BOM`; NO stack trace.
- (c) Contrast: a non-repo invocation → exit 1; stderr has `❌` + `No .git entry found`; NO stack
  trace (proves S1's two new arms did not shadow the existing NotARepositoryError arm).
- All tmpdirs cleaned up (`rmSync` in `finally`/afterEach). GREEN once S1 (P1.M2.T2.S1) + S1-of-T1
  (P1.M2.T1.S1) have landed. `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **BUG-002 is a rendering bug; this test pins the rendering.** The messages were always correct; the
  bug was that they rendered through the DEFAULT `main().catch()` arm (`console.error('\n❌ Fatal error
  in main():', error)`) — appending a 4-line stack trace into `hack-config.js` internals. S1 adds two
  dedicated clean arms; this test proves the arms actually fire for each error class and that NO stack
  reaches the user. Without it, a future refactor that drops an arm (or reorders arms) silently
  regresses to the scary stack-trace render and nothing fails.
- **End-to-end is the only faithful level.** `main()` is NOT exported and `index.ts` auto-runs
  `void main().catch(...)` (src/index.ts:387), so the catch arms cannot be unit-tested in-process
  (importing index.ts runs the whole bootstrap). The clean-arm rendering is a PROCESS-level property
  (which `console.error` form fired, what reached stderr, what the exit code is) — it must be verified
  via subprocess (`spawnSync`). This mirrors how `repo-root-acceptance.test.ts` (case d) and
  `auth-preflight.test.ts` (acceptance a) verify their clean arms. See research §2.
- **Disjoint from the validation-logic tests.** `tests/unit/config/hack-config.test.ts` already covers
  WHAT throws and the message CONTENT (in-process `expect(() => loadHackConfig(repoRoot)).toThrow(…)`).
  This task covers the RENDERING (subprocess, no stack). Disjoint concern, disjoint mechanism — no
  duplication. See research §7.
- **Consumes S1 + S1-of-T1 as a contract.** S1 (P1.M2.T2.S1, parallel previous) adds the two clean arms
  to `main().catch()`; S1-of-T1 (P1.M2.T1.S1) defined `HackConfigError` (types.ts:246, verified present)
  and converted the 9 throw sites (verified: `throw new HackConfigError` at hack-config.ts
  84/91/775/817/822/828/834). This test is GREEN once both land; before that the .hack cases are RED
  (stack trace) by design — the test drives the fix. The NotARepositoryError contrast (c) is GREEN
  regardless (existing arm). See research §10.
- **Out of scope (hard boundary):** defining/converting `HackConfigError` (P1.M2.T1.S1), adding the
  clean arms to `main().catch()` (P1.M2.T2.S1), any `src/` change, BUG-003 relational constraint
  (P1.M3.T1.S1), the optional config-subcommand catch rendering (architecture Step 5), any `docs/*.md`.
  This is a **test-only** subtask.

---

## What

### User-visible behavior
None beyond the test suite. This is a pure characterization/regression test. Observable change: one
new green integration test file under `tests/integration/`. No new env vars, no new public API, no
behavior change anywhere.

### Technical requirements (exact contract)

**`tests/integration/config-error-rendering.test.ts`** (CREATE) — a single `describe`
`'BUG-002 config-error rendering — clean ❌ arms (PRD §9.7.6/§9.7.7/§9.2.7)'` with a subprocess harness
and four `it` cases. All determinism comes from real tmpdirs + `git init` + `spawnSync tsx`.

**Imports** (exact — mirror `repo-root-acceptance.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
```

**Harness** (verbatim from `repo-root-acceptance.test.ts` — the contract's recommended pattern):

```ts
// LOCAL tsx binary + ABSOLUTE script path (no build needed; robust to cwd).
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

const runCli = (args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

// Create a real git repo tmpdir (git init). Caller cleans up via rmSync in finally.
const makeRepo = (prefix: string): string => {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(`git init failed: ${r.stderr ?? 'unknown'} (is git installed?)`);
  }
  return repo;
};

// Shared clean-rendering assertions (the BUG-002 contract).
const assertCleanRender = (
  result: { status: number | null; stderr: string },
  ...messageSubstrings: string[]
): void => {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('❌');
  for (const sub of messageSubstrings) {
    expect(result.stderr).toContain(sub);
  }
  // Clean arm fired — NOT the default arm's two-arg dump (stack + preamble).
  expect(result.stderr).not.toMatch(/\n\s*at /); // no Node stack frames
  expect(result.stderr).not.toContain('Fatal error in main()'); // not the default-arm preamble
};
```

**Case (a) — range error** (`[tasks_lock] poll_ms = -5`):

```ts
it('(a) a [tasks_lock] poll_ms range error renders as a single ❌ line, no stack trace', () => {
  const repo = makeRepo('cfg-range-');
  try {
    writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n'); // pass parseCLIArgs existsSync check (research §5)
    writeFileSync(join(repo, '.hack'), '[tasks_lock]\npoll_ms = -5\n');

    const result = runCli(['--dry-run'], repo); // loadHackConfig throws BEFORE the dry-run early-return

    assertCleanRender(result, 'poll_ms', 'out of range');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

**Case (b) — secrets error** (`[auth] zai_api_key = "sk-…"`):

```ts
it('(b) a [auth] secrets error renders as a single ❌ line, no stack trace', () => {
  const repo = makeRepo('cfg-secret-');
  try {
    writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
    writeFileSync(join(repo, '.hack'), '[auth]\nzai_api_key = "sk-live-DO-NOT-COMMIT"\n');

    const result = runCli(['--dry-run'], repo);

    // The KEY NAME is in the message; the secret VALUE is never echoed (research §4).
    assertCleanRender(result, 'Secret', 'zai_api_key');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

**Case (b′) — BOM error** (raw `0xEF 0xBB 0xBF` bytes):

```ts
it('(b\') a UTF-8 BOM renders as a single ❌ line, no stack trace', () => {
  const repo = makeRepo('cfg-bom-');
  try {
    writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
    // Raw BOM bytes + otherwise-valid TOML. A utf8 string would re-encode the BOM away.
    writeFileSync(
      join(repo, '.hack'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[tasks_lock]\npoll_ms = 100\n')])
    );

    const result = runCli(['--dry-run'], repo);

    assertCleanRender(result, 'BOM');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

**Case (c) — NotARepositoryError contrast** (regression guard):

```ts
it('(c) a NotARepositoryError still renders cleanly (S1 arms do not shadow it)', () => {
  // A tmpdir with NO .git ancestor. The preAction hook throws NotARepositoryError BEFORE parseCLIArgs'
  // PRD-existence check (research §5) — so no PRD.md needed here.
  const nonRepo = mkdtempSync(join(tmpdir(), 'cfg-norepo-'));
  try {
    const result = runCli(['--dry-run'], nonRepo);

    assertCleanRender(result, 'No .git entry found');
  } finally {
    rmSync(nonRepo, { recursive: true, force: true });
  }
});
```

### Success Criteria

- [ ] `tests/integration/config-error-rendering.test.ts` exists and is green (once S1 + S1-of-T1 land).
- [ ] Case (a): range error → exit 1, `❌` + `poll_ms` + `out of range`, no `/\n\s*at /`, no
      `Fatal error in main()`.
- [ ] Case (b): secrets error → exit 1, `❌` + `Secret` + `zai_api_key`, no stack.
- [ ] Case (b′): BOM → exit 1, `❌` + `BOM`, no stack (raw Buffer bytes written).
- [ ] Case (c): non-repo → exit 1, `❌` + `No .git entry found`, no stack (existing arm still fires).
- [ ] All tmpdirs cleaned up (`rmSync` in `finally`).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; no `src/` changes.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
file path, every import, the verbatim subprocess harness (`tsxBin`/`absIndex`/`runCli`/`makeRepo`/
`assertCleanRender`), and all four `it` cases (range/secrets/BOM/contrast) are written out verbatim with
the verified message substrings. The non-obvious facts are documented with proof: (1) `main()` is not
exported → subprocess is the only way (research §2); (2) `--prd` defaults to `./PRD.md` + parseCLIArgs
has an existsSync check → every repo case must write a `PRD.md` (research §5); (3) the BOM must be
written via `Buffer.from([...])` (a utf8 string re-encodes it away); (4) the secret VALUE is never
echoed (assert on the key name); (5) use `tsx`+`src/index.ts`, NOT `dist/index.js` (no build dependency);
(6) the GREEN-once-S1-lands sequencing dependency. See research §1-§10.

### Documentation & References

```yaml
# MUST READ — the BUG-002 fix strategy (what this item verifies: step 3 rendering + step 1/2 typed error)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_002_fix_strategy.md
  section: "Step 3: Add clean arm to main().catch()" + "Risks"
  why: Prescribes the HackConfigError clean arm that this test verifies fired. The Risks note confirms
        e.message is unchanged by the typing → message-substring assertions are stable.
  critical: Step 5 (config subcommand catch) is OPTIONAL + out of scope; the main().catch() arms satisfy
        BUG-002 for the default pipeline path (.hack is loaded in main() at line 164).

# MUST READ — this subtask's research (the test pattern + exact messages + execution order)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T2S2/research/config-error-rendering-strategy.md
  section: "1. subprocess pattern to mirror", "2. main() NOT exported → subprocess only",
           "3. exact main().catch() block", "4. exact error messages", "5. execution order (PRD.md + repo required)",
           "6. stack-trace detection", "7. disjointness", "8. placement", "9. coverage", "10. dependencies"
  why: The repo-root-acceptance harness (tsx + src/index.ts, makeRepo, runCli) + the verbatim message
        strings for range/secrets/BOM + why PRD.md + a real repo are required to reach loadHackConfig +
        the /\n\s*at / stack regex + the GREEN-once-S1-lands sequencing.

# MUST READ — the file UNDER TEST (main().catch() — the arms S1 adds; this test verifies them fire)
- file: src/index.ts
  why: The catch block at 387-413 (S1 inserts 2 arms before the default@412). main() auto-runs
        void main().catch(...) — NOT exported → subprocess-only testing. loadHackConfig(repoRoot) at
        line 164 throws HackConfigError BEFORE the dry-run early-return at 189.
  pattern: "console.error(`\\n❌ ${error.message}`); process.exit(1);"  # the CLEAN arms (S1)
  gotcha: main() is NOT exported; importing index.ts runs the bootstrap. Verify end-to-end via spawnSync.

# MUST READ — the validation messages under test (read-only; do NOT edit)
- file: src/config/hack-config.ts
  why: The exact throw sites + messages this test asserts on. Range (832-836), secrets (775-779), BOM
        (84-86). All now `throw new HackConfigError(...)` (S1-of-T1). Verified import at line 12.
  pattern: "throw new HackConfigError(`[${section}] ${key} in ${file}: ${value} is out of range (${range}).`)"
  gotcha: The secret VALUE is never echoed — the secrets check fires on the KEY NAME first
        (hack-config.ts:744-747). Assert on the key name (zai_api_key), NOT the value.

# THE ERROR CLASS (read-only — S1-of-T1 owns the definition)
- file: src/config/types.ts
  why: HackConfigError (line 246, VERIFIED present) + EnvironmentValidationError (line 79). Both extend
        Error → e.message works + the instanceof arms in main().catch() are precise. Do NOT edit.

# PATTERN FILES — copy the subprocess harness + assertions EXACTLY
- file: tests/integration/repo-root-acceptance.test.ts
  why: THE recommended pattern (item description cites it). tsx + absolute src/index.ts, makeRepo() via
        git init, runCli(args, cwd) via spawnSync, rmSync cleanup in finally. Its case d is the model
        for the NotARepositoryError contrast + the not.toContain('Fatal error in main()') check.
  pattern: "const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx'); const absIndex = resolve(process.cwd(), 'src/index.ts'); const runCli = (args, cwd) => { const result = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' }); return { status: result.status, stdout: ..., stderr: ... }; };"
  gotcha: Use tsx + src/index.ts (NO build needed). Do NOT copy the auth-preflight dist/index.js variant.

- file: tests/unit/config/hack-config.test.ts
  why: CONFIRMS this task is DISJOINT — that file tests validation LOGIC in-process
        (expect(() => loadHackConfig(repoRoot)).toThrow(/poll_ms/)). This task tests RENDERING
        (subprocess, no stack). The BOM Buffer trick (lines 77-78) is reused here for case (b′).
  pattern: "writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('...')]))"

# CONSUMERS (read-only — proves non-breaking + non-overlapping)
- file: tests/unit/config/auth-preflight.test.ts
  why: The OTHER subprocess pattern (dist/index.js + describe.skip). CONFIRMS this test uses the tsx
        variant instead (no build dependency). Its acceptance-a case is the model for exit-1 +
        stderr-contains + no-session assertions, but is scoped to AuthPreflightError (disjoint).

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — this test consumes it)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T2S1/PRP.md
  why: S1 adds the HackConfigError + EnvironmentValidationError clean arms to main().catch() before the
        default arm. THIS TEST verifies those arms fire (clean render, no stack). GREEN once S1 lands;
        before that the .hack cases are RED (stack) by design. The NotARepositoryError contrast is GREEN
        regardless (S1 inserts AFTER... before the default, not shadowing the existing arm).
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T1S1/PRP.md
  why: S1-of-T1 defines HackConfigError (types.ts:246) + converts the 9 throw sites. Without it the
        throw sites emit plain Error → default arm → stack. Assume it landed (verified present).

# COVERAGE CONFIG — confirms test-only lands cleanly
- file: vitest.config.ts
  why: thresholds are a FLOOR (~89 statements / 90 branches), NOT 100% (S1 PRP research §4). This task
        adds NO new src file (test-only) → NO coverage obligation. tests/** is excluded from measurement.
```

### Current Codebase tree (relevant slice)

```bash
src/index.ts                                  # UNCHANGED — main().catch() arms (S1 adds them); this test verifies they fire
src/config/hack-config.ts                     # UNCHANGED — the 9 HackConfigError throw sites (S1-of-T1); messages asserted here
src/config/types.ts                           # UNCHANGED — HackConfigError class (S1-of-T1); read-only
src/cli/index.ts                              # UNCHANGED — --prd defaults to './PRD.md' (line 339); preAction hook resolves repo
tests/integration/
├── repo-root-acceptance.test.ts              # UNCHANGED — the subprocess PATTERN this test mirrors
└── config-error-rendering.test.ts            # ← THIS SUBTASK CREATES (BUG-002 rendering: range/secrets/BOM/contrast)
tests/unit/config/hack-config.test.ts         # UNCHANGED — DISJOINT (validation logic, in-process)
tests/unit/config/auth-preflight.test.ts      # UNCHANGED — DISJOINT (AuthPreflightError, dist/index.js variant)
```

### Desired Codebase tree with files to be added

```bash
tests/integration/config-error-rendering.test.ts   # NEW — BUG-002 clean-rendering subprocess tests (4 cases)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — main() is NOT exported + index.ts AUTO-RUNS void main().catch(...). You CANNOT unit-test
//   the catch arms in-process (importing index.ts runs the whole bootstrap). Verify end-to-end via
//   spawnSync(tsx, [src/index.ts, ...args], { cwd, encoding:'utf8' }). This mirrors
//   repo-root-acceptance.test.ts (case d) + auth-preflight.test.ts (acceptance a). See research §2.

// CRITICAL — USE tsx + src/index.ts, NOT dist/index.js. The item description points at
//   repo-root-acceptance.test.ts (tsx variant), which needs NO build. The auth-preflight variant spawns
//   dist/index.js + describe.skip-if-absent — do NOT copy that (adds a build dependency + skip-flakiness).

// CRITICAL — EVERY repo case must write a PRD.md. --prd defaults to './PRD.md' (cli/index.ts:339) and
//   parseCLIArgs does an existsSync check (the "existsSync trap", per auth-preflight.test.ts comment) →
//   throws "PRD file not found" if missing, BEFORE main() reaches loadHackConfig. So to trigger a .hack
//   validation error you need BOTH a real git repo (preAction hook succeeds + chdirs) AND a PRD.md in it.
//   writeFileSync(join(repo,'PRD.md'), '# Minimal PRD\n') is enough. The non-repo case (c) needs NO
//   PRD.md (the preAction hook throws NotARepositoryError before the PRD check). See research §5.

// CRITICAL — loadHackConfig throws BEFORE the --dry-run early-return. main() order: parseCLIArgs
//   (preAction hook → chdir) → loadHackConfig(repoRoot) [line 164, THROWS] → configureEnvironment →
//   dryRun early-return [line 189]. So ['--dry-run'] reaches the .hack error regardless of dry-run.
//   Use --dry-run (matches the contract's `hack --dry-run` reproduction + is credential-free).

// CRITICAL — the BOM must be written via Buffer.from([0xef,0xbb,0xbf]) (+ valid TOML bytes). A plain
//   utf8 STRING re-encodes the BOM away → no BOM detected → test fails for the wrong reason. Mirror
//   hack-config.test.ts:77-78 (Buffer.concat). See research §4(b′).

// CRITICAL — the secret VALUE is never echoed. The secrets check (hack-config.ts:769-779) fires on the
//   KEY NAME before any value echoing (line 744-747 explicitly notes secrets are never passed to
//   validateFieldValue to avoid echoing). So assert on 'zai_api_key' (the key name IS in the message),
//   NOT on the 'sk-...' value. The value just needs to be non-empty/trim-non-empty to trigger the throw.

// CRITICAL — stack-trace detection: assert NOT toMatch(/\n\s*at /) (Node stack frames = newline + ws +
//   'at ' + word) AND NOT toContain('Fatal error in main()') (the default-arm preamble). The contract's
//   literal "does NOT contain 'at '" is realized via the /\n\s*at / regex (more precise — a bare 'at '
//   substring could false-match). Both checks together = "a clean arm fired, not the default". See §6.

// CRITICAL — GREEN-once-S1-lands sequencing. This test CONSUMES S1's (P1.M2T2S1) clean arms + S1-of-T1's
//   (P1.M2T1.S1) HackConfigError throw sites. Before they land, cases (a)/(b)/(b′) render through the
//   DEFAULT arm → stack trace (RED by design — the test drives the fix). Case (c) NotARepositoryError is
//   GREEN regardless (existing arm). Do NOT weaken assertions to force green before S1 lands; confirm
//   S1 + S1-of-T1 landed first. See research §10.

// GOTCHA — git must be installed (makeRepo shells out to `git init -q`). repo-root-acceptance.test.ts
//   already depends on this (5+ git init calls) and is green, so the dependency is satisfied in CI.

// GOTCHA — spawnSync timeout. Set timeout: 30_000 on spawnSync (tsx cold-start + git init + module load
//   can take a few seconds). Without a timeout a hung subprocess stalls the suite. repo-root-acceptance
//   omits it but its invocations are lighter; a BOM/parse error still loads the full module graph.

// GOTCHA — cleanup in finally (NOT just afterEach). Each case creates its own tmpdir + cleans it in a
//   finally block (mirror repo-root-acceptance). Do NOT rely solely on a global afterEach — a thrown
//   assertion mid-case must still rmSync the tmpdir or you leak into /tmp. Use `try { ... } finally { rmSync(repo, { recursive: true, force: true }); }`.

// GOTCHA — realpath. `git init` may create the repo under a symlinked /tmp (macOS). resolveRepositoryRoot
//   canonicalizes via realpath. For assertion purposes, assert on stable substrings (poll_ms / out of
//   range / BOM / No .git entry found), NOT on the absolute tmp path (which varies). repo-root-acceptance
//   asserts on realpathSync(repo) for path checks; here we avoid path-dependent assertions entirely.

// GOTCHA — prettier is ERROR-enforced (format:check). The harness + cases must match repo-root-acceptance's
//   style (2-space indent, trailing commas, single quotes). Run `npm run fix` before format:check.

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per the
//   bugfix architecture docs). Gate = typecheck + lint + format:check + the new test file green:
//   `npx vitest run tests/integration/config-error-rendering.test.ts`.

// CRITICAL — DO NOT touch src/ (consumes S1's arms + S1-of-T1's throw sites, read-only), any other test
//   file (repo-root-acceptance/auth-preflight/hack-config own their scopes), or any docs/*.md (DOCS: none).
```

---

## Implementation Blueprint

### Data models and structure

No new data models. This subtask consumes the existing `HackConfigError` throw sites (hack-config.ts,
S1-of-T1), the `HackConfigError`/`EnvironmentValidationError` clean arms in `main().catch()` (index.ts,
S1), and the established subprocess harness from `repo-root-acceptance.test.ts`. The only "structure"
is the test's local helpers: `tsxBin`, `absIndex`, `runCli`, `makeRepo`, `assertCleanRender` — all
defined verbatim above in the What section.

### Implementation Tasks (ordered by dependencies — GREEN once S1 + S1-of-T1 land)

```yaml
Task 1: CREATE tests/integration/config-error-rendering.test.ts   (the whole suite)
  - IMPORT: vitest primitives (describe/it/expect); node:fs (mkdtempSync, rmSync, writeFileSync);
    node:os (tmpdir); node:path (join, resolve); node:child_process (spawnSync).
  - HARNESS: tsxBin + absIndex (resolve against process.cwd()), runCli(args, cwd) with timeout:30_000,
    makeRepo(prefix) via `git init -q`, assertCleanRender(result, ...subs) (status===1 + ❌ + subs +
    NOT /\n\s*at / + NOT 'Fatal error in main()'). Verbatim from the What section.
  - CASE (a) range: makeRepo → write PRD.md + .hack('[tasks_lock]\npoll_ms = -5\n') → runCli(['--dry-run'], repo)
    → assertCleanRender(result, 'poll_ms', 'out of range'). Cleanup in finally.
  - CASE (b) secrets: makeRepo → write PRD.md + .hack('[auth]\nzai_api_key = "sk-live-DO-NOT-COMMIT"\n')
    → runCli(['--dry-run'], repo) → assertCleanRender(result, 'Secret', 'zai_api_key'). Cleanup in finally.
  - CASE (b′) BOM: makeRepo → write PRD.md + .hack via Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),
    Buffer.from('[tasks_lock]\npoll_ms = 100\n')]) → runCli(['--dry-run'], repo) →
    assertCleanRender(result, 'BOM'). Cleanup in finally.
  - CASE (c) NotARepository contrast: mkdtempSync (NO git init) → runCli(['--dry-run'], nonRepo) →
    assertCleanRender(result, 'No .git entry found'). Cleanup in finally. (No PRD.md — hook throws first.)
  - NAMING: describe('BUG-002 config-error rendering — clean ❌ arms (PRD §9.7.6/§9.7.7/§9.2.7)');
    it('(a) a [tasks_lock] poll_ms range error renders as a single ❌ line, no stack trace') etc.
  - PLACEMENT: tests/integration/config-error-rendering.test.ts (sibling of repo-root-acceptance.test.ts).
  - EXPECTED: GREEN once S1 (P1.M2T2S1) + S1-of-T1 (P1.M2T1.S1) have landed. If cases (a)/(b)/(b′) show
    a stack trace (RED), S1's arms are absent or placed after the default arm — confirm S1 landed and
    the arms precede the default. Case (c) is GREEN regardless. Do NOT weaken assertions to force green.

Task 2: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN (the new suite): npx vitest run tests/integration/config-error-rendering.test.ts
    (EXPECT green if S1 + S1-of-T1 landed; if RED with a stack trace, confirm S1 first.)
  - RUN (sibling regression — prove the new file didn't disturb neighbors):
    npx vitest run tests/integration/repo-root-acceptance.test.ts
  - RUN: git diff --name-only   # Expect EXACTLY tests/integration/config-error-rendering.test.ts.
  - DO NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per bugfix docs).
  - DO NOT edit src/ (consumes S1's arms), any other test file, or docs/*.md.
  - EXPECTED: typecheck/lint/format clean; the new suite green; git diff shows only the new test file.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/integration/config-error-rendering.test.ts (NEW — full reference) ----
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Hermetic subprocess invocation: LOCAL tsx binary + ABSOLUTE script path (no build needed).
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

const runCli = (
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(tsxBin, [absIndex, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

// Create a real git repo tmpdir (git init). Caller cleans up via rmSync in finally.
const makeRepo = (prefix: string): string => {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(
      `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
    );
  }
  return repo;
};

// Shared BUG-002 contract: exit 1 + single ❌ line + message substrings + NO stack + NO default preamble.
const assertCleanRender = (
  result: { status: number | null; stderr: string },
  ...messageSubstrings: string[]
): void => {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('❌');
  for (const sub of messageSubstrings) {
    expect(result.stderr).toContain(sub);
  }
  // A CLEAN arm fired — NOT the default arm's two-arg dump (stack trace + 'Fatal error in main():' preamble).
  expect(result.stderr).not.toMatch(/\n\s*at /); // no Node stack frames
  expect(result.stderr).not.toContain('Fatal error in main()'); // not the default-arm preamble
};

describe('BUG-002 config-error rendering — clean ❌ arms (PRD §9.7.6/§9.7.7/§9.2.7)', () => {
  it('(a) a [tasks_lock] poll_ms range error renders as a single ❌ line, no stack trace', () => {
    const repo = makeRepo('cfg-range-');
    try {
      // PRD.md is required: --prd defaults to './PRD.md' and parseCLIArgs existsSync-checks it BEFORE
      // main() reaches loadHackConfig (research §5). loadHackConfig throws BEFORE the dry-run early-return.
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      writeFileSync(join(repo, '.hack'), '[tasks_lock]\npoll_ms = -5\n');

      const result = runCli(['--dry-run'], repo);

      assertCleanRender(result, 'poll_ms', 'out of range');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(b) a [auth] secrets error renders as a single ❌ line, no stack trace', () => {
    const repo = makeRepo('cfg-secret-');
    try {
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      // A non-empty secret value in a COMMITTABLE tier (.hack, not .hack.local) → hard error (§9.7.6).
      // The secret VALUE is never echoed; assert on the KEY NAME (zai_api_key).
      writeFileSync(
        join(repo, '.hack'),
        '[auth]\nzai_api_key = "sk-live-DO-NOT-COMMIT"\n'
      );

      const result = runCli(['--dry-run'], repo);

      assertCleanRender(result, 'Secret', 'zai_api_key');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("(b') a UTF-8 BOM renders as a single ❌ line, no stack trace", () => {
    const repo = makeRepo('cfg-bom-');
    try {
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      // Raw BOM bytes (0xEF 0xBB 0xBF) + otherwise-valid TOML. A utf8 STRING re-encodes the BOM away
      // (hack-config.test.ts:77-78) — must write via Buffer.
      writeFileSync(
        join(repo, '.hack'),
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('[tasks_lock]\npoll_ms = 100\n'),
        ])
      );

      const result = runCli(['--dry-run'], repo);

      assertCleanRender(result, 'BOM');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(c) a NotARepositoryError still renders cleanly (S1 arms do not shadow it)', () => {
    // A tmpdir with NO .git ancestor. The preAction hook throws NotARepositoryError BEFORE parseCLIArgs'
    // PRD-existence check — so no PRD.md is needed here. Regression guard: S1's two new arms (inserted
    // before the default) must not shadow the existing NotARepositoryError arm.
    const nonRepo = mkdtempSync(join(tmpdir(), 'cfg-norepo-'));
    try {
      const result = runCli(['--dry-run'], nonRepo);

      assertCleanRender(result, 'No .git entry found');
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
```

### Integration Points

```yaml
NEW TEST (tests/integration/config-error-rendering.test.ts):
  - harness: spawnSync(LOCAL tsx, [ABSOLUTE src/index.ts, ...args], { cwd, encoding:'utf8', timeout:30_000 })
  - tmpdirs: real `git init` repos (makeRepo) + mkdtempSync non-repo; rmSync cleanup in finally.
  - consumes: src/index.ts main().catch() HackConfigError/EnvironmentValidationError arms (S1) +
    src/config/hack-config.ts HackConfigError throw sites (S1-of-T1). READ-ONLY — no src edits.
  - CLI: ['--dry-run'] (default --prd ./PRD.md); each repo case writes a PRD.md to pass parseCLIArgs'
    existsSync check.

NO CHANGES TO (hard boundary):
  - src/index.ts, src/config/hack-config.ts, src/config/types.ts, src/cli/index.ts (S1 + S1-of-T1 own).
  - tests/integration/repo-root-acceptance.test.ts, tests/unit/config/*.test.ts (own their scopes).
  - any docs/*.md (DOCS: none — rendering format unchanged; only stack suppressed).
  - NO new src/**/*.ts (coverage-safe — vitest.config.ts thresholds are a FLOOR, not 100%).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix            # lint:fix + prettier --write (run first — match repo-root-acceptance style)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a prettier nit (re-run `npm run fix`). No type errors expected
#   (the test imports only vitest + node: builtins; no project types referenced).
```

### Level 2: The New Suite (Component Validation)

```bash
# The new suite (must pass — IF S1 + S1-of-T1 landed):
npx vitest run tests/integration/config-error-rendering.test.ts
# Expected: 4 cases green. If cases (a)/(b)/(b′) are RED with a stack trace, S1's clean arms are
#   absent or placed AFTER the default arm — confirm P1.M2.T2.S1 landed and the two arms precede the
#   default. Case (c) NotARepositoryError is GREEN regardless. Do NOT weaken /\n\s*at / to force green.

# Sibling regression — the new file did not disturb the pattern source:
npx vitest run tests/integration/repo-root-acceptance.test.ts
# Expected: green (unchanged — disjoint file).
```

### Level 3: Integration / Regression (System Validation)

```bash
# Confirm ONLY the new test file changed (test-only; no src/):
git diff --name-only                           # Expect EXACTLY tests/integration/config-error-rendering.test.ts.
# Confirm the new file is well-formed + the harness compiles (no build needed — tsx runs .ts):
npx tsc --noEmit -p tsconfig.build.json
# Expected: git diff shows only the new test file; typecheck clean.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP. git must be installed (makeRepo shells out — already a CI dependency via repo-root-acceptance).
# Domain reasoning (record in commit message):
#   1. A .hack misconfiguration (HackConfigError: range/secrets/BOM) now renders as ONE actionable ❌
#      line with NO stack trace — matching NotARepositoryError/AuthPreflightError (PRD §9.7.6/§9.7.7/§9.2.7).
#   2. Case (c) proves S1's two new arms (inserted before the default) did NOT shadow the existing
#      NotARepositoryError arm — arm ordering is preserved.
#   3. The secret VALUE is never echoed (asserted on the key name zai_api_key) — confirms the secrets
#      check fires on the key name before any value echoing (hack-config.ts:744-747).
#   4. Disjoint from hack-config.test.ts (validation LOGIC, in-process) and repo-root-acceptance.test.ts
#      (§9.8 traversal) — this test owns the RENDERING layer end-to-end.
#   5. Coverage is a floor (~89/90), not 100% — test-only lands cleanly with no new src obligation.
#   6. Sequencing: GREEN once S1 (P1.M2T2.S1) + S1-of-T1 (P1.M2T1.S1) land; the .hack cases are RED
#      (stack) by design until then.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/config-error-rendering.test.ts` green (4 cases).
- [ ] `git diff --name-only` shows EXACTLY `tests/integration/config-error-rendering.test.ts`.

### Feature Validation
- [ ] Case (a): range → exit 1, `❌` + `poll_ms` + `out of range`, no `/\n\s*at /`, no `Fatal error in main()`.
- [ ] Case (b): secrets → exit 1, `❌` + `Secret` + `zai_api_key`, no stack.
- [ ] Case (b′): BOM → exit 1, `❌` + `BOM`, no stack (raw Buffer bytes written).
- [ ] Case (c): non-repo → exit 1, `❌` + `No .git entry found`, no stack (existing arm still fires).
- [ ] All tmpdirs cleaned up (`rmSync` in `finally`).

### Code Quality Validation
- [ ] New test mirrors the `repo-root-acceptance.test.ts` subprocess harness (tsx + src/index.ts, makeRepo, runCli).
- [ ] Uses `assertCleanRender` for the shared exit-1 + ❌ + no-stack contract (DRY across the 4 cases).
- [ ] BOM written via `Buffer.from([0xef,0xbb,0xbf])` (not a utf8 string); secrets asserted on key name.
- [ ] No `src/` changes; consumes S1's arms + S1-of-T1's throw sites read-only.
- [ ] No new `src/**/*.ts` (coverage-safe); test placed in `tests/integration/`.

### Documentation & Deployment
- [ ] DOCS: none (rendering format unchanged — only the stack trace is suppressed; no docs/*.md).
- [ ] No new env vars.
- [ ] Commit message notes: BUG-002 step 4 (the rendering tests); consumes S1's clean arms + S1-of-T1's
      HackConfigError; the tsx+src/index.ts subprocess strategy (not dist/index.js); the
      GREEN-once-S1-lands sequencing; the 4 cases (range/secrets/BOM/NotARepository contrast); disjointness
      from hack-config.test.ts (logic) + repo-root-acceptance.test.ts (§9.8).

---

## Anti-Patterns to Avoid

- ❌ Don't use `dist/index.js` (the auth-preflight variant). Use `tsx` + absolute `src/index.ts` (the
      repo-root-acceptance variant the item description cites) — no build dependency, no describe.skip flakiness.
- ❌ Don't forget the `PRD.md` in each repo case. `--prd` defaults to `./PRD.md` and parseCLIArgs
      existsSync-checks it BEFORE main() reaches loadHackConfig. Without PRD.md you get "PRD file not
      found" (a different path), not the .hack validation error. (The non-repo case (c) needs no PRD.md —
      the preAction hook throws first.)
- ❌ Don't write the BOM as a utf8 string — it re-encodes the BOM away. Use `Buffer.from([0xef,0xbb,0xbf])`
      + valid TOML bytes (Buffer.concat). Mirror hack-config.test.ts:77-78.
- ❌ Don't assert on the secret VALUE (`sk-…`) — it's never echoed. The secrets check fires on the KEY
      NAME. Assert on `zai_api_key` (which IS in the message).
- ❌ Don't use a bare `'at '` substring for stack detection — too loose. Use `/\n\s*at /` (the Node
      stack-frame format) PLUS `not.toContain('Fatal error in main()')` (the default-arm preamble).
- ❌ Don't weaken `assertCleanRender` to force green. If cases (a)/(b)/(b′) show a stack trace, S1's
      arms are absent/mis-placed — confirm P1.M2T2.S1 + P1.M2.T1.S1 landed first. The RED is the test
      driving the fix; don't paper over it.
- ❌ Don't edit `src/index.ts` (S1 owns the arms), `src/config/hack-config.ts` (S1-of-T1 owns throw
      sites), `src/config/types.ts` (S1-of-T1 owns HackConfigError), any other test file, or any
      `docs/*.md` (DOCS: none).
- ❌ Don't duplicate the validation-LOGIC tests from `hack-config.test.ts`. This task tests RENDERING
      (subprocess, no stack); that file tests logic (in-process `toThrow`). Disjoint.
- ❌ Don't omit the `spawnSync` timeout. Set `timeout: 30_000` or a hung subprocess stalls the suite.
- ❌ Don't rely solely on a global `afterEach` for tmpdir cleanup — use `try { ... } finally { rmSync(...) }`
      per case so a mid-case assertion throw still cleans up. (Mirror repo-root-acceptance.)
- ❌ Don't run the full `npm run test:run` as the gate (orthogonal pre-existing failures per bugfix docs).
      Gate = typecheck + lint + format:check + `npx vitest run tests/integration/config-error-rendering.test.ts`.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, self-contained test file with no production-code change and no new coverage
obligation. The subprocess harness (`tsxBin`/`absIndex`/`runCli`/`makeRepo`/`assertCleanRender`) is copied
verbatim from the already-green `repo-root-acceptance.test.ts` (the file the contract explicitly cites).
All four `it` cases are written out verbatim with the verified message substrings (range `poll_ms`/`out of
range`, secrets `Secret`/`zai_api_key`, BOM `BOM`, contrast `No .git entry found`), the verbatim
hack-config throw-site messages (research §4), and the shared `assertCleanRender` helper encoding the
BUG-002 contract (exit 1 + ❌ + no `/\n\s*at /` + no `Fatal error in main()`). The non-obvious traps are
documented with proof: main()-not-exported → subprocess-only (research §2); PRD.md required per repo case
(parseCLIArgs existsSync trap, research §5); BOM via Buffer (research §4(b′)); secret value never echoed
(research §4(b)); tsx not dist (research §1); GREEN-once-S1-lands sequencing (research §10). The work is
file-disjoint from S1 (index.ts), S1-of-T1 (types.ts/hack-config.ts), repo-root-acceptance, auth-preflight,
and hack-config.test.ts — only a new test file is created. Residual risks: (a) implementing before S1/S1-of-T1
land → .hack cases RED with a stack (caught immediately; resolved by the sequencing, and case (c) is GREEN
regardless to prove the harness works); (b) a prettier nit (auto-fixed via `npm run fix`); (c) `git` absent
in the environment (already a CI dependency via repo-root-acceptance). No runtime/network/LLM unknowns —
the test is pure subprocess + tmpdir + stderr-string assertions.