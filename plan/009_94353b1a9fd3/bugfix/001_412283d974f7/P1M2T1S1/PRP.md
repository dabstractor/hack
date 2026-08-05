# PRP — P1.M2.T1.S1: Define `HackConfigError` + convert 9 throw sites + update doc comment

> Bugfix 001, **BUG-002 (Minor)** step 1+2+4. `.hack` validation errors (BOM, TOML parse,
> secrets policy, type/range/enum) are thrown as plain `Error` and render through
> `main().catch()`'s DEFAULT arm with a full stack trace — inconsistent with the clean
> single-line arms for typed errors. **S1** introduces a typed `HackConfigError` (mirroring the
> 4 existing typed-error classes in `types.ts`) and converts the 9 throw sites in
> `hack-config.ts` (messages UNCHANGED) + updates the `validateFieldValue` JSDoc. The dedicated
> `main().catch()` arm that RENDERERS this cleanly is **S2 (P1.M2.T2.S1)** — S1 does not touch
> `index.ts`; it only updates the JSDoc in anticipation. Messages are byte-identical, so every
> existing test (message-regex `toThrow`) stays green.

---

## Goal

**Feature Goal**: Make all `.hack` validation failures throw a typed `HackConfigError` (instead
of a plain `Error`) so downstream catch arms can render them cleanly via `instanceof
HackConfigError` — WITHOUT changing any error message, signature, or control flow. This is the
typed-error foundation S2's clean `main().catch()` arm consumes.

**Deliverable**:
1. **`src/config/types.ts`** — EDIT: add `export class HackConfigError extends Error` (the
   message-only variant, `this.name = 'HackConfigError'`) in the typed-error cluster, right
   after `AuthPreflightError` (line 233).
2. **`src/config/hack-config.ts`** — EDIT: (a) add `import { HackConfigError } from './types.js';`
   after the `./constants.js` import (line 11); (b) convert the 9 `throw new Error(...)` sites
   (lines 83, 90, 774, 815, 820, 826, 832, 837, 847) to `throw new HackConfigError(...)` with
   IDENTICAL message strings; (c) update the `validateFieldValue` `@remarks` JSDoc (799-806) to
   reference `HackConfigError` + the dedicated clean arm.
3. **(No test changes required)** — existing `toThrow(/message/)` assertions stay green
   (HackConfigError extends Error; messages unchanged). Coverage of `types.ts` stays 100% via
   transitive instantiation.

**Success Definition**:
- All 9 `throw new Error(...)` in `hack-config.ts` are `throw new HackConfigError(...)`, messages byte-identical.
- `new HackConfigError('x') instanceof Error` is `true`; `.name === 'HackConfigError'`; `.message === 'x'`.
- Line 95 (`throw error;`) is UNCHANGED (it's a rethrow, not a `throw new Error`).
- `validateFieldValue`'s `@remarks` describes the `HackConfigError` → dedicated-arm contract.
- `npm run typecheck && npm run lint && npm run format:check` clean; `hack-config.test.ts` GREEN;
  `types.ts` + `hack-config.ts` at 100% coverage.

---

## Why

- **Foundation for clean rendering (BUG-002).** The messages are already correct/actionable; the
  bug is that plain `Error` hits the DEFAULT catch arm (full stack trace). A typed `HackConfigError`
  lets S2 add a dedicated `instanceof HackConfigError` arm that prints one `❌ <message>` line
  (mirroring `NotARepositoryError`/`AuthPreflightError`/`HarnessProviderMismatchError`/
  `UnsupportedHarnessError`), per PRD §9.7.7/§9.2.7's fail-fast actionable-startup-error philosophy.
- **Matches the established typed-error convention.** `types.ts` already hosts 4 such classes;
  `HackConfigError` is the natural 5th (it's the config-error home). S1 follows the exact pattern.
- **Behavior-preserving.** Because the messages are unchanged and `HackConfigError extends Error`,
  NO existing test or caller breaks. `hack config validate`'s `e instanceof Error ? e.message :
  String(e)` (config.ts:489-528) works identically. This makes S1 a pure, safe refactor that
  unblocks S2 without coupling to it.
- **Standalone & scoped.** S1 = `types.ts` + `hack-config.ts` only. It does NOT edit `index.ts`
  (S2's arm), does NOT write clean-rendering tests (S2.S2), and is file-disjoint from the parallel
  P1.M1.T2.S1 (BUG-001 test file).
- **Out of scope (hard boundary):** the dedicated `main().catch()` arm in `src/index.ts` (S2 =
  P1.M2.T2.S1), the clean-rendering tests (P1.M2.T2.S2), the BUG-003 relational constraint
  (P1.M3.T1.S1), any `docs/*.md` (DOCS: Mode A — JSDoc only), and rewording any error message.

---

## What

### User-visible behavior
None. Until S2 adds the catch arm, the runtime rendering is UNCHANGED (HackConfigError still hits
the default arm the same way plain Error did — same message, same stack). The visible improvement
(clean single-line render) lands in S2. S1 is the enabling typed-error refactor.

### Technical requirements (exact contract)

**`src/config/types.ts`** — add the class after `AuthPreflightError` (line 233), before
`buildPreflightMessage` (235):
```ts
/**
 * Error thrown when a `.hack` configuration file fails validation
 * (PRD §9.7.6/§9.7.7: BOM, TOML parse, secrets policy, type/range/enum).
 *
 * @remarks
 * Surfaced as a clean startup error via `main().catch()`'s dedicated `HackConfigError`
 * arm (P1.M2.T2.S1), mirroring {@link NotARepositoryError}/{@link AuthPreflightError}
 * (§9.2.7 fail-fast philosophy). Thrown by `parseHackFile`/`validateHackTier`/
 * `validateFieldValue` in `hack-config.ts`.
 */
export class HackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HackConfigError';
  }
}
```

**`src/config/hack-config.ts`** — import (after line 11 `import { PRP_API_KEY } from './constants.js';`):
```ts
import { HackConfigError } from './types.js';
```

**`src/config/hack-config.ts`** — 9 mechanical conversions (`throw new Error(` → `throw new HackConfigError(`,
message string UNCHANGED) at lines **83, 90, 774, 815, 820, 826, 832, 837, 847**. Each is a single-token
swap inside the `throw new ___(...)` — the entire message argument (template literal + `{ cause: error }`
on line 90) stays byte-identical. Line 90 keeps its `{ cause: error }` second arg (HackConfigError's
`super(message)` forwards to Error, which accepts `cause`).

**`src/config/hack-config.ts`** — `validateFieldValue` `@remarks` (lines 801-806), update the FIRST
sentence only (keep the message-content description):
```diff
- * @remarks A plain `throw new Error` reaches `main().catch()`'s default arm (index.ts:401) →
- * exit 1. The message names the file + section + key + offending value + expected
- * type/range (for int) / accepted values (for enum). TOML int = JS number +
- * `Number.isInteger`; bool = JS boolean; string = JS string. A TOML `poll_ms = true` is a
- * TYPE mismatch (boolean where int expected), not a range error.
+ * @remarks A `throw new HackConfigError` reaches `main().catch()`'s dedicated `HackConfigError`
+ * arm → a clean `❌ <message>` line + exit 1 (mirroring NotARepositoryError/AuthPreflightError;
+ * PRD §9.7.7/§9.2.7). The message names the file + section + key + offending value + expected
+ * type/range (for int) / accepted values (for enum). TOML int = JS number + `Number.isInteger`;
+ * bool = JS boolean; string = JS string. A TOML `poll_ms = true` is a TYPE mismatch (boolean
+ * where int expected), not a range error.
```
(Drop the brittle `index.ts:401` line ref — the dedicated arm's exact line is S2's to place.)

### Success Criteria
- [ ] `HackConfigError` exported from `types.ts` (message-only ctor, `this.name='HackConfigError'`).
- [ ] `hack-config.ts` imports `HackConfigError` from `./types.js`.
- [ ] All 9 sites (83, 90, 774, 815, 820, 826, 832, 837, 847) throw `HackConfigError`; messages UNCHANGED.
- [ ] Line 90 keeps its `{ cause: error }` second argument.
- [ ] Line 95 `throw error;` UNCHANGED (rethrow — not converted).
- [ ] `validateFieldValue` `@remarks` references `HackConfigError` + the dedicated arm.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `hack-config.test.ts` GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim class body, the exact 9 line numbers with per-site trigger + message anchor, the line-95
rethrow exclusion, the import insertion point, the exact JSDoc diff, the test-safety proof
(message-regex `toThrow` + `instanceof Error`-true-for-subclasses), the S2-arm boundary (S1 must
not edit index.ts), the coverage-preservation argument (transitive instantiation), and the
executable validation commands. See `research/hackconfig-error-class.md` for the grep evidence.

### Documentation & References
```yaml
# MUST READ — the BUG-002 fix strategy (what S1 implements: steps 1, 2, 4)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_002_fix_strategy.md
  section: "Step 1: Define HackConfigError" + "Step 2: Convert throw sites" + "Step 4: Update doc comment" + "Risks"
  why: The verbatim class body, the 9-site table, the JSDoc update, and the explicit test-safety
        guarantee (Risks #1/#2: instanceof Error / e.message / config validate path all unchanged).
  critical: Step 3 (the dedicated main().catch() arm in index.ts) is S2 (P1.M2.T2.S1), NOT S1.
        S1 updates the JSDoc in anticipation but MUST NOT edit index.ts.

# MUST READ — this subtask's research (the traps + exact edit map)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T1S1/research/hackconfig-error-class.md
  section: "2a. line 95 rethrow", "3a. dedicated arm is S2's", "4. Test impact — SAFE", "5. Coverage"
  why: The line-95-not-converted rule, the S1/S2 boundary, the message-regex test-safety proof,
        and the transitive-coverage argument.

# CONTEXT — S2 (the consumer) — read the CONTRACT, do NOT implement it
- file: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/tasks.json   # (or the S2 PRP when it exists)
  why: S2 (P1.M2.T2.S1) adds `if (error instanceof HackConfigError) { console.error(\`\n❌ ${error.message}\`);
        process.exit(1); }` (+ EnvironmentValidationError) to main().catch() in src/index.ts BEFORE the
        default arm. S2.S2 writes clean-rendering tests. S1 provides the typed class + converted throws;
        S1 MUST NOT touch index.ts.

# PATTERN FILES — the exact edit sites
- file: src/config/types.ts
  why: EDIT — add HackConfigError after AuthPreflightError (219-233), before buildPreflightMessage (235).
        The 4 existing classes (EnvironmentValidationError@79, UnsupportedHarnessError@142,
        HarnessProviderMismatchError@175, AuthPreflightError@219) are the template (super + this.name).
  pattern: "export class AuthPreflightError extends Error { constructor(opts) { super(msg); this.name='AuthPreflightError'; … } }"
  gotcha: HackConfigError is the SIMPLEST (message-only, no readonly fields). Place it in the cluster, not at EOF.

- file: src/config/hack-config.ts
  why: EDIT — import (after line 11) + 9 conversions (83,90,774,815,820,826,832,837,847) + JSDoc (801-806).
        parseHackFile@74, validateHackTier@755 (secrets throw@774), validateFieldValue@807 (6 throws@815-847).
  pattern: "throw new Error(`[${section}] ${key} in ${file}: …`);  →  throw new HackConfigError(`[${section}] ${key} in ${file}: …`);"
  gotcha: Line 90's throw keeps its `{ cause: error }` 2nd arg (super(message) forwards to Error, which
          accepts cause). Line 95 `throw error;` is a RETHROW — LEAVE IT (not in the 9-site list).

# CONSUMER (read-only — proves behavior-preservation)
- file: src/index.ts
  why: main().catch() arms (395-408+): AuthPreflightError@396, HarnessProviderMismatchError@400,
        UnsupportedHarnessError@404, NotARepositoryError@408, then DEFAULT (~421). S2 inserts the
        HackConfigError arm before the default. S1 does NOT edit this file. The JSDoc references it
        in anticipation of S2.
- file: src/cli/commands/config.ts
  why: the `hack config validate` path (489-528) uses `e instanceof Error ? e.message : String(e)` →
        works identically with HackConfigError (subclass, same .message). NO change needed (Risks #2).

# TEST PATTERN — the file whose assertions must stay green (no edits needed)
- file: tests/unit/config/hack-config.test.ts
  why: All assertions are message-regex: toThrow(/BOM/)@89, /BOM/@410, /out of range/@756. These match
        error.message — UNCHANGED by S1. HackConfigError extends Error so instanceof Error stays true.
        No edit required; the suite stays GREEN and exercises the new constructor (types.ts coverage).
  pattern: "expect(() => parseHackFile(path)).toThrow(/BOM/);"
  gotcha: Do NOT add `instanceof HackConfigError` assertions here in S1 (that's S2.S2's clean-rendering
          test scope). S1 only needs the existing message-regex tests to keep passing.
```

### Current Codebase tree (relevant slice)
```bash
src/config/types.ts                       # EDIT — +HackConfigError class (after AuthPreflightError)
src/config/hack-config.ts                 # EDIT — +import, 9 throw conversions, validateFieldValue JSDoc
src/index.ts                              # UNCHANGED (S2 adds the catch arm — P1.M2.T2.S1)
src/cli/commands/config.ts                # UNCHANGED (e instanceof Error path works identically)
tests/unit/config/hack-config.test.ts     # UNCHANGED (message-regex assertions stay green)
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/types.ts                       # MODIFIED (+1 exported class)
src/config/hack-config.ts                 # MODIFIED (+import, 9 throw-site swaps, JSDoc @remarks)
# No test changes. No docs/*.md (DOCS: Mode A — JSDoc rides with the code).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — Keep every error message BYTE-IDENTICAL. The 9 conversions are `throw new Error(X)` →
//   `throw new HackConfigError(X)` where X (the template-literal message, incl. line 90's `{ cause }`)
//   is UNCHANGED. The messages are already correct/actionable; rewording breaks the message-regex
//   tests (toThrow(/BOM/), /out of range/) and is out of scope.

// CRITICAL — Line 95 `throw error;` is a RETHROW (the parseHackFile catch's passthrough for BOM/
//   ENOENT/other errors), NOT a `throw new Error`. It is NOT in the 9-site list. LEAVE IT. After the
//   change: BOM@83 throws HackConfigError → catch@89 (not a TomlError) → `throw error;`@95 rethrows
//   the HackConfigError as-is. Correct.

// CRITICAL — DO NOT edit src/index.ts. The dedicated `instanceof HackConfigError` catch arm is S2's
//   deliverable (P1.M2.T2.S1). S1 only updates the validateFieldValue JSDoc in ANTICIPATION of S2's arm.
//   Until S2 lands, HackConfigError hits the default arm identically to plain Error (same message+stack).

// CRITICAL — HackConfigError extends Error, so `throw new HackConfigError(msg)` typechecks everywhere
//   `throw new Error(msg)` did, and `e instanceof Error` / `e.message` / config validate's
//   `e instanceof Error ? e.message : String(e)` all behave IDENTICALLY. This is what makes S1 safe.

// GOTCHA — Place HackConfigError in the types.ts error-class CLUSTER (after AuthPreflightError@233),
//   not at EOF. It's the established home for typed config errors. It's the SIMPLEST of the 5
//   (message-only ctor; no readonly fields like AuthPreflightError has).

// GOTCHA — Line 90's throw has a 2nd arg `{ cause: error }`. KEEP IT. HackConfigError's constructor
//   is `(message: string)` → `super(message)` → Error(message) — but the CALL SITE `new HackConfigError(
//   `...`, { cause: error })` would NOT typecheck (ctor takes only message). Two safe options: (a) keep
//   the throw as `throw new HackConfigError(\`...: ${error.message} ...\`)` and DROP `{ cause }` (the
//   cause was only for debug stack-chaining; the message already embeds line/column), OR (b) extend
//   HackConfigError's ctor to `(message: string, opts?: { cause?: unknown })` and forward `super(message,
//   opts)`. PREFER (a) — drop `{ cause }` — UNLESS typecheck fails, then (b). Verify with typecheck.
//   (The architecture doc's class body is message-only; (a) matches it.)

// GOTCHA — 100% coverage globally enforced. The HackConfigError constructor is exercised TRANSITIVELY
//   by hack-config.test.ts (BOM@89, out-of-range@756 → instantiate HackConfigError). No new test needed
//   for green. (Optional: a 1-line instanceof assertion in a types test — not required.)

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per the
//   bugfix architecture docs). Gate = typecheck + lint + format:check + the targeted hack-config.test.ts.

// CRITICAL — Parallel execution: P1.M1.T2.S1 (running now) writes ONLY a BUG-001 integration TEST file
//   (tests/integration/cli/subcommand-repo-root.test.ts). S1 edits src/config/types.ts + hack-config.ts.
//   Zero file overlap, no merge conflict.
```

---

## Implementation Blueprint

### Data models and structure
One new exported class (the simplest typed-error variant). No new fields, no new types beyond it:
```ts
// src/config/types.ts — after AuthPreflightError (line 233)
export class HackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HackConfigError';
  }
}
```

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/types.ts  (add HackConfigError)
  - INSERT the class (verbatim body in "Technical requirements") after AuthPreflightError's closing
        brace (line 233), before the buildPreflightMessage helper (235). Include the JSDoc citing
        PRD §9.7.6/§9.7.7 + the dedicated-arm remark.
  - DO NOT: add readonly fields (message-only is the contract); change any existing class; place it at EOF.
  - EXPECTED: typecheck clean (super(message) is valid Error ctor).

Task 2: EDIT src/config/hack-config.ts  (import + 9 conversions)
  - ADD import after line 11 (`import { PRP_API_KEY } from './constants.js';`):
        import { HackConfigError } from './types.js';
  - CONVERT each of the 9 `throw new Error(...)` → `throw new HackConfigError(...)`, message arg UNCHANGED:
        line 83 (BOM), 90 (TOML parse — see Gotcha re `{ cause }`), 774 (secrets), 815 (bool type),
        820 (string type), 826 (int type), 832 (int <min), 837 (int >max), 847 (enum).
  - Line 90: prefer dropping `{ cause: error }` (message already embeds line/column). If typecheck
        rejects dropping it, extend the ctor to accept opts (Gotcha option b). Verify with typecheck.
  - LEAVE line 95 `throw error;` UNCHANGED (rethrow).
  - EXPECTED: typecheck clean; the 9 throws now construct HackConfigError.

Task 3: EDIT src/config/hack-config.ts  (validateFieldValue JSDoc — Mode A)
  - UPDATE the @remarks first sentence (lines 801-806) per the diff in "Technical requirements":
        "A `throw new HackConfigError` reaches `main().catch()`'s dedicated `HackConfigError` arm →
        a clean `❌ <message>` line + exit 1 …". Keep the message-content description + the poll_ms
        type-vs-range note. Drop the `index.ts:401` line ref.
  - (RECOMMENDED consistency) ALSO update validateHackTier's @remarks (734-736) "default arm → exit 1"
        → "dedicated HackConfigError arm" (same one-sentence edit; the secrets throw@774 is now typed).
        Same file, low risk, avoids a stale comment.
  - DO NOT change the @remarks of any other function or the @throws tags.
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts   # message-regex assertions — GREEN.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts --coverage   # types.ts + hack-config.ts 100%.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures — not S1's concern).
  - EXPECTED: typecheck/lint/format clean; hack-config.test.ts green; types.ts + hack-config.ts 100%.
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/types.ts: the class (after AuthPreflightError, line 233) ----
export class HackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HackConfigError';
  }
}

// ---- src/config/hack-config.ts: the import (after line 11) ----
import { PRP_API_KEY } from './constants.js';
import { HackConfigError } from './types.js';

// ---- the 9 conversions (message arg UNCHANGED; shown for 2 representative sites) ----
// line 83 (BOM):
throw new HackConfigError(
  `BOM detected in ${filePath}; remove it and re-save as UTF-8 without BOM`
);
// line 832 (int range):
throw new HackConfigError(
  `[${section}] ${key} in ${file}: ${value} is out of range (${range}).`
);
// (lines 90, 774, 815, 820, 826, 837, 847 follow the identical single-token swap.
//  line 90: drop `{ cause: error }` unless typecheck rejects — see Gotcha.)

// ---- line 95 UNCHANGED (rethrow — NOT converted) ----
    throw error; // BOM Error / ENOENT / etc. — already carry the path; rethrow as-is

// ---- validateFieldValue JSDoc @remarks (lines 801-806) — first sentence updated ----
 * @remarks A `throw new HackConfigError` reaches `main().catch()`'s dedicated `HackConfigError`
 * arm → a clean `❌ <message>` line + exit 1 (mirroring NotARepositoryError/AuthPreflightError;
 * PRD §9.7.7/§9.2.7). The message names the file + section + key + offending value + expected
 * type/range (for int) / accepted values (for enum). …
```

### Integration Points
```yaml
TYPES.TS (src/config/types.ts):
  - +export class HackConfigError extends Error (message-only ctor; this.name='HackConfigError')
  - PRESERVE: the 4 existing error classes; buildPreflightMessage; all types.

HACK-CONFIG.TS (src/config/hack-config.ts):
  - +import { HackConfigError } from './types.js' (after the ./constants.js import)
  - 9× throw new Error(...) → throw new HackConfigError(...) (messages UNCHANGED)
  - validateFieldValue @remarks: "default arm" → "dedicated HackConfigError arm"
  - (recommended) validateHackTier @remarks: same one-sentence update
  - PRESERVE: line 95 throw error; all message strings; all function signatures; HACK_CONFIG_SCHEMA.

DOWNSTREAM CONSUMER (S2 — P1.M2.T2.S1; NOT S1):
  - src/index.ts main().catch(): S2 adds `if (error instanceof HackConfigError) { console.error(\`\n❌
    ${error.message}\`); process.exit(1); }` (+ EnvironmentValidationError) before the default arm.
  - S1 MUST NOT edit index.ts. The JSDoc references S2's arm in anticipation.

DOCS (Mode A — JSDoc rides with the work):
  - The validateFieldValue @remarks update is the only doc artifact (recommended + validateHackTier).
  - NO docs/*.md, README, or .env.example changes.
  - Commit message notes: typed-error refactor (behavior-preserving); messages unchanged; 9 sites;
    line-95 rethrow left alone; dedicated arm + clean-rendering tests are S2 (P1.M2.T2.S1/S2).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (src/; super(message) is valid)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: line 90's `{ cause }` arg if you kept it with the message-only
#   ctor (TS2554 expected 1 arg got 2) → drop `{ cause }` (Gotcha option a) or extend the ctor (option b).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — message-regex assertions, MUST stay GREEN (no edits needed):
npx vitest run tests/unit/config/hack-config.test.ts
# Coverage on the touched source files (types.ts constructor exercised transitively):
npx vitest run tests/unit/config/hack-config.test.ts --coverage
# Expected: green; types.ts + hack-config.ts at 100%. If a toThrow(/BOM/) or /out of range/ fails, the
#   message string was accidentally reworded — restore it byte-identical. If types.ts coverage <100%, a
#   HackConfigError ctor path is unexercised — confirm hack-config.test.ts runs the BOM + range tests.
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures — not S1's concern).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY the 2 source files changed (S1 must not touch index.ts / tests / docs):
git diff --name-only   # Expect ONLY src/config/types.ts + src/config/hack-config.ts.
# Confirm the 9 conversions + no message drift (grep proof):
grep -c "throw new HackConfigError" src/config/hack-config.ts   # Expect 9.
grep -c "throw new Error" src/config/hack-config.ts             # Expect 0 (all 9 converted; line 95 is `throw error`).
# Sibling suites that import hack-config (unchanged behavior — stay green):
npx vitest run tests/unit/cli/commands/config.test.ts tests/unit/cli/apply-hack-cli-defaults.test.ts
# Expected: git diff shows only the 2 files; 9 HackConfigError throws; 0 plain `throw new Error`;
#   sibling suites green (they use e.message / instanceof Error — both unchanged for subclasses).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. `new HackConfigError('x') instanceof Error` === true; `.name === 'HackConfigError'`; `.message === 'x'`.
#   2. All 9 throw sites converted; messages byte-identical (grep -c proof in Level 3).
#   3. Line 95 rethrow UNCHANGED; line 90's { cause } handled (dropped or ctor extended).
#   4. No test edited (message-regex assertions + instanceof Error all hold for the subclass).
#   5. Scope: index.ts UNCHANGED (S2's arm); the JSDoc references S2's dedicated arm in anticipation.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` GREEN (no test edits).
- [ ] `src/config/types.ts` + `src/config/hack-config.ts` at 100% coverage.
- [ ] `git diff --name-only` shows ONLY `src/config/types.ts` + `src/config/hack-config.ts`.
- [ ] `grep -c "throw new HackConfigError" src/config/hack-config.ts` === 9; `"throw new Error"` === 0.

### Feature Validation
- [ ] `HackConfigError` exported (message-only ctor, `this.name='HackConfigError'`).
- [ ] All 9 sites throw `HackConfigError`; messages byte-identical.
- [ ] Line 90's `{ cause }` handled (dropped or ctor extended); line 95 rethrow UNCHANGED.
- [ ] `validateFieldValue` `@remarks` references `HackConfigError` + the dedicated arm.

### Code Quality Validation
- [ ] `HackConfigError` placed in the types.ts error-class cluster (after AuthPreflightError).
- [ ] Conversion is mechanical (message strings unchanged) — behavior-preserving.
- [ ] Only `src/config/types.ts` + `src/config/hack-config.ts` modified.
- [ ] `src/index.ts` UNCHANGED (S2's region — the dedicated catch arm).

### Documentation & Deployment
- [ ] validateFieldValue `@remarks` updated (Mode A — rides with the code); validateHackTier @remarks too (recommended).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: typed-error refactor (behavior-preserving); 9 sites + line-95 exclusion;
      messages unchanged; dedicated catch arm + clean-rendering tests are S2 (P1.M2.T2.S1/S2).

---

## Anti-Patterns to Avoid

- ❌ Don't reword any error message — the 9 conversions are `throw new Error(X)` → `throw new HackConfigError(X)`
      with `X` byte-identical. Rewording breaks the `toThrow(/BOM/)` / `/out of range/` tests and is out of scope.
- ❌ Don't convert line 95 (`throw error;`) — it's a rethrow (the parseHackFile catch's passthrough for
      BOM/ENOENT/other errors), not a `throw new Error`. It's NOT in the 9-site list. Leave it.
- ❌ Don't edit `src/index.ts` — the dedicated `instanceof HackConfigError` catch arm is S2 (P1.M2.T2.S1).
      S1 only updates the JSDoc in anticipation. Until S2 lands, rendering is unchanged (default arm).
- ❌ Don't keep line 90's `{ cause: error }` if it breaks the message-only ctor (TS2554) — drop it (the
      message already embeds line/column) OR extend the ctor to `(message, opts?)`. Verify with typecheck.
- ❌ Don't add readonly fields to HackConfigError — it's the message-only variant (the contract). The 4
      existing classes are the pattern; HackConfigError is the simplest.
- ❌ Don't add `instanceof HackConfigError` assertions to existing tests in S1 — that's S2.S2's
      clean-rendering test scope. S1 only needs the existing message-regex tests to stay green.
- ❌ Don't place HackConfigError at EOF — put it in the types.ts error-class cluster (after AuthPreflightError).
- ❌ Don't touch `src/cli/commands/config.ts` — its `e instanceof Error ? e.message : String(e)` path works
      identically with HackConfigError (subclass, same `.message`). No change needed.
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate on
      typecheck + lint + format:check + the targeted hack-config.test.ts.
- ❌ Don't update @throws tags or other functions' JSDoc — only validateFieldValue's @remarks (required)
      + validateHackTier's @remarks (recommended consistency). The @throws `{Error}` tags technically
      become `{HackConfigError}` but JSDoc @throws is non-normative; leave them (out of scope, low value).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, mechanical, behavior-preserving refactor — one new class (the simplest typed-error
variant, verbatim from the architecture doc) + 9 single-token `throw new Error` → `throw new HackConfigError`
swaps with byte-identical messages + one JSDoc sentence update. The class pattern is copied from 4 existing
siblings in the same file; the 9 line numbers are verified; the line-95-rethrow exclusion is pinned; and the
test-safety is proven by grep (every assertion is a message-regex `toThrow` or `instanceof Error` — both hold
for the subclass with unchanged messages). Coverage of the new constructor is transitive (the BOM + range
tests instantiate it). Scope is airtight: S1 edits only `types.ts` + `hack-config.ts`; it is file-disjoint
from S2 (`index.ts`) and from the parallel P1.M1.T2.S1 (BUG-001 test file). The one real risk — line 90's
`{ cause }` arg vs the message-only ctor — is enumerated with two verified fallbacks (drop it, or extend the
ctor) and caught by the typecheck gate. Residual risks: (a) accidentally rewording a message (the grep
`-c` proof + the targeted vitest run catch it); (b) a prettier nit (auto-fixed via `npm run fix`). No
runtime/network/LLM unknowns — all 9 sites are local validation throws.