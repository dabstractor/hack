# Research — `HackConfigError` class + 9 throw-site conversion

Findings anchoring P1.M2.T1.S1 (bugfix 001, BUG-002 step 1+2+4). All line numbers
verified against the working tree.

## 1. The typed-error class convention (types.ts) — the template

`src/config/types.ts` has 4 typed error classes, all following the identical pattern:
```ts
export class FooError extends Error {
  constructor(...) { super(message); this.name = 'FooError'; … }
}
```
- `EnvironmentValidationError` (79) — `this.name='EnvironmentValidationError'`
- `UnsupportedHarnessError` (142) — `this.name='UnsupportedHarnessError'`
- `HarnessProviderMismatchError` (175) — `this.name='HarnessProviderMismatchError'`
- `AuthPreflightError` (219-233) — `this.name='AuthPreflightError'` (+ readonly fields)

➡️ Add `HackConfigError` in this same cluster, right after `AuthPreflightError`'s closing
brace (line 233), before the `buildPreflightMessage` helper (235). It is the simplest of
the five (message-only, no extra fields):
```ts
export class HackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HackConfigError';
  }
}
```

## 2. The 9 throw sites in hack-config.ts (verified — exactly 9)

`grep -n "throw new Error" src/config/hack-config.ts` → 9 sites:

| Line | Function | Trigger | Message anchor |
| --- | --- | --- | --- |
| 83 | `parseHackFile` | BOM (0xEF 0xBB 0xBF) | `BOM detected in ${filePath}; remove it…` |
| 90 | `parseHackFile` | TOML parse (`error instanceof TomlError`) | `Failed to parse ${filePath}: … (line …, column …)` |
| 774 | `validateHackTier` | Secrets policy (§9.7.6) | `Secret-bearing key [${section}] ${key} is not permitted…` |
| 815 | `validateFieldValue` | boolean type mismatch | `…: expected boolean, got …` |
| 820 | `validateFieldValue` | string type mismatch | `…: expected string, got …` |
| 826 | `validateFieldValue` | int type mismatch | `…: expected integer, got …` |
| 832 | `validateFieldValue` | int range (below min) | `…: ${value} is out of range (…).` |
| 837 | `validateFieldValue` | int range (above max) | `…: ${value} is out of range (…).` |
| 847 | `validateFieldValue` | enum not accepted | `… is not one of the accepted values […]` |

**Conversion = mechanical:** `throw new Error(X)` → `throw new HackConfigError(X)` with the
message string `X` **IDENTICAL** (the messages are already correct/actionable — do NOT
reword). Add `import { HackConfigError } from './types.js';` after the `./constants.js`
import (hack-config.ts:11).

### 2a. CRITICAL — line 95 `throw error;` is a RETHROW, NOT converted
`parseHackFile`'s catch (89-95) ends with `throw error; // BOM Error / ENOENT / etc. —
already carry the path; rethrow as-is`. This rethrows the ALREADY-thrown error (now a
HackConfigError for the BOM case at 83). It is NOT `throw new Error` and is NOT in the
9-site list. **Leave line 95 alone.** Converting it would be wrong (it's a passthrough for
ENOENT/other errors too). After the change: BOM @83 throws HackConfigError → catch → not a
TomlError → `throw error;` @95 rethrows the HackConfigError as-is. Correct.

## 3. The JSDoc to update (validateFieldValue, hack-config.ts:799-806)

Current `@remarks` (801-806):
```
 * @remarks A plain `throw new Error` reaches `main().catch()`'s default arm (index.ts:401) →
 * exit 1. The message names the file + section + key + offending value + expected
 * type/range (for int) / accepted values (for enum). TOML int = JS number +
 * `Number.isInteger`; bool = JS boolean; string = JS string. A TOML `poll_ms = true` is a
 * TYPE mismatch (boolean where int expected), not a range error.
```
Update the FIRST sentence (the "default arm" claim) to reference `HackConfigError` + the
dedicated clean arm; keep the rest (message-content description) intact:
```
 * @remarks A `throw new HackConfigError` reaches `main().catch()`'s dedicated `HackConfigError`
 * arm → a clean `❌ <message>` line + exit 1 (mirroring NotARepositoryError/AuthPreflightError;
 * PRD §9.7.7/§9.2.7). The message names the file + section + key + offending value + expected
 * type/range (for int) / accepted values (for enum). TOML int = JS number + `Number.isInteger`;
 * bool = JS boolean; string = JS string. A TOML `poll_ms = true` is a TYPE mismatch (boolean
 * where int expected), not a range error.
```
Drop the brittle `index.ts:401` line ref (the dedicated arm's exact line is S2's to place).

### 3a. The dedicated arm is S2's deliverable, NOT S1's
`main().catch()` (index.ts:395-408+) has dedicated arms for `AuthPreflightError` (396),
`HarnessProviderMismatchError` (400), `UnsupportedHarnessError` (404), `NotARepositoryError`
(408), then the DEFAULT arm (~421, `console.error('\n❌ Fatal error in main():', error)` +
stack trace). **P1.M2.T2.S1** adds the `instanceof HackConfigError` (+ `EnvironmentValidationError`)
arm BEFORE the default arm. S1 only updates the JSDoc in ANTICIPATION of S2's arm. **S1 MUST
NOT edit index.ts** (S2's file). The JSDoc describes the post-S2 contract.

### 3b. Optional consistency: validateHackTier @remarks (734-736)
`validateHackTier`'s `@remarks` (734-736) ALSO says "main().catch()'s default arm → exit 1"
(re the secrets throw @774). After S1 it's stale (the secrets throw is now HackConfigError →
dedicated arm). The item names ONLY validateFieldValue, but updating validateHackTier's
@remarks for consistency avoids a stale comment. Same file, same one-sentence edit, low risk.
Recommend doing both; validateFieldValue is the REQUIRED one.

## 4. Test impact — SAFE (verified)

`grep` of the 4 hack-config-touching test files (`tests/unit/config/hack-config.test.ts`,
`tests/unit/cli/commands/config.test.ts`, `tests/unit/cli/apply-hack-cli-defaults.test.ts`,
`tests/integration/config/hack-config-acceptance.test.ts`):
- ALL assertions are **message-regex / message-substring** matches:
  - `expect(() => parseHackFile(path)).toThrow(/BOM/)` (hack-config.test.ts:89)
  - `expect(() => loadHackConfig(repoRoot)).toThrow(/BOM/)` (410)
  - `expect(() => loadHackConfig(repoRoot)).toThrow(/out of range/)` (756)
- `toThrow(/regex/)` matches against `error.message`. HackConfigError extends Error and the
  message is IDENTICAL → **all these still pass.**
- NO test asserts `error.constructor.name === 'Error'` or `not.toBeInstanceOf(HackConfigError)`.
  The only `toBeInstanceOf(Error)` hits (harness.test.ts:91, harness-provider-compat.test.ts:129)
  are for UNRELATED harness errors — and `toBeInstanceOf(Error)` is TRUE for subclasses anyway.
- `hack config validate` CLI path (config.ts:489-528) uses `e instanceof Error ? e.message :
  String(e)` → works identically (HackConfigError is an Error with the same `.message`).
  Architecture doc §Risks #2 confirms. No change needed there.

➡️ The conversion is behavior-preserving for every existing test. No test edits required.

## 5. Coverage — preserved (types.ts stays 100%)

`types.ts` is in `src/` ⇒ 100% coverage globally enforced. The new `HackConfigError`
constructor (super + `this.name=`) is exercised TRANSITIVELY: `hack-config.test.ts`'s BOM
test (line 89, `parseHackFile` → throws HackConfigError) and the out-of-range test (756,
`loadHackConfig` → validateFieldValue → throws HackConfigError) both instantiate it. v8
coverage tracks `types.ts` whenever `hack-config.ts` (which imports it) runs. So coverage is
preserved with NO new test required. (Optional: a 1-line `expect(new
HackConfigError('x')).toBeInstanceOf(Error)` in a types test — not required for green.)

## 6. Scope boundaries

- **S1 = `src/config/types.ts` (add class) + `src/config/hack-config.ts` (import + 9
  conversions + JSDoc).** That's it.
- **P1.M2.T2.S1** adds the dedicated `HackConfigError` (+ `EnvironmentValidationError`) arm
  to `src/index.ts` `main().catch()` — S1 does NOT touch index.ts.
- **P1.M2.T2.S2** writes the clean-rendering tests — S1 does not write them.
- **File-disjoint from the parallel P1.M1.T2.S1** (test-only BUG-001 file). Zero overlap.
- DOCS: Mode A — the validateFieldValue JSDoc update is the only doc artifact (rides with
  the work). No `docs/*.md`.

## 7. Validation

- `npm run typecheck` (tsc -p tsconfig.build.json, src/) — clean. HackConfigError extends
  Error, so `throw new HackConfigError(string)` typechecks everywhere `throw new Error(string)` did.
- `npm run lint && npm run format:check` — clean.
- `npx vitest run tests/unit/config/hack-config.test.ts` — GREEN (message-regex assertions
  unchanged). Target this file (it exercises the conversions + the types.ts constructor).
- `npx vitest run tests/unit/config/hack-config.test.ts --coverage` — types.ts + hack-config.ts
  stay 100%.
- Do NOT run the full `npm run test:run` (orthogonal pre-existing failures per the bugfix
  architecture docs — not S1's concern). Gate = typecheck + lint + format:check + the
  targeted hack-config.test.ts.