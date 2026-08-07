# PRP — P1.M1.T1.S1: Fix `getRecentCommitMessages` to use `maxCount` instead of `maxEntries`

> Bugfix 001, **BUG-001 (CRITICAL)** of `plan/012_7dd502f7feb9/bugfix/001_662720d16c77/TEST_RESULTS.md`.
> `getRecentCommitMessages()` passes an invalid simple-git option (`maxEntries` instead of
> `maxCount`), so the DEFAULT `auto` commit-style throws on every commit and silently degrades to
> the placeholder message. **S1 is the one-token source fix.** The masked test assertion is S2;
> the regression-prevention integration tests are T2.

---

## Goal

**Feature Goal**: Change the single option key in `getRecentCommitMessages()` from the invalid
`maxEntries` to the simple-git-contracted `maxCount`, so `git.log({ maxCount: count })` returns the
last N commit messages instead of throwing `fatal: ambiguous argument 'maxEntries=N'`.

**Deliverable**: `src/tools/git-mcp.ts` line ~593 — change `{ maxEntries: count }` to `{ maxCount: count }`.
No other line in the function (or file) changes.

**Success Definition**:
- `getRecentCommitMessages(5)` (real simple-git, no mock) returns an array of ≤5 commit-message
  strings without throwing.
- `npm run typecheck` exits 0 (the change aligns with `LogOptions`; typecheck was green before and
  stays green — the bug is runtime-only).
- The function signature, `count === 0` short-circuit, `validateRepositoryPath` call, return mapping,
  and JSDoc are byte-for-byte unchanged.
- **`tests/unit/tools/git-mcp.test.ts:977` is EXPECTED to fail** after S1 (it asserts the old
  `maxEntries`) — it is corrected in P1.M1.T1.S2. S1 does not touch any test.

---

## Why

- **Restores the headline §5.1 feature.** Under the DEFAULT config (`PRP_COMMIT_STYLE=auto`,
  `PRP_COMMIT_STYLE_EXAMPLES=5`), `generateCommitMessage()` calls `getRecentCommitMessages(5)` to
  fetch style examples. The throw propagates → `smartCommit` retry → non-transient rethrow →
  fallback placeholder. Every pipeline commit becomes `chore: commit-gen failed (exit 0); fallback
  commit`, losing the LLM-generated descriptive message. The `auto` style is 100% non-functional.
- **One-token, zero-risk fix.** `LogOptions` defines `maxCount?: number` (verified in the simple-git
  type defs); the code simply used the wrong name. Changing the key aligns the call with the contract
  and with the empirical behavior (`git.log({maxCount:5})` works).
- **AGENTS.md Rule 5 (out-of-spec corrective fix).** This is a bug in existing behavior, not a new
  feature — it may be fixed directly without a PRD entry (a bugfix-section note is welcome but not
  blocking). It restores the §5.1-specified `auto` behavior; it adds nothing new.
- **Scope discipline.** S1 = the source token ONLY. The masked test assertion (`git-mcp.test.ts:977`)
  is S2; the real-simple-git integration + end-to-end `auto` tests are T2. Doing those here would
  collide with those subtasks.

---

## What

### User-visible behavior
None directly (internal git helper). Indirectly, once S2 lands: under default config, pipeline
commits carry the LLM-generated, style-matched descriptive message instead of the generic fallback
placeholder.

### Technical requirements (exact contract)

**File:** `src/tools/git-mcp.ts`, function `getRecentCommitMessages(count, repoPath?)` (lines ~583–593).

**The change** — one option key on the `git.log(...)` line:
```ts
// BEFORE (line ~593):
const logResult = await git.log({ maxEntries: count });

// AFTER:
const logResult = await git.log({ maxCount: count });
```

**Do NOT change** anything else: the function signature, the `if (count === 0) return [];`
short-circuit, the `validateRepositoryPath` call, the `logResult.all.map(entry => entry.message)`
return, or the JSDoc (lines ~570–582). The JSDoc accurately describes behavior and does not mention
the internal option name, so no doc update is needed.

### Success Criteria
- [ ] `git-mcp.ts` line ~593 calls `git.log({ maxCount: count })`.
- [ ] No other line in `getRecentCommitMessages` (or the file) is modified.
- [ ] `npm run typecheck` exits 0.
- [ ] Empirical smoke: `getRecentCommitMessages(5)` returns ≤5 messages, no throw.
- [ ] No test file is modified in S1 (`git-mcp.test.ts:977` failure is expected; S2 owns the fix).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact file:line, the verbatim before/after, the simple-git type
proof, the empirical reproduction, and the explicit scope boundary (source only; test fix is S2)
are all below.

### Documentation & References

```yaml
# MUST READ — the bug report + verified reproduction + the S1/S2 split
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/architecture/system_context.md
  why: Confirms simple-git LogOptions defines maxCount (not maxEntries) and that maxEntries throws
        empirically while maxCount works. Pins the root-cause line and the S2 test-assertion line.
  critical: S1 is the SOURCE fix ONLY. The test assertion at git-mcp.test.ts:977 is S2. The
        integration tests are T2. Do not cross these boundaries.

# MUST READ — the one-token fix + the expected transient test failure (authored with this PRP)
- docfile: plan/012_7dd502f7feb9/bugfix/001_662720d16c77/P1M1T1S1/research/maxentries-maxcount-fix.md
  section: "3. The fix (S1 scope = ONE token, source only)" and "4. ⚠️ EXPECTED transient test failure owned by S2"
  why: Verbatim before/after + the critical note that git-mcp.test.ts:977 WILL fail after S1 and is
        fixed in S2 (so the implementer doesn't panic or "fix" it here).

# PATTERN FILE — the only file edited
- file: src/tools/git-mcp.ts
  why: getRecentCommitMessages(count, repoPath?) at lines ~583-593. The git.log({ maxEntries: count })
        call is on line ~593. Change the ONE option key to maxCount.
  pattern: "const logResult = await git.log({ maxEntries: count }); return logResult.all.map(entry => entry.message);"
  gotcha: Leave the count===0 short-circuit, validateRepositoryPath call, return map, signature, and
        JSDoc byte-for-byte unchanged. The JSDoc doesn't mention the option name → no doc edit needed.

# VERIFIED PROOF (simple-git type)
- file: node_modules/simple-git/dist/src/lib/tasks/log.d.ts
  why: Line 17 defines `maxCount?: number;` — there is NO `maxEntries` property in LogOptions.
        simple-git passes unrecognized keys through as literal git args → the fatal error.
  pattern: "maxCount?: number;"
  gotcha: typecheck is GREEN today because the call site isn't excess-property-checked at compile
        time (permissive option typing). The bug is runtime-only — so `npm run typecheck` passing
        neither caught nor catches it; the empirical smoke is the real proof.

# TEST FILE (do NOT edit in S1 — S2 owns it)
- file: tests/unit/tools/git-mcp.test.ts
  why: Line 977 asserts the BROKEN contract: expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 }).
        After S1's source change this assertion FAILS (mock is now called with { maxCount: 2 }).
        This is EXPECTED — P1.M1.T1.S2 corrects it to { maxCount: 2 }. Do not touch it in S1.
  pattern: "expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 })"
  gotcha: The git-commit.test.ts layer mocks getRecentCommitMessages to vi.fn() (tests/unit/utils/
        git-commit.test.ts:28), so it never sees this bug and stays green — confirming why CI was green.
```

### Current Codebase tree (relevant slice)

```bash
src/tools/git-mcp.ts                 # EDIT — one option key on line ~593 (maxEntries → maxCount)
tests/unit/tools/git-mcp.test.ts     # READ-ONLY in S1 (line 977 will fail; S2 corrects it)
tests/unit/utils/git-commit.test.ts  # UNCHANGED (mocks getRecentCommitMessages — unaffected)
node_modules/simple-git/.../log.d.ts # READ-ONLY (proof: maxCount?: number at line 17)
```

### Desired Codebase tree with files to be added/edited

```bash
src/tools/git-mcp.ts                 # MODIFIED (one token: maxEntries → maxCount on line ~593)
# No other files. No test edits (S2). No docs (JSDoc unchanged). No new files.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1 is the SOURCE fix ONLY. Do NOT edit git-mcp.test.ts:977 (that's S2) or add
//   integration tests (that's T2). The orchestrator split this into S1/S2/T2 deliberately.

// CRITICAL — after S1, tests/unit/tools/git-mcp.test.ts:977 WILL FAIL (it asserts the old maxEntries).
//   This is EXPECTED and transient — S2 corrects it to { maxCount: 2 }. Do NOT "fix" the test in S1
//   and do NOT treat that failure as an S1 regression. S1's gate is typecheck + the empirical smoke.

// GOTCHA — typecheck is GREEN both before and after the fix. The bug is runtime-only (simple-git's
//   option typing is permissive at the call boundary, so { maxEntries } isn't an excess-property
//   compile error). So `npm run typecheck` cannot catch this — the empirical smoke (real simple-git)
//   is the real proof the fix works.

// GOTCHA — change ONLY the option key. Do not touch the count===0 short-circuit (PRP_COMMIT_STYLE_EXAMPLES=0
//   path), the validateRepositoryPath call, the return map, the signature, or the JSDoc.

// GOTCHA — prettier is ERROR-enforced, but a one-token change inside an existing call won't trip it.
//   Run `npm run fix` only if format:check complains.

// GOTCHA — this is an out-of-spec corrective fix (AGENTS.md Rule 5): a bug in existing behavior.
//   No PRD entry is blocking. A bugfix-section note is welcome but not required.
```

---

## Implementation Blueprint

### Data models and structure
None — a single option-key rename in one function call. No types/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/git-mcp.ts — rename the option key
  - LOCATE: getRecentCommitMessages(count, repoPath?) at lines ~583-593; the git.log call on line ~593.
  - CHANGE: `{ maxEntries: count }`  →  `{ maxCount: count }`  (one token).
  - DO NOT change any other line in the function or file.
  - EXPECTED: typecheck stays green; the runtime throw is gone.

Task 2: VERIFY (source-only — do NOT run the unit test as a green-gate)
  - RUN: npm run typecheck   → exit 0.
  - RUN (empirical smoke, real simple-git, no mock):
        npx tsx -e "import {getRecentCommitMessages} from './src/tools/git-mcp.ts'; getRecentCommitMessages(5).then(m=>console.log('ok',m.length)).catch(e=>console.log('THREW:',e.message))"
        → expect `ok <N>` (N ≤ 5), NOT `THREW: fatal: ambiguous argument 'maxEntries=5'…`.
  - OPTIONAL (confirm the expected transient failure, NOT a green-gate):
        npx vitest run tests/unit/tools/git-mcp.test.ts   → expect the :977 case to FAIL
        (it asserts { maxEntries: 2 }); all other cases pass. This failure is owned by S2.
  - DO NOT edit any test in S1.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the one-token diff (line ~593 of src/tools/git-mcp.ts).
// BEFORE:
const logResult = await git.log({ maxEntries: count });   // ← simple-git passes unrecognized key
                                                          //   as a literal git arg → fatal error
// AFTER:
const logResult = await git.log({ maxCount: count });     // ← LogOptions-contracted; returns N commits
return logResult.all.map(entry => entry.message);         // unchanged

// PATTERN — the empirical smoke (the real proof, since typecheck can't see runtime-only bugs).
//   npx tsx -e "...getRecentCommitMessages(5)..." → `ok <N>`, no throw.
```

### Integration Points

```yaml
DOWNSTREAM (the fix ENABLES correct behavior at these consumers — do NOT edit them in S1):
  - src/utils/git-commit.ts:358-360 (generateCommitMessage): calls getRecentCommitMessages(n) under
        the default `auto` style; after S1 it no longer throws, so the LLM-generated descriptive
        message survives instead of degrading to the fallback placeholder.
  - smartCommit retry path (git-commit.ts:673 / catch 687-700): no longer entered for this root cause.

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T1.S2: correct the masked assertion at tests/unit/tools/git-mcp.test.ts:977
        ({ maxEntries: 2 } → { maxCount: 2 }).
  - P1.M1.T2.S1/S2: add real-simple-git integration test + end-to-end `auto` generateCommitMessage test.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — exit 0 (was green; stays green)
npm run lint                 # clean (one-token change inside an existing call)
npm run format:check         # clean (run `npm run fix` only if it complains)
# Expected: clean. typecheck passing does NOT prove the fix — the bug is runtime-only.
```

### Level 2: Unit Tests (NOT a green-gate for S1)

```bash
# DO NOT treat this as S1's pass/fail gate — :977 is EXPECTED to fail until S2:
npx vitest run tests/unit/tools/git-mcp.test.ts
# Expected: the :977 case FAILS (asserts { maxEntries: 2 }; source now calls { maxCount: 2 }).
# All other cases pass. This single failure is owned by P1.M1.T1.S2.
# (Optional: run it only to CONFIRM the one expected failure, not to gate S1.)
```

### Level 3: Integration Testing (the REAL S1 proof)

```bash
# Empirical smoke against real simple-git (no mock) — this is S1's actual acceptance gate:
npx tsx -e "import {getRecentCommitMessages} from './src/tools/git-mcp.ts'; getRecentCommitMessages(5).then(m=>console.log('ok',m.length,'msgs')).catch(e=>console.log('THREW:',e.message.split('\n')[0]))"
# Expected: `ok <N> msgs` (N ≤ 5). If it prints `THREW: fatal: ambiguous argument …`, the fix didn't land.

# Contrast the default-config path (the one that was broken) now succeeds end-to-end at this layer:
npx tsx -e "delete process.env.PRP_COMMIT_STYLE; delete process.env.PRP_COMMIT_STYLE_EXAMPLES; const c=await import('./src/config/constants.ts'); const g=await import('./src/tools/git-mcp.ts'); const n=c.getPrpCommitStyleExamples(); try{await g.getRecentCommitMessages(n); console.log('no throw')}catch(e){console.log('THREW:',e.message.split('\n')[0])}"
# Expected (after fix): `no throw`. (Before fix this printed `THREW: fatal: ambiguous argument 'maxEntries=5'…`.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a one-token option-key rename with no creative surface. Domain checks (record in commit msg):
#   - git.log now uses the LogOptions-contracted maxCount (verified in node_modules/.../log.d.ts:17).
#   - The default `auto` style path (PRP_COMMIT_STYLE=auto, EXAMPLES=5) no longer throws.
#   - Out-of-spec corrective fix (AGENTS.md Rule 5); no PRD entry blocking.
#   - S2 owns the test-assertion correction; T2 owns regression-prevention integration tests.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] Empirical smoke: `getRecentCommitMessages(5)` returns ≤5 messages, no throw.
- [ ] Default-config path (`auto`/`EXAMPLES=5`) no longer throws at this layer.

### Feature Validation
- [ ] `git-mcp.ts` line ~593 calls `git.log({ maxCount: count })`.
- [ ] No other line in `getRecentCommitMessages` modified (signature, count===0 short-circuit,
      validateRepositoryPath, return map, JSDoc all unchanged).

### Code Quality Validation
- [ ] Only `src/tools/git-mcp.ts` is modified (one token).
- [ ] No test file modified in S1 (`git-mcp.test.ts:977` failure is expected; S2 owns it).
- [ ] No docs change (JSDoc doesn't mention the option name).

### Documentation & Deployment
- [ ] Commit message notes: one-token fix (maxEntries → maxCount); restores the default `auto`
      commit-style; AGENTS.md Rule 5 out-of-spec corrective fix; test-assertion correction = S2.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `tests/unit/tools/git-mcp.test.ts:977` in S1 — that's S2. The orchestrator split source-fix from test-fix deliberately.
- ❌ Don't add integration tests in S1 — that's T2 (P1.M1.T2.S1/S2).
- ❌ Don't treat the `git-mcp.test.ts` suite as S1's green-gate — `:977` is EXPECTED to fail after the source change; it's corrected in S2. Use the empirical smoke (real simple-git) as S1's proof.
- ❌ Don't change anything beyond the one option key — leave the short-circuit, validateRepositoryPath, return map, signature, and JSDoc byte-for-byte unchanged.
- ❌ Don't assume `npm run typecheck` catches this — the bug is runtime-only (permissive option typing at the call boundary); typecheck is green before AND after. The empirical smoke is the real proof.
- ❌ Don't edit `git-commit.ts` or any consumer — S1 is the helper fix; the consumers (generateCommitMessage, smartCommit) automatically benefit.
- ❌ Don't add a PRD entry as a blocker — this is an AGENTS.md Rule 5 out-of-spec corrective fix (bug in existing behavior); a bugfix-section note is welcome but not required.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a single-token rename (`maxEntries` → `maxCount`) on one line of one function,
with the correct token verified three ways: (1) the simple-git `LogOptions` type definition
(`node_modules/simple-git/dist/src/lib/tasks/log.d.ts:17` = `maxCount?: number`, no `maxEntries`);
(2) the architecture/system_context.md empirical reproduction (maxEntries throws, maxCount works);
(3) the PRD bug report's reproduction under the exact default config. The scope boundary is crisp
(source only; test assertion = S2; integration tests = T2), and the one subtlety — that
`git-mcp.test.ts:977` will fail after S1 and is owned by S2 — is flagged at the top so the
implementer neither panics nor "fixes" it here. S1's real acceptance gate (the empirical smoke,
since typecheck can't see runtime-only bugs) is specified. There are no external/runtime unknowns.