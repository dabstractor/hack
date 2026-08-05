# Catch-arm wiring — exact edit map, test pattern, scope boundaries

Authoritative reference for P1.M2.T2.S1. Pins the exact insertion site, the
import extension, the two error classes, the testability model (subprocess
spawn — main() is NOT exported), and the scope boundaries (S1-of-T1 owns
types.ts/hack-config.ts; this item owns ONLY index.ts).

## 1. The ACTUAL main().catch() block (src/index.ts:395-413)

> NOTE: the work-item contract cites lines 404-423 / default@421 — those are
> STALE. The CURRENT block (verified by reading src/index.ts) is at 395-413:

```ts
void main()
  .then(code => {
    if (typeof code === 'number') {
      process.exitCode = code;
    }
  })
  .catch((error: unknown) => {                                   // 395
    if (error instanceof AuthPreflightError) {                    // 396
      console.error(`\n❌ ${error.message}`);                       // 397
      process.exit(1);                                             // 398
    }
    if (error instanceof HarnessProviderMismatchError) {          // 400
      console.error(`\n❌ ${error.message}`);                       // 401
      process.exit(1);                                             // 402
    }
    if (error instanceof UnsupportedHarnessError) {               // 404
      console.error(`\n❌ ${error.message}`);                       // 405
      process.exit(1);                                             // 406
    }
    if (error instanceof NotARepositoryError) {                   // 408
      console.error(`\n❌ ${error.message}`);                       // 409
      process.exit(1);                                             // 410
    }
    // ◀◀◀ INSERT the 2 new arms HERE (after NotARepositoryError, before the default)
    console.error('\n❌ Fatal error in main():', error);           // 412 — DEFAULT (full stack)
    process.exit(1);                                               // 413
  });
```

**Insertion = two new `if` arms immediately before the default arm (line 412).**
Order among the clean arms does not matter (each exits on match). Verbatim:
```ts
    if (error instanceof HackConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.7.7: actionable one-line startup error (no stack)
      process.exit(1);
    }
    if (error instanceof EnvironmentValidationError) {
      console.error(`\n❌ ${error.message}`); // §9.2.7: missing-env actionable one-liner (no stack)
      process.exit(1);
    }
```

## 2. The import extension (src/index.ts:45-49)

Current import block:
```ts
import {
  AuthPreflightError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
```
**NEITHER HackConfigError NOR EnvironmentValidationError is currently imported**
(the contract's "EnvironmentValidationError may already be [imported]" was
speculative — verified: it is NOT). ADD BOTH to the SAME block (alphabetical,
prettier-sorted):
```ts
import {
  AuthPreflightError,
  EnvironmentValidationError,
  HackConfigError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
```
(`NotARepositoryError` comes from a DIFFERENT module — `./utils/repo-root.js`
(line 59) — and is already imported; do not touch it.)

## 3. The two error classes (consume, do not define)

- **`HackConfigError`** — PROVIDED BY P1.M2.T1.S1 (the parallel previous item).
  Added to `src/config/types.ts` (after AuthPreflightError). Message-only ctor:
  `export class HackConfigError extends Error { constructor(message: string) { super(message); this.name = 'HackConfigError'; } }`.
  S1-of-T1 also converts the 9 throw sites in `hack-config.ts` to it. **This
  item assumes S1-of-T1 has landed** (HackConfigError exported from types.ts);
  the import + instanceof arm then works. `error.message` is the actionable
  `.hack` message (BOM/type/range/enum/secrets/parse).
- **`EnvironmentValidationError`** — ALREADY in `src/config/types.ts:79`.
  `export class EnvironmentValidationError extends Error { readonly missing: string[]; constructor(missing: string[]) { super(\`Missing required environment variables: ${missing.join(', ')}\`); this.name = 'EnvironmentValidationError'; this.missing = missing; } }`.
  Thrown by `validateEnvironment`. `error.message` is the actionable
  "Missing required environment variables: …" line.

Both extend `Error`, so `error.message` works and each `instanceof` arm is precise.
Neither has any side-effect beyond rendering + exit. The ONLY behavioral change
of this item: a HackConfigError / EnvironmentValidationError that PREVIOUSLY hit
the DEFAULT arm (full `Error` dump + stack trace) now hits the clean arm (single
`❌ <message>` line, no stack). That is exactly the BUG-002 fix.

## 4. Coverage is a REGRESSION FLOOR (NOT 100%) — S1 lands cleanly

`vitest.config.ts` thresholds (lines 55-57): `statements: 89, branches: 90`
with the comment "deliberately set BELOW current actual coverage (~90%) … as
coverage improves." This is a FLOOR, not a 100% mandate. So adding two new `if`
branches in main().catch() does NOT drop coverage below the gate even before
S2's tests land. **S2 (P1.M2.T2.S2) writes the clean-rendering verification
tests; S1 (this item) only wires the arms + imports.** Do NOT write tests here
(that's S2's deliverable); do NOT block S1 on coverage.

## 5. Testability model — main() is NOT exported; verify via subprocess spawn

`main()` is NOT exported from `index.ts`, and `index.ts` AUTO-RUNS
`void main().catch(...)` on import. So the catch arms CANNOT be unit-tested
in-process by calling `main()` (importing index.ts runs the whole bootstrap).
The ESTABLISHED pattern (from `tests/unit/config/auth-preflight.test.ts:222-290`)
is **end-to-end subprocess spawning** against the BUILT `dist/index.js`:

```ts
const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip('HackConfigError renders cleanly (exit 1, single message, no stack)', () => {
  it('prints ❌ <message> with no stack trace for a range error', () => {
    // write a .hack with [tasks_lock]\npoll_ms = -5 in a tmp git repo
    const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], { encoding:'utf8', timeout:20_000, env });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('❌');
    expect(res.stderr).toContain('out of range');
    expect(res.stderr).not.toMatch(/\n\s*at /);   // NO stack trace
  });
});
```
- `describe.skip` when `dist/index.js` is absent (no build).
- Assert: `res.status === 1` + `res.stderr` contains the `❌` message +
  `res.stderr` does NOT match a stack-trace line (`/\n\s*at /`).
- For EnvironmentValidationError: scrub the env (no creds/vars) so
  `validateEnvironment` throws → assert the same clean render.

**This is S2's deliverable (P1.M2.T2.S2).** This item (S1-of-T2) only wires the
arms; it references the pattern so the implementing agent confirms the change is
OBSERVABLE end-to-end (manual smoke test below) and so S2 has the exact recipe.

## 6. Manual smoke test (no build required — run via tsx)

```bash
# In a git repo with a valid PRD.md, create a malformed .hack, then:
echo -e '[tasks_lock]\npoll_ms = -5' > .hack
npx tsx src/index.ts --dry-run --prd PRD.md 2>&1 | tail -5
# EXPECTED (after this fix):  ❌ [tasks_lock] poll_ms in <path>/.hack: -5 is out of range (...)
#   — a SINGLE ❌ line, NO "    at validateFieldValue (...)" stack frames.
# BEFORE this fix:            ❌ Fatal error in main(): Error: [tasks_lock] poll_ms ... + 4 stack lines.
```

## 7. Scope boundaries (disjointness)

- **This item edits ONLY `src/index.ts`** (the import block + the 2 new catch
  arms). Nothing else.
- **P1.M2.T1.S1 (parallel previous)** edits `src/config/types.ts` (defines
  HackConfigError) + `src/config/hack-config.ts` (9 throw conversions + JSDoc).
  DIFFERENT files → no merge conflict. This item CONSUMES S1-of-T1's
  `HackConfigError` export (assume it landed as specified).
- **P1.M2.T2.S2 (next sibling)** writes the clean-rendering subprocess tests.
  This item references the test recipe but does NOT write the tests.
- **DO NOT touch**: types.ts, hack-config.ts, any test file, config.ts, any
  docs/*.md (DOCS: none — rendering format is unchanged, same ❌ prefix/message;
  only the stack trace is suppressed). No JSDoc edit needed in index.ts (the
  block-level comment above main().catch() already describes "renders known
  startup errors cleanly" — the 2 new arms fit that description; an optional
  one-line comment per arm is the only doc artifact).

## 8. Why NOT to also touch the config subcommand catch (src/cli/commands/config.ts)

The architecture doc (Step 5) flags an OPTIONAL follow-up: have the config
subcommand's own catch detect `instanceof HackConfigError` and render cleanly.
This is OUT OF SCOPE for this item — (a) `ConfigCommand.execute()` has its own
inner catch (config.ts:~155) that already renders config validation errors via
`console.error(chalk.red(...))`, and (b) after BUG-001's preAction hook,
`NotARepositoryError` no longer reaches the config handler. The BUG-002 fix is
satisfied by the main().catch() arms alone (subcommand paths propagate through
program.parse() → main() → main().catch()). Flag the config-handler follow-up in
the commit message; do NOT implement it (scope creep).