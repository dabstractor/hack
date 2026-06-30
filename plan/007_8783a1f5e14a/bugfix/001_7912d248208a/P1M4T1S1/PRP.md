---
name: "P1.M4.T1.S1 — Verify README.md auth.json claims are accurate post-fix"
description: >
  Changeset-level documentation SYNC (Mode B) for README.md following the
  auth.json runtime-path fix (P1.M1.T2). A verification-first task: confirm every
  README.md auth.json / `pi /login` claim is now accurate, and make minimal
  edits ONLY where a claim is proven stale/inaccurate. Research strongly
  indicates NO edits are required — the deployed fix makes the previously-false
  "auto-detected by the harness" promise TRUE.
---

## Goal

**Feature Goal**: Verify — and, only if necessary, correct — every README.md claim about
`~/.pi/agent/auth.json`, `pi /login`, and the fail-fast auth preflight, so that README.md
contains zero stale or false statements after the P1.M1.T2 Groundswell fix is deployed.

**Deliverable**: A README.md in which every auth.json / `pi /login` mention is provably accurate
against the deployed runtime. Expected outcome (per research): **no prose changes** — the executor
re-runs the verification checks to independently confirm, and edits only if a check fails.

**Success Definition**:
1. Every auth.json/`pi /login` claim enumerated in the "Claims to verify" matrix is confirmed
   accurate against a live runtime check.
2. Any claim found inaccurate is corrected with a minimal, surgical edit (no prose rewrites).
3. README.md still passes `npx markdownlint-cli2 README.md` (project lint config).
4. No claims are silently left stale.

## Why

- **PRD §9.2.6** mandates that `pi`'s `~/.pi/agent/auth.json` "must be honored." Under the stale
  dist it was NOT, so the README's "auto-detected by the harness" promise was **false** — the
  recommended `pi /login` onboarding flow failed for every new user (PRD Issue 1, "Additional impact").
- The P1.M1.T2 fix (Groundswell `AuthStorage.create()`) is now deployed and verified, flipping that
  false promise to TRUE. This task closes the documentation half of Issue 1: the shipped docs must
  not promise behavior the runtime no longer contradicts.
- This IS the changeset-level documentation sync task for README.md (Mode B). The sibling task
  **P1.M4.T1.S2** owns `docs/CONFIGURATION.md`, `docs/INSTALLATION.md`, and `.env.example` —
  **do not touch those files** (scope boundary).

## What

Re-read README.md's three target sections — **Prerequisites** (~L81), **Configuration** (~L240–280),
**Troubleshooting** (~L370–395) — and confirm each auth.json / `pi /login` / preflight statement is
accurate against the deployed runtime. Edit only where a claim is proven wrong.

### Success Criteria

- [ ] Deployed `node_modules/groundswell` dist uses `AuthStorage.create()` (NOT `inMemory()`).
- [ ] Integration test `tests/integration/config/pi-harness-auth.test.ts` PASSES (the runtime proof).
- [ ] README "auto-detected by the harness" claims (L249, L277, L342) are consistent with that proof.
- [ ] README troubleshooting preflight block (L378–388) matches the live
      `buildPreflightMessage()` output in `src/config/types.ts`.
- [ ] README `pi /login` fix recommendation (L391–392) is valid (auth.json honored at run time).
- [ ] No stale/false auth.json claim remains anywhere in README.md.
- [ ] README.md passes markdownlint with the project config.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to verify and
correct these README claims?_ **Yes** — the verification matrix below gives exact README line
numbers, the exact runtime source-of-truth for each claim, and the exact commands to reproduce
each check. No prior knowledge of the auth subsystem is required.

### Documentation & References

```yaml
# MUST READ - the file under review
- file: README.md
  why: The single artifact being verified/edited for this task.
  sections:
    - "Prerequisites (L78–82)"
    - "Configuration > Environment Variables footnote (L242)"
    - "Configuration > Setup (L246–256)"
    - "Configuration > How It Works auth ordering (L269–279)"
    - "Configuration > z.ai Configuration .env example (L336–346)"
    - "Troubleshooting > preflight abort (L372–395)"
  gotcha: "Line numbers drift if prose is edited above them. Re-grep after any edit: grep -n 'auto-detected\|pi /login\|auth.json' README.md"

# SOURCE OF TRUTH — the runtime preflight message; README troubleshooting must match it byte-for-byte
- file: src/config/types.ts
  why: "Contains AuthPreflightError + buildPreflightMessage() — the EXACT text the README troubleshooting block quotes."
  pattern: "buildPreflightMessage(opts) at ~L207–243 builds the multi-line message (header → 'Checked sources' → 'Remediation')."
  critical: "Compare README L378–388 against this function's return string. They were identical at research time."

# SOURCE OF TRUTH — the preflight decision logic
- file: src/config/harness.ts
  why: "runAuthPreflight() (~L226) calls AuthStorage.create().getAuthStatus(provider).configured. This is what makes the 'auto-detected' claim true."
  pattern: "Line ~239: if (AuthStorage.create().getAuthStatus(provider).configured) { return; }"

# THE PROOF — non-mocked integration test that exercises the real node_modules/groundswell dist
- file: tests/integration/config/pi-harness-auth.test.ts
  why: "P1.M1.T1.S1 test. Case A (auth.json-only) resolving the zai key is the canonical proof the README 'auto-detected by the harness' claim is TRUE."
  critical: "Uses a tsx SUBPROCESS on purpose to bypass vitest's resolve.alias.groundswell → hits the real deployed dist. Do NOT 'simplify' to in-process."

# DEPLOYED DIST — the runtime that must honor auth.json
- file: node_modules/groundswell/dist/harnesses/pi-harness.js
  why: "Line 103 must be `AuthStorage.create()` (file-backed), NOT `AuthStorage.inMemory()`. md5 d3de7234… = fixed."
  gotcha: "If this file shows inMemory(), the fix is NOT deployed — STOP and report (P1.M1.T2 regressed), do not 'fix' the README to match a broken runtime."

# HARDENED VALIDATOR — changed by P1.M1.T3.S1 (relevant to contract point c)
- file: src/scripts/validate-groundswell.ts
  why: "Now has a 'Validating PiHarness auth-store behavior (file-backed)' section."
  critical: "README does NOT mention validate:groundswell anywhere (grep-confirmed). Contract point (c) is therefore N/A — do NOT add new prose about the validator to README; it is a contributor concern routed via docs/contributing.md."

# PRD CONTEXT
- url: PRD.md §9.2.6 / §9.2.7 / §9.5
  why: "Provider-agnostic auth model, fail-fast preflight, and the cross-repo AuthStorage.create() requirement that this README documents."
```

### Current Codebase tree (verification-relevant paths)

```bash
hacky-hack/
├── README.md                                  # ← THE FILE UNDER REVIEW (this task's only editable artifact)
├── PRD.md                                     # source of truth for §9.2.6/§9.2.7 (READ-ONLY)
├── .markdownlint.json / .markdownlintignore   # lint config README must pass
├── src/config/
│   ├── types.ts                               # buildPreflightMessage() — truth for Troubleshooting block
│   └── harness.ts                             # runAuthPreflight() — truth for "auto-detected" claim
├── src/scripts/validate-groundswell.ts        # hardened validator (README does NOT reference it)
├── tests/integration/config/
│   └── pi-harness-auth.test.ts                # THE PROOF test (must pass)
└── node_modules/groundswell/  -> ../../groundswell  # symlink; dist must use AuthStorage.create()
```

### Desired Codebase tree

```bash
# No new files. README.md is the only file that MAY change, and only if a check fails.
hacky-hack/
└── README.md   # verified-accurate (expected: unchanged from current state)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: verification must run against the REAL deployed dist, not the vitest alias.
# vitest.config.ts sets resolve.alias.groundswell -> ../groundswell/dist (the fixed source checkout).
# ONLY the integration test's tsx subprocess (no alias) proves the deployed node_modules/groundswell
# behavior. Treat an in-process getApiKey() result as NON-EVIDENCE.

# CRITICAL: A broken runtime is NOT a README bug. If node_modules/groundswell regresses to inMemory(),
# the README "auto-detected" claim is FALSE again — but the fix is to redeploy Groundswell (P1.M1.T2),
# NOT to rewrite README to document a broken state. README must document the INTENDED behavior (which
# matches the now-fixed runtime). If the dist is stale at verification time, STOP and surface it.

# GOTCHA: README line numbers shift when prose above them is edited. Always re-grep after edits.

# GOTCHA: Scope boundary — docs/CONFIGURATION.md, docs/INSTALLATION.md, .env.example belong to
# sibling task P1.M4.T1.S2. Do not edit them here even if you spot an issue (note it for that task).
```

## Implementation Blueprint

### Verification matrix — every README auth.json claim and its source of truth

Run the checks below in order. Each row maps a README claim to the single runtime fact that
proves/disproves it. **Expected result at research time: every row is ACCURATE → no edits.**

| README location | Claim (paraphrased) | Verification command | Source of truth | Expected |
|-----------------|---------------------|----------------------|-----------------|----------|
| L81 (Prerequisites) | `pi /login` writes `~/.pi/agent/auth.json` | (pi SDK behavior, unchanged) | — | accurate |
| L242 (footnote) | auth.json is "auto-detected" | check #2 below | integration test PASS | accurate |
| L249 (Setup) | auth.json "auto-detected by the harness" | check #1 + #2 | dist `create()` + test PASS | **TRUE now** |
| L277 (How It Works) | auth.json "auto-detected by the harness" | same | same | **TRUE now** |
| L342 (.env example) | auth.json "auto-detected by the harness" | same | same | **TRUE now** |
| L378–388 (Troubleshooting) | exact preflight message text | check #3 below | `buildPreflightMessage()` in src/config/types.ts | byte-accurate |
| L391–392 (Troubleshooting) | `pi /login` is the recommended fix | check #2 (auth.json honored at runtime) | integration test PASS | valid |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the deployed Groundswell dist carries the fix (the precondition for ALL claims)
  - RUN: grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
  - EXPECT: a line containing "AuthStorage.create()" (file-backed). Research time: line 103.
    The stale "AuthStorage.inMemory()" line (formerly line 95) must be ABSENT.
  - OPTIONAL CONFIRM: md5sum node_modules/groundswell/dist/harnesses/pi-harness.js → expect d3de7234… (fixed)
                     ls -la node_modules/ | grep groundswell → expect symlink -> ../../groundswell
  - IF FAILS (dist still inMemory): the fix is NOT deployed. STOP. Do not edit README to match a
    broken runtime — surface the regression (P1.M1.T2). README documents INTENDED behavior.
  - PLACEMENT: read-only check; no file change.

Task 2: RUN the non-mocked integration test (the canonical runtime PROOF)
  - RUN: npx vitest run tests/integration/config/pi-harness-auth.test.ts
  - EXPECT: 2 tests passed (Case A auth.json-only + Case B ZAI_API_KEY control). Research time: 2/2 passed in 2.75s.
  - INTERPRETATION: Case A passing = `harness.authStorage.getApiKey('zai')` resolves the seeded
    auth.json credential = the "auto-detected by the harness" claim (L249/L277/L342) is TRUE.
    This is the proof named in the work-item contract ("the P1.M1.T1.S1 integration test passing is the proof").
  - IF FAILS: auth.json auto-detection is broken at runtime → README claim is FALSE → do NOT edit
    README to match a broken runtime; surface the regression.
  - PLACEMENT: read-only check; no file change.

Task 3: DIFF the README troubleshooting block against the live preflight message source
  - READ: src/config/types.ts → buildPreflightMessage() (~L207–243)
  - READ: README.md L378–388 (the ```-fenced preflight message block)
  - EXPECT: identical text, specifically:
      • Header: "Authentication preflight failed: no credential configured for provider 'zai' (harness 'pi', model 'zai/glm-5.2')."
      • "Checked sources (all empty):" → Override: PRP_API_KEY / Environment: ZAI_API_KEY / pi auth.json: ~/.pi/agent/auth.json
      • "Remediation (pick one):" → "pi /login  # writes ~/.pi/agent/auth.json" and "export ZAI_API_KEY=<your-key>   # provider-native env var"
  - IF MISMATCH: edit README.md L378–388 ONLY to match the runtime message (surgical edit, keep the
    ``` fence and surrounding prose intact). This is the one edit most likely to be needed if any.
  - IF MATCH: no edit.

Task 4: SWEEP README.md for any auth.json / pi /login claim not covered by the matrix
  - RUN: grep -n "auto-detected\|pi /login\|auth\.json\|preflight\|AuthStorage" README.md
  - CHECK: every hit falls into one of the matrix rows above OR is accurate on its face.
  - WATCH FOR: a stray mention claiming auth.json is NOT auto-detected, or an outdated "manual setup
    required" instruction that contradicts the "auto-detected" promise.
  - NOTE (validator): validate-groundswell.ts now has an auth-store check, but README does NOT
    reference the validator. Contract point (c) is N/A — do NOT add validator prose to README.
  - IF a stray inaccurate claim is found: make a minimal surgical edit.
  - IF none found: no edit.

Task 5: (CONDITIONAL — only if Task 3 or 4 made an edit) EDIT README.md minimally
  - EDIT: use the edit tool with the smallest unique oldText that captures only the inaccurate span.
  - RULE: change the fewest words possible to make the claim accurate. Do NOT rewrite surrounding prose,
    do NOT restructure sections, do NOT "improve" phrasing that is already correct.
  - PRESERVE: all ``` fences, markdown headers, links, and the footnote (*…*) formatting.
  - RE-GREP after editing to confirm no new inconsistency was introduced and line refs in this PRP
    haven't shifted a claim you still need to check.

Task 6: LINT README.md
  - RUN: npx markdownlint-cli2 README.md  (or whichever command package.json exposes; see Validation Loop)
  - EXPECT: zero errors. Fix any lint error introduced by an edit.
  - IF no edit was made (the expected case): this is a no-op confirmation the existing README lints clean.
```

### Implementation Patterns & Key Details

```text
# Decision tree for "do I edit README or not?"
#
#   Is the deployed dist fixed (AuthStorage.create())?  ──NO──>  STOP. Surface regression. README untouched.
#                              │ YES
#                              v
#   Does the integration test pass?                     ──NO──>  STOP. Surface regression. README untouched.
#                              │ YES
#                              v
#   "auto-detected by the harness" claims are TRUE. Leave them.
#                              │
#                              v
#   Does README troubleshooting block == buildPreflightMessage()?  ──NO──>  Surgical edit to match.
#                              │ YES
#                              v
#   Any stray inaccurate auth.json claim in the sweep?  ──YES─>  Minimal surgical edit.
#                              │ NO
#                              v
#   NO EDITS. Verify markdownlint passes. Done.

# CRITICAL anti-pattern: NEVER edit README to "match" a broken/stale runtime.
# README documents INTENDED behavior. If the runtime contradicts a correct README claim,
# the runtime is the bug (P1.M1.T2 scope), not the README.
```

### Integration Points

```yaml
DOCUMENTATION:
  - file: README.md  (the ONLY editable file for this task)
  - sections: Prerequisites, Configuration (footnote + Setup + How It Works + .env example), Troubleshooting

OUT OF SCOPE (owned by sibling P1.M4.T1.S2 — DO NOT EDIT):
  - docs/CONFIGURATION.md
  - docs/INSTALLATION.md
  - .env.example
  - any file other than README.md

NO CODE CHANGES:
  - This task touches README.md only. It must not modify src/, tests/, scripts/, package.json, etc.
```

## Validation Loop

### Level 1: Verification Checks (the core of this task)

```bash
cd /home/dustin/projects/hacky-hack

# Check 1 — deployed dist is the fixed one (precondition for every claim)
grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
# EXPECT: "AuthStorage.create()" present; "AuthStorage.inMemory()" ABSENT.

# Check 2 — non-mocked integration test (the runtime PROOF auth.json is honored)
npx vitest run tests/integration/config/pi-harness-auth.test.ts
# EXPECT: Test Files 1 passed (1) | Tests 2 passed (2)

# Check 3 — (optional) confirm the validator's new auth-store section also passes
npx tsx src/scripts/validate-groundswell.ts | grep -i "auth-store"
# EXPECT: "✓ PiHarness resolved auth.json-only credential for 'zai' (...)"
```

### Level 2: README Accuracy Diff (manual cross-check)

```bash
# Confirm the troubleshooting message in README matches the runtime source byte-for-byte.
# Open src/config/types.ts (buildPreflightMessage ~L207-243) and README.md (L378-388) side by side.
# They MUST be identical. If they differ, apply the surgical edit in Task 3/5.

# Sweep for any auth.json/pi-login claim missed by the matrix:
grep -n "auto-detected\|pi /login\|auth\.json\|preflight\|AuthStorage" README.md
```

### Level 3: Markdown Lint (documentation validation)

```bash
# Run whichever the project exposes. Try in order:
npx markdownlint-cli2 README.md            # preferred
# fallback:
npx markdownlint README.md                 # older CLI

# EXPECT: zero errors for README.md.
# If an edit introduced a lint error (e.g. unbalanced fence, bad list indent), fix it.
# If NO edit was made, this confirms the existing README lints clean.
```

### Level 4: Scope & Boundary Validation

```bash
# Confirm ONLY README.md was touched (if any edit was made). Expected: either nothing changed,
# or only README.md is in the diff.
git status --porcelain
# EXPECT: at most ` M README.md`. Anything else (docs/, .env.example, src/, tests/) is OUT OF SCOPE
# and must be reverted.

# Confirm the sibling-task files were NOT touched:
git diff --name-only | grep -E "docs/(CONFIGURATION|INSTALLATION)\.md|\.env\.example" && echo "SCOPE VIOLATION — revert" || echo "scope OK"
```

## Final Validation Checklist

### Technical Validation

- [ ] Check 1: deployed dist uses `AuthStorage.create()` (not `inMemory()`).
- [ ] Check 2: `tests/integration/config/pi-harness-auth.test.ts` passes (2/2).
- [ ] Check 3 (optional): validator auth-store section passes.
- [ ] README troubleshooting block matches `buildPreflightMessage()` in src/config/types.ts.
- [ ] README.md passes markdownlint with project config.

### Feature Validation

- [ ] Every "auto-detected by the harness" claim (L249, L277, L342) is TRUE (proven by Check 2).
- [ ] Every `pi /login` recommendation (L81, L249, L342, L391–392) is valid (auth.json honored at runtime).
- [ ] No stale/false auth.json claim remains anywhere in README.md.
- [ ] IF any edit was made: it is minimal/surgical and preserves all surrounding structure.
- [ ] IF no edit was made: verification matrix documented as all-accurate.

### Scope & Code-Quality Validation

- [ ] Only README.md was modified (`git status` shows at most ` M README.md`).
- [ ] `docs/CONFIGURATION.md`, `docs/INSTALLATION.md`, `.env.example` untouched (sibling task scope).
- [ ] No source/test/config files modified.
- [ ] No new prose added that wasn't required by an inaccurate claim (no scope creep into the validator).
- [ ] If a broken runtime was detected, it was surfaced — README was NOT rewritten to match it.

### Documentation & Deployment

- [ ] README edits (if any) are self-consistent (no claim contradicts another).
- [ ] No broken markdown anchors/links introduced.

---

## Anti-Patterns to Avoid

- ❌ **Don't rewrite README to match a broken runtime.** If the deployed dist regressed to
  `inMemory()`, the README "auto-detected" claim is FALSE again — but the correct response is to
  redeploy the Groundswell fix (P1.M1.T2), not to document the broken state. README documents
  INTENDED behavior.
- ❌ **Don't add validator prose to README.** The hardened `validate-groundswell.ts` now has an
  auth-store check, but README does not reference the validator anywhere, and that's correct — it
  is a contributor concern routed via `docs/contributing.md`. Contract point (c) is N/A.
- ❌ **Don't trust an in-process `getApiKey()` as evidence.** vitest's `resolve.alias.groundswell`
  points at the fixed source checkout, so only the integration test's tsx subprocess proves the
  deployed `node_modules/groundswell` behavior.
- ❌ **Don't rewrite correct prose.** This is a verification task; edit ONLY an inaccurate span.
- ❌ **Don't edit out-of-scope files** (docs/CONFIGURATION.md, docs/INSTALLATION.md, .env.example) —
  they belong to P1.M4.T1.S2.
- ❌ **Don't skip the markdownlint gate** even if you made no edits — confirm the file lints clean.

---

## Confidence Score

**9/10** — The research independently confirmed every README claim is already accurate post-fix
(deployed dist md5 d3de7234 = fixed; integration test 2/2 pass; troubleshooting block matches
`buildPreflightMessage()` byte-for-byte; README does not reference the validator so point (c) is N/A).
The 1-point reservation is for runtime drift between research capture and execution (e.g. a fresh
`npm install` reverting the symlink to a published tarball) — the verification checks exist precisely
to catch that. The overwhelmingly likely outcome is **zero edits + documented verification**.
