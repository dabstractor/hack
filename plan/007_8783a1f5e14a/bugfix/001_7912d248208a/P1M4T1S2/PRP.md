---
name: "P1.M4.T1.S2 — Verify docs/CONFIGURATION.md, docs/INSTALLATION.md, and .env.example auth.json accuracy"
description: >
  Changeset-level documentation SYNC (Mode B) for docs/CONFIGURATION.md,
  docs/INSTALLATION.md, and .env.example following the auth.json runtime-path fix
  (P1.M1.T2) and validator hardening (P1.M1.T3.S1). A VERIFICATION-FIRST task:
  re-confirm every auth.json / AuthStorage / `pi /login` claim against the deployed
  runtime, and make minimal edits ONLY where a claim is proven stale/inaccurate.
  Research strongly indicates NO prose edits are required — the deployed fix makes
  the previously-false "auto-detected by the harness" / "auth.json source #3"
  promises TRUE. This is the docs/ + .env.example counterpart to sibling P1.M4.T1.S1
  (README.md) — do NOT touch README.md.
---

## Goal

**Feature Goal**: Verify — and, only if necessary, correct — every claim about
`~/.pi/agent/auth.json`, `pi /login`, pi's file-backed `AuthStorage`, the `PI_CODING_AGENT_DIR`
override, and the auth resolution priority in `docs/CONFIGURATION.md`, `docs/INSTALLATION.md`,
and `.env.example`, so that these three files contain **zero stale or false statements** after
the P1.M1.T2 Groundswell fix (file-backed `AuthStorage.create()`) and the P1.M1.T3.S1 validator
hardening are deployed.

**Deliverable**: Three files in which every auth.json / `pi /login` / AuthStorage mention is
provably accurate against a live runtime check. Expected outcome (per research): **no prose
changes** — the executor re-runs the verification matrix below to independently confirm, and
edits ONLY if a check fails. If any edit is made, it must be surgical (fix the single inaccurate
claim; no prose rewrites).

**Success Definition**:
1. Every auth.json/`pi /login`/AuthStorage claim enumerated in the "Claims to verify" matrix is
   confirmed accurate against its runtime source-of-truth.
2. Any claim proven inaccurate is corrected with a minimal, surgical edit (no rewrites).
3. Contract point (d) is satisfied: if the P1.M1.T3.S1 validator hardening changed any
   *documented verification command*, that command is updated (research shows it did NOT —
   `npm run validate:groundswell` is unchanged; executor must re-confirm).
4. `npm run docs:lint` introduces **zero new** markdownlint violations vs. the documented
   pre-existing baseline (see Gotchas — 4 violations already exist and are out of scope to
   *introduce*, but see the decision note).
5. No stale/false auth.json claim remains in any of the three files.

## Why

- **PRD §9.2.6** mandates that `pi`'s `~/.pi/agent/auth.json` "must be honored." Under the stale
  dist (Issue 1) it was NOT honored at runtime, so every doc claim that auth.json is
  "auto-detected by the harness" / is "source #3" was **technically false** — the recommended
  `pi /login` onboarding flow failed for every new user (PRD Issue 1, "Additional impact").
- The P1.M1.T2 fix (Groundswell `AuthStorage.create()` in `pi-harness.ts`) is now **deployed and
  verified** (`node_modules/groundswell` → symlink to `../../groundswell`, line 103 =
  `AuthStorage.create()`), flipping those false promises to TRUE. This task closes the
  documentation half of Issue 1 for the docs/ tree and `.env.example`: the shipped docs must not
  promise behavior the runtime no longer contradicts.
- The P1.M1.T3.S1 validator hardening added a new auth-store behavior check
  (`validateAuthStoreBehavior()`), which is relevant to contract point (d): the executor must
  verify it did not change any *documented* verification command.
- This IS the changeset-level documentation sync task for `docs/` and `.env.example` (Mode B).
  The sibling task **P1.M4.T1.S1** owns `README.md` — **do NOT touch README.md** (scope boundary).

## What

Re-read the target sections of all three files and confirm each auth.json / `pi /login` /
AuthStorage / `PI_CODING_AGENT_DIR` statement is accurate against the deployed runtime. Edit only
where a claim is proven wrong.

### Scope boundary (CRITICAL — do NOT expand scope)

- **In scope**: auth.json, `pi /login`, pi file-backed `AuthStorage`, the auth resolution
  priority (PRP_API_KEY → provider env → auth.json), the `PI_CODING_AGENT_DIR` override, the
  fail-fast preflight message, the `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` *provider-conditional*
  mapping (only as it relates to auth resolution).
- **OUT of scope** (do NOT fix here — they are owned by other concerns / would be scope creep):
  - **Model-default discrepancies** (e.g. CONFIGURATION.md L96–98 says `GLM-4.7`/`GLM-4.5-Air`,
    INSTALLATION.md L267–269 says `zai/glm-5.2`, `.env.example` L49–55 says `glm-5.2`). These
    belong to the model-defaults workstream (see P1.M3), NOT to this auth-claims task.
  - **README.md** (owned by sibling P1.M4.T1.S1).
  - Pre-existing markdownlint violations not caused by your edits (see Gotchas).

### Success Criteria

- [ ] Deployed `node_modules/groundswell` dist uses `AuthStorage.create()` (NOT `inMemory()`).
- [ ] Integration test `tests/integration/config/pi-harness-auth.test.ts` PASSES (the runtime
      proof that auth.json is honored end-to-end).
- [ ] `npm run validate:groundswell` PASSES and prints the new "Validating PiHarness auth-store
      behavior (file-backed)" success line (P1.M1.T3.S1).
- [ ] **(a)** Auth resolution priority `PRP_API_KEY → provider env → auth.json` documented in
      CONFIGURATION.md (L67–73, L296–302) and INSTALLATION.md (L308–312) matches the deployed
      `resolveApiKeyForProvider()` + `runAuthPreflight()` behavior.
- [ ] **(b)** `.env.example` L13 "auto-detected by the harness" is TRUE (confirmed by the
      integration test Case A resolving the zai key from auth.json).
- [ ] **(c)** INSTALLATION.md L312 "pi auth file: `~/.pi/agent/auth.json` (overridable via
      `PI_CODING_AGENT_DIR`)" is accurate (confirmed by `buildPreflightMessage()` using
      `process.env.PI_CODING_AGENT_DIR` in `src/config/types.ts`).
- [ ] **(d)** The P1.M1.T3.S1 validator hardening changed **no documented verification command**
      (INSTALLATION.md "Run Validation" section L347–381 still says
      `npm run validate` → `npm run validate:groundswell` → `tsx src/scripts/validate-groundswell.ts`).
      If, and only if, it did change a documented command, update it.
- [ ] Every claim in the "Claims to verify" matrix is confirmed accurate (or surgically fixed).
- [ ] `npm run docs:lint` introduces **zero new** violations beyond the documented pre-existing
      baseline (4 violations: INSTALLATION.md L552/572/574/576 — see Gotchas).
- [ ] `.env.example` has no stale auth comment (no markdown linter covers it — see Gotchas).

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to verify and
correct these doc claims?_ **Yes** — the verification matrix below gives exact file + line
numbers for each claim, the exact runtime source-of-truth for each, and the exact commands to
reproduce each check. No prior knowledge of the auth subsystem is required.

### Documentation & References

```yaml
# MUST READ — the three files under review (this task's only editable artifacts)
- file: docs/CONFIGURATION.md
  why: File #1 under review. Auth claims at L44 (required-footnote), L64 (auto-detected),
        L67–73 (Resolution order), L88 (AUTH_TOKEN provider-conditional mapping),
        L296–302 (Provider-Aware Resolution).
  gotcha: "Line numbers drift if prose is edited above them. Re-grep after any edit:
           grep -n 'auth.json\\|pi /login\\|AuthStorage\\|PI_CODING_AGENT_DIR' docs/CONFIGURATION.md"

- file: docs/INSTALLATION.md
  why: File #2 under review. Auth claims at L67–75 (pi /login quick start), L255–259 (required
        var table + preflight note), L302–312 (auth sources checked, incl. PI_CODING_AGENT_DIR),
        L548–585 (preflight troubleshooting block).
  gotcha: "The troubleshooting block L548–585 has 4 PRE-EXISTING markdownlint violations
           (MD040 L552; MD031 L572/574/576) introduced by commit cf489d8 — NOT by this task.
           See Gotchas for the decision on whether to fix them."

- file: .env.example
  why: File #3 under review. Auth claims at L13 (Option A pi /login 'auto-detected by the
        harness'), L18–22 (anthropic-only credentials comment), L24–25 (PRP_API_KEY override).
  gotcha: "docs:lint (markdownlint 'docs/**/*.md') does NOT cover .env.example — it is a root
           dotfile and not markdown. There is no linter for .env.example; review it by eye and
           via the Claims matrix. Do NOT expect docs:lint to validate it."

# SOURCE OF TRUTH — the auth resolver + preflight decision logic (what the docs must match)
- file: src/config/harness.ts
  why: "resolveApiKeyForProvider(provider) (~L75–91) = priority [PRP_API_KEY override →
        provider-native env var → auth.json deferred to pi]. runAuthPreflight() (~L229–243) =
        Source 1+2 then AuthStorage.create().getAuthStatus(provider).configured. This IS the
        documented resolution priority — the docs must match it exactly."
  pattern: "L233–240: override/env checked first; L239 AuthStorage.create().getAuthStatus(...).configured
            is the auth.json gate."

# SOURCE OF TRUTH — the preflight MESSAGE text (INSTALLATION.md troubleshooting quotes it)
- file: src/config/types.ts
  why: "buildPreflightMessage() (~L207–243) builds the EXACT multi-line message (header →
        'Checked sources' → 'Remediation') that INSTALLATION.md L553–563 quotes. L221–223 reads
        PI_CODING_AGENT_DIR to compute authPath ('~/.pi/agent/auth.json' when unset). This is the
        proof for contract points (b) and (c)."
  critical: "Compare INSTALLATION.md L553–563 against this function's return string. They matched
             at research time. If they diverge, fix the DOC (not the code) — the code is the truth."

# SOURCE OF TRUTH — the AUTH_TOKEN provider-conditional mapping
- file: src/config/environment.ts
  why: "L81–85: the ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY mapping is gated on
        `provider === 'anthropic'`. Confirms CONFIGURATION.md L88 and .env.example L18–22."
  pattern: "if (provider === 'anthropic' && process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {...}"

# THE PROOF — non-mocked integration test exercising the REAL node_modules/groundswell dist
- file: tests/integration/config/pi-harness-auth.test.ts
  why: "P1.M1.T1.S1 test. Case A (auth.json-only) resolving the zai key is the canonical proof
        the 'auto-detected by the harness' claim (contract point b) is TRUE."
  critical: "Uses a tsx SUBPROCESS on purpose to bypass vitest's resolve.alias.groundswell → hits
             the real deployed dist. Run it: npx vitest run tests/integration/config/pi-harness-auth.test.ts"

# DEPLOYED DIST — the runtime that must honor auth.json (confirms P1.M1.T2 deployed)
- file: node_modules/groundswell/dist/harnesses/pi-harness.js
  why: "Line 103 must be `AuthStorage.create()` (file-backed), NOT `AuthStorage.inMemory()`.
        node_modules/groundswell must be a symlink to ../../groundswell."
  gotcha: "If this file shows inMemory() or is NOT a symlink, the fix is NOT deployed — STOP and
           report (P1.M1.T2 regressed); do NOT 'fix' the docs to match a broken runtime."

# HARDENED VALIDATOR — changed by P1.M1.T3.S1 (relevant to contract point d)
- file: src/scripts/validate-groundswell.ts
  why: "Now contains validateAuthStoreBehavior() (~L300) that seeds a temp auth.json and asserts
        harness.authStorage.getApiKey('zai') resolves it. Run: npm run validate:groundswell."
  critical: "The COMMAND did not change (still 'tsx src/scripts/validate-groundswell.ts'). The
             only change is it now prints an extra success section. Contract point (d) is therefore
             expected N/A — verify by confirming INSTALLATION.md L347–381 still documents the same
             command; do NOT add new prose about the validator to user-facing docs."

# PRD CONTEXT
- url: PRD.md §9.2.6 / §9.2.7 / §9.5
  why: "Provider-agnostic auth model, fail-fast preflight, and the cross-repo
        AuthStorage.create() requirement that these docs describe."
```

### Current Codebase tree (verification-relevant paths)

```bash
hacky-hack/
├── docs/
│   ├── CONFIGURATION.md     # ← FILE #1 UNDER REVIEW (auth claims: L44, L64, L67–73, L88, L296–302)
│   └── INSTALLATION.md      # ← FILE #2 UNDER REVIEW (auth claims: L67–75, L255–259, L302–312, L548–585)
├── .env.example             # ← FILE #3 UNDER REVIEW (auth claims: L13, L18–25)
├── PRD.md                   # source of truth for §9.2.6/§9.2.7/§9.5 (READ-ONLY)
├── README.md                # OWNED BY SIBLING P1.M4.T1.S1 — DO NOT TOUCH
├── src/config/
│   ├── harness.ts           # resolveApiKeyForProvider() + runAuthPreflight() (resolution priority)
│   ├── types.ts             # AuthPreflightError + buildPreflightMessage() (message text)
│   └── environment.ts       # AUTH_TOKEN provider-conditional mapping
├── src/scripts/
│   └── validate-groundswell.ts   # P1.M1.T3.S1 hardened validator (contract point d)
├── tests/integration/config/
│   └── pi-harness-auth.test.ts   # runtime proof auth.json is honored (contract point b)
├── node_modules/groundswell -> ../../groundswell   # symlink to the FIXED repo (deployed by P1.M1.T2)
├── .markdownlint.json / .markdownlintignore   # lint config (docs/**/*.md only)
└── package.json             # scripts.docs:lint = markdownlint "docs/**/*.md"
```

### Claims to verify (the matrix the executor MUST walk)

| File:Line | Claim (paraphrased) | Runtime source-of-truth | Expected verdict |
| --- | --- | --- | --- |
| CONFIGURATION.md **L44** | Required: `ZAI_API_KEY` OR `pi /login` (`~/.pi/agent/auth.json`) OR `PRP_API_KEY` for the default path | `runAuthPreflight()` checks all three (`harness.ts` L233–240) | TRUE — no edit |
| CONFIGURATION.md **L64** | `pi /login` (`~/.pi/agent/auth.json`, auto-detected) | `AuthStorage.create()` reads auth.json (deployed) | TRUE — no edit |
| CONFIGURATION.md **L67–73** | Resolution order: 1. `PRP_API_KEY` override → 2. provider-native env (`ZAI_API_KEY`) → 3. `~/.pi/agent/auth.json` auto-detected by pi's file-backed AuthStorage | `resolveApiKeyForProvider()` (`harness.ts` L75–91) + preflight L233–240 | TRUE — no edit |
| CONFIGURATION.md **L88** | `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` mapping **only** when provider is `anthropic` | `environment.ts` L81–85 (gated on `provider === 'anthropic'`) | TRUE — no edit |
| CONFIGURATION.md **L296–302** | Default zai path: `PRP_API_KEY` → `ZAI_API_KEY` → `~/.pi/agent/auth.json` (auto-detected); Anthropic env vars ignored | `resolveApiKeyForProvider()` (`harness.ts`) | TRUE — no edit |
| INSTALLATION.md **L67–75** | `pi /login` writes `~/.pi/agent/auth.json` (Quick Start, Option A) | pi harness `AuthStorage.create()` | TRUE — no edit |
| INSTALLATION.md **L255–259** | Required: `ZAI_API_KEY` OR `pi /login`; preflight aborts (§9.2.7) if neither | `runAuthPreflight()` throws `AuthPreflightError` (`harness.ts` L243) | TRUE — no edit |
| INSTALLATION.md **L308–312** | Auth sources (first non-empty wins): 1. `PRP_API_KEY` 2. provider env 3. pi auth file `~/.pi/agent/auth.json` (overridable via `PI_CODING_AGENT_DIR`) | `buildPreflightMessage()` (`types.ts` L221–223) + `resolveApiKeyForProvider()` | TRUE — no edit (contract point c) |
| INSTALLATION.md **L553–563** | Preflight failure message text (`Checked sources` + `Remediation`) | `buildPreflightMessage()` (`types.ts` L219–236) | TRUE — no edit (verify byte-for-byte) |
| INSTALLATION.md **L565–573** | Remediation: `pi /login` (recommended) writes `~/.pi/agent/auth.json` | `buildPreflightMessage()` L236 | TRUE — no edit |
| INSTALLATION.md **L347–381** | `npm run validate` → `validate:groundswell` → `tsx src/scripts/validate-groundswell.ts` | `package.json` scripts + `validate-groundswell.ts` | TRUE — command unchanged (contract point d, N/A) |
| .env.example **L13** | "Option A: Use `pi /login` (writes `~/.pi/agent/auth.json`, **auto-detected by the harness**)" | `pi-harness-auth.test.ts` Case A resolves zai key | TRUE — no edit (contract point b) |
| .env.example **L18–22** | Anthropic creds ONLY consulted when provider is `anthropic` | `environment.ts` L81–85 | TRUE — no edit |
| .env.example **L24–25** | `PRP_API_KEY` = explicit override, highest precedence, any provider | `resolveApiKeyForProvider()` priority 1 (`harness.ts`) | TRUE — no edit |

**Bottom line:** Every claim is expected TRUE after P1.M1.T2. The deliverable is the *verification*
that they are true, plus surgical edits ONLY if any single claim is found false.

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RE-CONFIRM THE FIX IS DEPLOYED (prerequisite — do not edit docs if this fails)
  - RUN: grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
    EXPECT: line ~103 = `this.authStorage = options?.authStorage ?? AuthStorage.create();`
  - RUN: ls -la node_modules/groundswell
    EXPECT: a symlink → `../../groundswell` (NOT a plain directory / npm tarball copy)
  - RUN: npm run validate:groundswell
    EXPECT: exit 0, prints "Validating PiHarness auth-store behavior (file-backed)" + success line
  - RUN: npx vitest run tests/integration/config/pi-harness-auth.test.ts
    EXPECT: Case A (auth.json-only) PASSES — the zai key resolves from auth.json
  - GATE: If ANY of the above fails, STOP. The docs are accurate against a BROKEN runtime —
    report P1.M1.T2/P1.M1.T3.S1 regressed. Do NOT "fix" the docs to match a broken runtime.

Task 1: VERIFY docs/CONFIGURATION.md auth claims (walk the Claims matrix rows for this file)
  - READ sections: L44, L64, L67–73, L88, L296–302
  - CROSS-CHECK against src/config/harness.ts (resolveApiKeyForProvider + runAuthPreflight)
  - CROSS-CHECK L88 against src/config/environment.ts L81–85
  - EDIT ONLY IF a claim is proven inaccurate: make a minimal surgical edit.
  - RE-GREP after any edit: grep -n 'auth.json\|pi /login\|AuthStorage\|PI_CODING_AGENT_DIR' docs/CONFIGURATION.md

Task 2: VERIFY docs/INSTALLATION.md auth claims (walk the Claims matrix rows for this file)
  - READ sections: L67–75, L255–259, L302–312, L548–585, L347–381
  - CROSS-CHECK L553–563 against buildPreflightMessage() in src/config/types.ts (byte-for-byte)
  - CROSS-CHECK L312 PI_CODING_AGENT_DIR claim against src/config/types.ts L221–223
  - CROSS-CHECK L347–381 verify-command against package.json scripts (contract point d)
  - EDIT ONLY IF a claim is proven inaccurate: minimal surgical edit.
  - NOTE: 4 PRE-EXISTING markdownlint violations live in the L548–585 block (see Gotchas).

Task 3: VERIFY .env.example auth claims (walk the Claims matrix rows for this file)
  - READ lines: L13, L18–25
  - CROSS-CHECK L13 against pi-harness-auth.test.ts Case A (contract point b)
  - EDIT ONLY IF a claim is proven inaccurate: minimal surgical edit.
  - NOTE: docs:lint does NOT cover .env.example; review by eye + matrix only.

Task 4: RUN docs:lint and confirm no NEW violations
  - RUN: npm run docs:lint
  - COMPARE against the documented pre-existing baseline (4 violations: INSTALLATION.md
    L552/572/574/576). Your work must not ADD any violation beyond these.
  - IF you made an edit that introduced a NEW violation, fix YOUR edit (not the pre-existing ones,
    unless you choose the optional cleanup in Gotchas).
```

### Implementation Patterns & Key Details

```python
# This is a documentation VERIFICATION task. The dominant pattern is:
#   1. Re-confirm the runtime proof (Task 0) — the fix must be deployed.
#   2. For each documented claim, open the runtime source-of-truth and compare.
#   3. ONLY edit a doc line if the comparison proves the claim false.
#   4. Edits are SURGICAL: change the fewest words possible to make the claim true.
#
# DO NOT:
#   - Rewrite prose "for clarity" — minimal edits only where inaccurate.
#   - Touch model defaults, README.md, or anything outside the Claims matrix.
#   - "Fix" docs to match a broken runtime — if Task 0 fails, STOP and report.
```

### Integration Points

```yaml
LINT (the only automated gate for this task):
  - command: "npm run docs:lint"
  - config: .markdownlint.json ({ default: true, MD013: false, MD024: { siblings_only: true }, MD036: false })
  - scope: "docs/**/*.md" ONLY — does NOT lint .env.example (root dotfile, non-md)
  - baseline: 4 PRE-EXISTING violations (INSTALLATION.md L552/572/574/576) — see Gotchas

NO CODE CHANGES:
  - This task edits ONLY the three doc files. It does NOT touch src/, tests/, package.json,
    node_modules/, or PRD.md.
```

## Validation Loop

### Level 1: Runtime proof (prerequisite — run BEFORE trusting any doc claim)

```bash
cd /home/dustin/projects/hacky-hack

# 1. The deployed dist must be the FIXED (file-backed) one:
grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
#   EXPECT: line ~103 => this.authStorage = options?.authStorage ?? AuthStorage.create();
ls -la node_modules/groundswell
#   EXPECT: symlink -> ../../groundswell  (NOT a directory copy / npm tarball)

# 2. The hardened validator passes (P1.M1.T3.S1):
npm run validate:groundswell
#   EXPECT: exit 0; prints "Validating PiHarness auth-store behavior (file-backed)" success line

# 3. The non-mocked integration test passes (the runtime proof for contract point b):
npx vitest run tests/integration/config/pi-harness-auth.test.ts
#   EXPECT: Case A (auth.json-only) resolves the zai key => PASS
```

### Level 2: Documentation accuracy (the core verification)

```bash
# Walk the Claims matrix for each file. For each claim, open its runtime source-of-truth and
# compare. Example checks:

# Resolution priority claim (CONFIGURATION.md L67-73, L296-302; INSTALLATION.md L308-312):
sed -n '56,95p' src/config/harness.ts   # resolveApiKeyForProvider priority + comments

# Preflight message claim (INSTALLATION.md L553-563) — must match byte-for-byte:
sed -n '207,243p' src/config/types.ts   # buildPreflightMessage()

# PI_CODING_AGENT_DIR override claim (INSTALLATION.md L312):
grep -n "PI_CODING_AGENT_DIR" src/config/types.ts   # L221-223 computes authPath

# AUTH_TOKEN mapping claim (CONFIGURATION.md L88; .env.example L18-22):
sed -n '79,90p' src/config/environment.ts

# verify-command claim (INSTALLATION.md L347-381, contract point d):
grep -n "validate:groundswell" package.json          # command unchanged?
```

### Level 3: Lint gate (no new formatting regressions)

```bash
cd /home/dustin/projects/hacky-hack

# docs:lint covers docs/**/*.md ONLY (NOT .env.example):
npm run docs:lint
#   EXPECT: only the 4 PRE-EXISTING violations (INSTALLATION.md L552/572/574/576).
#   If a NEW violation appears that traces to YOUR edit, fix YOUR edit.

# .env.example has no linter — review by eye against the Claims matrix.
```

### Level 4: Final correctness sweep

```bash
# Grep every auth claim keyword across the three files and eyeball each hit against the matrix:
grep -n "auth.json\|pi /login\|AuthStorage\|PI_CODING_AGENT_DIR\|auto-detected" \
  docs/CONFIGURATION.md docs/INSTALLATION.md .env.example

# Confirm you did NOT touch out-of-scope files:
git status --short
#   EXPECT: only docs/CONFIGURATION.md, docs/INSTALLATION.md, .env.example (if edited at all);
#   README.md, src/, tests/, package.json MUST be clean.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: deployed dist = `AuthStorage.create()`, symlinked, validator + integration test green.
- [ ] Level 2 passed: every Claims-matrix row confirmed accurate (or surgically fixed).
- [ ] Level 3 passed: `npm run docs:lint` shows NO new violations beyond the 4 pre-existing ones.
- [ ] Level 4 passed: `git status` shows only the three in-scope doc files (if any were edited).

### Contract Points (from the work item)

- [ ] **(a)** Auth resolution priority `PRP_API_KEY → provider env → auth.json` matches deployed behavior.
- [ ] **(b)** `.env.example` L13 "auto-detected by the harness" is TRUE.
- [ ] **(c)** INSTALLATION.md L312 "pi auth file `~/.pi/agent/auth.json` (overridable via `PI_CODING_AGENT_DIR`)" is accurate.
- [ ] **(d)** Validator hardening changed NO documented verification command (or, if it did, the command was updated).

### Feature / Scope Validation

- [ ] No stale/false auth.json claim remains in any of the three files.
- [ ] Edits (if any) are surgical — minimal words changed, no prose rewrites.
- [ ] Model-default discrepancies were NOT touched (out of scope).
- [ ] README.md was NOT touched (owned by sibling P1.M4.T1.S1).
- [ ] `.env.example` reviewed by eye (no linter covers it).

### Documentation Quality

- [ ] Any edited claim still reads naturally and is internally consistent across the three files.
- [ ] Cross-references between the docs (e.g. CONFIGURATION.md "See Also" → INSTALLATION.md/.env.example) remain valid.

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" docs to match a broken runtime. If Task 0 (Level 1) fails, STOP and report — the
  docs are correct; the deployment regressed.
- ❌ Don't rewrite prose for "clarity." This is a verify-and-correct-minimally task, not a docs overhaul.
- ❌ Don't expand scope to model defaults, README.md, or pre-existing lint violations outside the
  reviewed auth block.
- ❌ Don't assume `.env.example` is covered by `docs:lint` — it is not (it's a root dotfile, non-md).
- ❌ Don't trust line numbers blindly — re-grep after any edit (prose above can shift them).
- ❌ Don't conflate "the validator prints new output" with "the documented command changed" —
  P1.M1.T3.S1 added a check but the COMMAND (`npm run validate:groundswell`) is unchanged.

---

## Gotchas of our codebase & Library Quirks

### Pre-existing markdownlint violations in INSTALLATION.md (IMPORTANT)

`npm run docs:lint` currently reports **4 violations**, all in the auth troubleshooting block
under review (introduced by commit `cf489d8`, the preflight feature — NOT by the D1 bugfix
workstream):

```
docs/INSTALLATION.md:552  MD040/fenced-code-language  Fenced code blocks should have a language specified [Context: "```"]
docs/INSTALLATION.md:572  MD031/blanks-around-fences  Fenced code blocks should be surrounded by blank lines [Context: "```bash"]
docs/INSTALLATION.md:574  MD031/blanks-around-fences  ...
docs/INSTALLATION.md:576  MD031/blanks-around-fences  ...
```

- These are **pre-existing** (`git status` is clean; they trace to `cf489d8`). The contract says
  "ensure no formatting **regressions**" — i.e., do not INTRODUCE new ones. These 4 are not yours.
- **Decision**: Because this block (L548–585) is exactly the auth-claim region under verification,
  you MAY opportunistically fix these 4 trivially (add a language tag to L552's fence; add blank
  lines around the L572/574/576 fences) as part of touching that region. If you do, that is a
  net improvement and is in-spirit with "no formatting regressions." If you make NO edits to that
  block, leave them — do not fix unrelated formatting.
- The baseline is 4 violations; after your work the count must be ≤ 4 (preferably 0 if you
  opportunistic-fix, but ≤4 is the hard gate).

### `docs:lint` does NOT cover `.env.example`

`npm run docs:lint` runs `markdownlint "docs/**/*.md"`. `.env.example` lives at the repo root,
is not under `docs/`, and is not a `.md` file. It has **no automated linter**. Review it by eye
against the Claims matrix, and verify there is no stale auth comment.

### Line-number drift

The Claims matrix line numbers are accurate as of research time. After ANY edit, re-grep:
`grep -n 'auth.json\|pi /login\|AuthStorage\|PI_CODING_AGENT_DIR' docs/CONFIGURATION.md docs/INSTALLATION.md .env.example`
and re-verify the edited region.

### Runtime is the source of truth, not the docs

If a doc claim and the runtime source (`src/config/harness.ts`, `src/config/types.ts`,
`src/config/environment.ts`) disagree, **the runtime wins** — fix the DOC. The one exception: if
Level 1 (the deployed dist) fails, the *deployment* is the problem, not the docs — STOP and report.

---

## Confidence Score

**9/10** for one-pass success. This is a verification-first docs-sync task whose expected outcome
is **zero prose edits** (all claims are TRUE after the confirmed P1.M1.T2 deployment). The risk
is low and well-bounded: the Claims matrix maps every claim to an exact runtime source-of-truth
with runnable cross-check commands, the scope boundary is explicit (no model defaults, no
README), and the only automated gate (`docs:lint`) has a documented pre-existing baseline. The
one residual uncertainty is whether a claim the matrix expects to be TRUE will actually fail on
re-verification — but the executor is instructed to make only surgical edits in that case.
