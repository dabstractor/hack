# Research — P1.M2.T2.S2: Tests verifying clean rendering (no stack trace) for config validation errors

Load-bearing facts for the PRP. Every claim is verified against the current
`hacky-hack` source (the `hack` CLI lives in this repo: `src/index.ts`,
`src/cli/index.ts`, `src/config/hack-config.ts`, `src/config/types.ts`).

---

## 1. The subprocess pattern to mirror (the contract's recommended file)

The work item says: _"The subprocess pattern from `tests/integration/repo-root-acceptance.test.ts`
(spawnSync tsx + src/index.ts with controlled cwd) is ideal for end-to-end rendering tests."_

Verified structure of that file (read in full):

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// LOCAL tsx binary + ABSOLUTE script path (no build needed; robust to cwd).
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

const runCli = (args: string[], cwd: string) => {
  const result = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), '<prefix>-'));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) { rmSync(repo, { recursive: true, force: true }); throw new Error('git init failed'); }
  return repo;
};
```

**Use THIS pattern (tsx + src/index.ts), NOT the auth-preflight dist/index.js pattern.** The
auth-preflight.test.ts variant spawns `dist/index.js` (built) with `describe.skip` when the build is
absent. The repo-root-acceptance variant spawns `tsx src/index.ts` directly — **no build dependency**,
always runs, and is the file the contract explicitly points at. (Both are valid; tsx is the robust
choice for this test.)

## 2. main() is NOT exported → subprocess is the ONLY way to test the catch arms

`src/index.ts` ends with `void main().then(...).catch(...)` — it auto-runs at import. `main()` is
not exported, so you cannot unit-test the catch arms in-process (importing index.ts runs the whole
bootstrap). The arms are verified **end-to-end via subprocess** (spawnSync tsx + src/index.ts). This
is identical to how `repo-root-acceptance.test.ts` (case d) and `auth-preflight.test.ts` (acceptance a)
verify their respective clean arms. See S1 PRP research §5.

## 3. The exact main().catch() block (src/index.ts:387-413) + what S1 adds

Verified current block (lines 387-413):

```ts
void main()
  .then(code => { if (typeof code === 'number') process.exitCode = code; })
  .catch((error: unknown) => {
    if (error instanceof AuthPreflightError)      { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof HarnessProviderMismatchError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof UnsupportedHarnessError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof NotARepositoryError)     { console.error(`\n❌ ${error.message}`); process.exit(1); }
    console.error('\n❌ Fatal error in main():', error);   // ← DEFAULT arm (full object + stack)
    process.exit(1);
  });
```

**S1 (P1.M2.T2.S1, parallel sibling — assumed landed) inserts two new arms BEFORE the default arm:**
`if (error instanceof HackConfigError)` and `if (error instanceof EnvironmentValidationError)`,
each `console.error(\`\n❌ ${error.message}\`); process.exit(1);`. **This test consumes those arms.**
Before S1 lands, the .hack cases render through the DEFAULT arm → stack trace (RED by design). After
S1 lands, they render cleanly (GREEN). The NotARepositoryError contrast case is GREEN regardless
(existing arm, unchanged by S1).

**The two rendering forms — CRITICAL distinction:**
- Clean arms: `console.error(\`\n❌ ${error.message}\`)` — single-arg template literal → **NO stack**.
- Default arm: `console.error('\n❌ Fatal error in main():', error)` — two-arg → dumps the Error
  object → **full stack trace** into internals.

The test asserts which form fired: clean (❌ + message, no stack) vs default (❌ Fatal error in
main(): + stack). That IS the BUG-002 contract.

## 4. The exact error messages to assert (verified in src/config/hack-config.ts)

All three now throw `HackConfigError` (S1-of-T1 P1.M2.T1.S1 converted the 9 throw sites; verified
the `import { HackConfigError } from './types.js'` at hack-config.ts:12 + `throw new HackConfigError`
at lines 84, 91, 775, 817, 822, 828, 834, 840-ish).

**(a) Range error** — `[tasks_lock]\npoll_ms = -5` (hack-config.ts:832-836):
```
[tasks_lock] poll_ms in <repoRoot>/.hack: -5 is out of range (expected integer in [1, +∞]).
```
Assert substrings: `❌`, `poll_ms`, `out of range`. (`<repoRoot>` is an absolute realpath — assert
with `.toContain('.hack')` or just rely on `poll_ms`/`out of range`.)

**(b) Secrets error** — `[auth]\nzai_api_key = "sk-..."` (hack-config.ts:775-779):
```
Secret-bearing key [auth] zai_api_key is not permitted in the committable file <repoRoot>/.hack (PRD §9.7.6). Move it to .hack.local (gitignored) or an environment variable, then retry.
```
Assert substrings: `❌`, `Secret` (or `secret`), `zai_api_key`. NOTE: the secret value (`sk-...`) is
NOT echoed (the secrets check fires on the KEY NAME before any value echoing — hack-config.ts:744-747).
So do NOT assert on the `sk-...` value; assert on `zai_api_key` (the key name IS in the message).

**(b') BOM error** — raw bytes `0xEF 0xBB 0xBF` + valid TOML (hack-config.ts:84-86):
```
BOM detected in <repoRoot>/.hack; remove it and re-save as UTF-8 without BOM
```
Assert substrings: `❌`, `BOM`. **Must write via `Buffer.from([0xEF, 0xBB, 0xBF, ...])`** — a utf8
string re-encodes the BOM away (hack-config.test.ts:77-78 documents this).

**(c) NotARepositoryError contrast** (regression guard — src/utils/repo-root.ts):
```
No .git entry found ... --repo-root ...
```
Assert substrings: `❌`, `No .git entry found`. This proves S1's two new arms (inserted before the
default) did NOT shadow the existing NotARepositoryError arm.

## 5. The execution order — why PRD.md + a valid repo are required to reach loadHackConfig

`src/index.ts` `main()` order (verified):
1. `parseCLIArgs()` (line 123) — Commander `program.parse()`. The **preAction hook** (BUG-001 fix,
   src/cli/index.ts) runs `bootstrapRepoRoot()` → `resolveRepositoryRoot()` + `process.chdir(repoRoot)`
   for EVERY command. **No .git ancestor → throws `NotARepositoryError`** (reaches the dedicated arm;
   this is contrast case c). After chdir, `cwd === repoRoot`.
2. parseCLIArgs also does an **existsSync check on `--prd`** (the "existsSync trap", per
   auth-preflight.test.ts comment) → throws "PRD file not found" if `./PRD.md` is missing. `--prd`
   **defaults to `'./PRD.md'`** (cli/index.ts:339).
3. `loadHackConfig(repoRoot)` (line 164) — **THROWS `HackConfigError`** for a bad `.hack`. This runs
   BEFORE `configureEnvironment()` and BEFORE the `--dry-run` early-return (line 189).

**Implication for test setup:** to reach `loadHackConfig` (and trigger a .hack validation error), the
subprocess cwd must (1) be inside a real git repo (so the preAction hook succeeds + chdirs) AND (2)
contain a `PRD.md` (so parseCLIArgs' existsSync check passes). The contract confirms: _"create a git
repo tmpdir with PRD.md + .hack"_. So every repo-tmpdir case writes BOTH `PRD.md` (minimal, e.g.
`'# PRD\n'`) AND the offending `.hack`.

The contract's command `hack --dry-run` → subprocess `['--dry-run']` (uses the `./PRD.md` default).
The dry-run flag is credential-free and irrelevant to the throw (loadHackConfig fires first), but it
matches the contract's reproduction exactly and avoids any credential preflight.

## 6. Stack-trace detection (realizing the contract's "no 'at '")

The contract says: _"assert stderr does NOT contain 'at ' (stack trace marker)"_. A bare `at `
substring is too loose (could false-match). The precise form of "no stack trace" is the **Node stack
frame format**: frames look like `\n    at Function.foo (...)` — i.e. a newline, leading whitespace,
`at `, then a word char. Assert:

```ts
expect(stderr).not.toMatch(/\n\s*at /);          // no Node stack frames
expect(stderr).not.toContain('Fatal error in main()');  // not the default arm's preamble
```

Both together = "a clean arm fired" (vs the default arm's two-arg dump). This is the robust
realization of the contract's intent. (repo-root-acceptance case d uses the same
`not.toContain('Fatal error in main()')` check.)

## 7. Disjointness — what this test does NOT duplicate

- **`tests/unit/config/hack-config.test.ts`** — covers the validation **LOGIC**: what throws and the
  message content, via in-process `expect(() => loadHackConfig(repoRoot)).toThrow(/poll_ms/)`. This
  task covers the **RENDERING**: that the thrown error reaches a clean arm and prints no stack trace,
  via subprocess. Disjoint concern, disjoint mechanism (in-process vs subprocess). No overlap.
- **`tests/integration/repo-root-acceptance.test.ts`** — covers §9.8 repo-root resolution; its case d
  already asserts the NotARepositoryError clean render. My NotARepositoryError case (c) is a LIGHTWEIGHT
  regression guard (S1 didn't shadow the arm), not a re-test of §9.8 traversal. Minimal assertions only.
- **`tests/unit/config/auth-preflight.test.ts`** — covers the AuthPreflightError clean arm via
  dist/index.js subprocess. Disjoint error class.

## 8. Placement: NEW file `tests/integration/config-error-rendering.test.ts`

- Not in `repo-root-acceptance.test.ts` — that file is scoped to §9.8; BUG-002 rendering is §9.7.7.
- Not in `hack-config.test.ts` (unit/) — that's in-process validation logic; rendering is subprocess.
- Not in `auth-preflight.test.ts` — scoped to AuthPreflightError.
- A NEW integration file groups all 4 cases (range, secrets, BOM, NotARepository contrast) under one
  BUG-002 describe, mirrors the repo-root-acceptance subprocess helpers, and is merge-safe vs every
  sibling.

## 9. Coverage posture

`vitest.config.ts` thresholds are a FLOOR (~89 statements / 90 branches — verified by S1 PRP research
§4), NOT 100%. This task is test-only (new integration file in `tests/**`, excluded from coverage
measurement). It creates **no new `src/**/*.ts`** → **no coverage obligation**. Adding tests can only
raise coverage. Same posture as S1.

## 10. Dependencies (sequencing)

- **S1 (P1.M2.T2.S1)** must land first — it adds the `HackConfigError` + `EnvironmentValidationError`
  clean arms to main().catch(). This test is GREEN once S1 lands; before that, the .hack cases render
  through the default arm → stack trace (RED by design — the test drives the fix).
- **S1-of-T1 (P1.M2.T1.S1)** must land first — it defines `HackConfigError` (types.ts:246, VERIFIED
  present) and converts the 9 throw sites (verified: `throw new HackConfigError` at hack-config.ts
  84/91/775/817/822/828/834). Without it, the throw sites emit plain `Error` → default arm → stack.
- Both are the intended parallel-pair sequencing. The NotARepositoryError contrast case (c) is GREEN
  regardless of S1 (existing arm).