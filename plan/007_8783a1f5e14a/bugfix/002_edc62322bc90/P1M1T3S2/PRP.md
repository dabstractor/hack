# PRP — P1.M1.T3.S2: Update docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, docs/INSTALLATION.md re: credential-free local modes & clean harness error

> **Docs-only task (Mode B)** — the final changeset-documentation sync for bugfix 002, covering the
> three `docs/*.md` files. Source changes are already COMPLETE: **P1.M1.T1** (Issue 1 — preflight
> placement; `--validate-prd` / `--dry-run` run credential-free) and **P1.M1.T2** (Issue 2 — clean
> one-line error + exit 1 for `claude-code` + default `zai`, no raw stack trace).
> The sibling **P1.M1.T3.S1 (README.md) is already COMPLETE** — do NOT touch README.md here.

---

## Goal

**Feature Goal**: Bring `docs/CLI_REFERENCE.md`, `docs/CONFIGURATION.md`, and `docs/INSTALLATION.md`
into agreement with the verified post-fix startup behavior, so no statement reads as stale:
1. The auth preflight (PRD §9.2.7) now gates **only agent-invoking runs**; the pure-local modes
   `--validate-prd` and `--dry-run` make **zero API calls and run without any credential**.
2. An invalid `PRP_AGENT_HARNESS=claude-code` + default `zai` configuration now fails at startup
   with **a single actionable message and exit 1** (no raw Node stack trace).
3. The `--validate-prd` exit code is documented consistently as **0 valid / 1 invalid** (NOT code 2).

**Deliverable**: A small set of surgical, tone-consistent edits across the three files (exact
anchors + suggested wording below). No new files. No restating of the PRD.

**Success Definition**:
- A reader can determine, from each of the three docs alone, that `--validate-prd` and `--dry-run`
  need **no API credential**, and that a new user may lint a PRD **before** configuring API access.
- The `--validate-prd` / `--dry-run` descriptions in every flag table and "Special Modes" section
  are annotated "no credential required" (or equivalent wording).
- The Exit Codes table no longer claims code 2 (`VALIDATION_ERROR`) applies to `--validate-prd`.
- Wherever the `claude-code` + `zai` mismatch is mentioned, the doc notes it fails fast with a single
  actionable message + exit 1 (and does NOT paste the pre-fix raw stack trace).
- All three files pass `npx prettier --check` (they are in the format glob). No broken anchors.

## User Persona (if applicable)

**Target User**: A first-time user / contributor onboarding via the `docs/` guides (and a CI reader
of `CLI_REFERENCE.md` exit codes).

**Use Case**: (1) Validate a `PRD.md` *before* setting up API access; (2) preview a run with
`--dry-run` with no credential; (3) recover from a fat-fingered `PRP_AGENT_HARNESS=claude-code`.

**User Journey**: INSTALLATION Quick Start → user can `--validate-prd` immediately (pre-auth) →
CONFIGURATION explains the preflight gates agent runs only → CLI_REFERENCE shows exit codes 0/1 for
`--validate-prd` and the credential-free annotation → if they set `claude-code`, they get one
actionable line, not a stack trace.

**Pain Points Addressed**: The docs currently imply credentials are required to lint a local file
(misleading), conflate the `--validate-prd` exit code with code 2, and don't mention the clean
harness-mismatch error path.

## Why

- **Business value**: Closes the documentation-accuracy gap flagged in
  `architecture/system_context.md §7` (the "Documentation surface to sync (Mode B)" list, which
  enumerates exactly these three docs + README). Without these edits the docs actively mislead users
  — the exact UX problem Issue 1 of bugfix 002 was filed against.
- **Integration**: The three `docs/*.md` are the structured reference companions to `README.md`
  (synced in the COMPLETE sibling S1). They must stay consistent with the completed source changes
  (P1.M1.T1 / P1.M1.T2) and with README.md. This subtask is the `docs/` half; do not duplicate S1's
  README work.
- **Scope discipline**: KEEP EDITS MINIMAL and tone-consistent. Do NOT restate the PRD, do NOT
  document the preflight's internal ordering, do NOT fix unrelated pre-existing staleness (e.g. the
  stale `ANTHROPIC_AUTH_TOKEN=zk-xxxxx` example in INSTALLATION Quick Start — out of scope), and do
  NOT touch README.md or any source/test files.

## What

Make the following **minimal** edits across the three files. Exact current text + line numbers are
given in "All Needed Context" so each edit is a precise, unique find/replace. Suggested wording is a
starting point — the implementer may rephrase as long as the three facts (credential-free local
modes; `--validate-prd` exit 0/1 not 2; clean harness-mismatch error) are conveyed and the tone
matches.

### docs/CLI_REFERENCE.md

- **Edit C1 — Special Modes → "PRD Validation Only" (~line 142)** [REQUIRED]: The sentence
  "Validates the PRD syntax and structure without running the pipeline. Exits with code 0 if valid,
  1 if invalid." is correct. Append a credential-free note, e.g. "It makes no API calls and requires
  no credential."
- **Edit C2 — Special Modes → "Dry Run (Preview)" (~line 133)** [REQUIRED]: Add a sentence noting
  `--dry-run` makes no API calls and requires no credential.
- **Edit C3 — Boolean Flags table (~line 184 / 189)** [REQUIRED]: Annotate the `--dry-run` and
  `--validate-prd` Description cells with "(no credential required)" / "(no agent, no credential)".
- **Edit C4 — Flag Details bullets (~line 195 / 205)** [RECOMMENDED]: Add "no credential required"
  to the `--dry-run` and `--validate-prd` detail bullets.
- **Edit C5 — Exit Codes (~line 243)** [REQUIRED — consistency fix]: The row claims code 2
  (`VALIDATION_ERROR`) applies to `--validate-prd`. The ACTUAL behavior is **exit 1** for an invalid
  PRD, exit 0 for valid (src/index.ts: `return result.valid ? 0 : 1`). Make the table consistent:
  `--validate-prd` returns **0 valid / 1 invalid**, NOT 2. (Remove or correct the code-2 claim for
  `--validate-prd`; keep code 130/interrupted and code 0/1 as-is.)

### docs/CONFIGURATION.md

- **Edit F1 — Agent Runtime (Harness) note (~line 127)** [REQUIRED]: Refine "The pipeline validates
  this at startup and fails fast with a configuration error." to scope it: the harness/provider
  validation and the auth preflight gate **agent-invoking runs only**; `--validate-prd` and
  `--dry-run` are exempt (credential-free).
- **Edit F2 — Boolean Flags table (~line 209 / 214)** [REQUIRED]: Annotate `--dry-run` and
  `--validate-prd` Description cells "(no credential required)".
- **Edit F3 — Quick Reference auth footnote (~line 26)** [REQUIRED]: The footnote states a credential
  is required for the default path. Append an exemption sentence: the local-only modes
  `--validate-prd` / `--dry-run` run without any credential.
- **Edit F4 — Common Gotchas "Using claude-code with a z.ai key" (~line 534)** [REQUIRED]: The entry
  says "Startup fails fast with a harness/provider configuration error." Refine to note it is a
  **single actionable message + exit 1 (no raw stack trace)** and that the message names both
  remediations (switch harness to `pi` OR switch models to `anthropic/*`).

### docs/INSTALLATION.md

- **Edit I1 — Quick Start step 4 "Configure authentication" (~line 65)** [REQUIRED]: Reflect that a
  new user can run `--validate-prd` to lint their PRD **before** configuring API access (the natural
  first step the bug restored). Insert a credential-free validation step before "Configure
  authentication", e.g. a small step/note: "Optionally validate your PRD first (no credential
  needed): `npm run dev -- --prd ./PRD.md --validate-prd`".
- **Edit I2 — "Authentication at startup" block (~line 302–318)** [REQUIRED]: The block is accurate
  for agent runs ("aborts ... before any session directory is created or any agent is invoked
  (PRD §9.2.7)"). Append the local-mode exemption: `--validate-prd` and `--dry-run` bypass the
  preflight (they make no API calls), so they run with no credential configured.

### Success Criteria

- [ ] All three docs convey that `--validate-prd` and `--dry-run` are credential-free (CLI_REF
      Special Modes + table + details; CONFIG flag table + footnote; INSTALL Quick Start + preflight).
- [ ] CLI_REFERENCE Exit Codes table reflects `--validate-prd` = **0 valid / 1 invalid** (not 2).
- [ ] CONFIGURATION + the claude-code+zai gotcha describe the clean one-line error + exit 1 (no raw
      stack trace pasted).
- [ ] INSTALLATION onboarding sequence shows PRD validation as a pre-auth first step.
- [ ] No stale wording remains that implies credentials are required for local modes.
- [ ] All three files pass `npx prettier --check`; no broken internal anchors.
- [ ] No edits outside the three `docs/*.md` files; PRD not restated; README.md untouched.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they implement this successfully?_
**Yes** — every edit target is pinned to its exact current text and line number, the three
source-verified facts are stated with their evidence (file:line + verbatim error message), and
suggested wording is provided. This is a documentation edit; the only judgment required is tone
consistency and prettier-cleanliness.

### Documentation & References

```yaml
# MUST READ — the three files being edited (the ONLY files you may modify)
- file: docs/CLI_REFERENCE.md
  why: Edit targets C1–C5 (Special Modes ~127/142; Boolean Flags table ~184/189; Flag Details
        ~195/205; Exit Codes ~243).
  gotcha: The Exit Codes row at line 243 claims code 2 (VALIDATION_ERROR) for --validate-prd, but the
          ACTUAL behavior is exit 1 invalid / exit 0 valid. Fix this inconsistency (Edit C5).

- file: docs/CONFIGURATION.md
  why: Edit targets F1–F4 (Agent Runtime note ~127; Boolean Flags table ~209/214; Quick Ref footnote
        ~26; claude-code+zai gotcha ~534).
  gotcha: The footnote (~26) and the harness note (~127) both imply startup validation is universal;
          scope them to agent-invoking runs and exempt the two local modes.

- file: docs/INSTALLATION.md
  why: Edit targets I1–I2 (Quick Start step 4 ~65; "Authentication at startup" ~302–318).
  gotcha: Do NOT touch the stale .env example (~line 84, ANTHROPIC_AUTH_TOKEN=zk-xxxxx) — it is
          PRE-EXISTING and out of scope. "Keep edits surgical."

# MUST READ — the documentation surface that named this sync target
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  why: §7 enumerates the docs that read stale after this changeset and what each needs.
  section: "## 7. Documentation surface to sync (Mode B — final task)"

# MUST READ — the sibling README task (COMPLETE) that sets the convention to mirror
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/P1M1T3S1/PRP.md
  why: Establishes the tone (short, imperative, code-fenced remediations), the verified-behavior
        framing, the prettier-cleanliness requirement, and the "do NOT paste the raw stack trace"
        rule. Its "All Needed Context" already verifies the src/index.ts ordering + main().catch().
        Mirror that style for the docs/ files. Do NOT duplicate README edits.
  critical: S1 owns README.md; S2 (this task) owns the three docs/*.md. Do not cross-edit.

# VERIFIED BEHAVIOR 1 — local modes run credential-free (proof the doc claim is true)
- file: src/index.ts
  why: main() ordering proves --validate-prd / --dry-run early-return BEFORE runAuthPreflight().
        Line 127 configureEnvironment(); line 130 root logger; line 142 `if (args.dryRun)` → logs
        "🔍 DRY RUN - would execute with:" → return 0; line 156 `if (args.validatePrd)` → logs
        `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}` (167) → returns 0/1; ONLY THEN line 207
        configureHarness(); line 212 runAuthPreflight(); line 217 ensureHarnessInitialized().
  critical: Do NOT claim "--validate-prd exits 0 always" — it exits 1 if the PRD is INVALID. The
            credential-free guarantee is about AUTH, not validity. Word it "runs without any
            credential" / "validates the PRD", never "always succeeds".

# VERIFIED BEHAVIOR 2 — --validate-prd exit code is 0 valid / 1 invalid (NOT 2)
- file: src/index.ts
  why: The validatePrd branch returns `result.valid ? 0 : 1`. There is NO code-2 path for
        --validate-prd. This is the factual basis for Edit C5 (fix the Exit Codes table).
  critical: The CLI_REFERENCE Exit Codes row claiming code 2 (VALIDATION_ERROR) for --validate-prd
            is STALE/WRONG. Correct it to 0 valid / 1 invalid.

# VERIFIED BEHAVIOR 3 — claude-code + zai now fails with a CLEAN one-line error (Issue 2 fix)
- file: src/index.ts
  why: main().catch() (lines 334–344) renders HarnessProviderMismatchError (line 339) as
        `❌ <message>` + exit 1 — the SAME clean handler as AuthPreflightError (line 335). The old
        raw Node stack trace ("Node.js v26.2.0" banner) is GONE because configureHarness() was
        moved out of module-eval scope (P1.M1.T2.S1) and is now called explicitly inside main() at
        line 207 (after the local-mode early-returns, before the preflight).
  critical: Do NOT document/paste the pre-fix raw stack trace — it is stale. The doc must describe
            the clean one-line error + exit 1.

# VERIFIED FACT — the EXACT HarnessProviderMismatchError message (use/paraphrase in docs)
- file: src/config/types.ts
  why: 'Line 155–157 builds: "Harness ''claude-code'' is incompatible with provider ''zai''
        (PRD §9.2.4). Switch the harness to ''pi'' (PRP_AGENT_HARNESS=pi) or switch the model
        provider to anthropic/* models."' The message already contains BOTH remediations — the docs
        should reflect this (no need to invent new remediation steps).
  critical: AuthPreflightError prefix (types.ts:229): "Authentication preflight failed: no
            credential configured for provider ''<provider>''" — both errors render as `❌ <msg>`.

# VERIFIED FACT — --validate-prd is a real standalone boolean (distinct from --mode validate)
- file: src/cli/index.ts
  why: Registers `--validate-prd` (option `validatePrd: boolean`). It is NOT the same as
        `--mode validate`. The docs must keep them distinct (CLI_REFERENCE already lists both; do
        not merge or drop either).
```

### Current Codebase tree (relevant slice)

```bash
docs/CLI_REFERENCE.md    # <-- MODIFY (C1–C5)
docs/CONFIGURATION.md    # <-- MODIFY (F1–F4)
docs/INSTALLATION.md     # <-- MODIFY (I1–I2)
README.md                # NOT this subtask — owned by P1.M1.T3.S1 (COMPLETE); do not touch
src/index.ts             # READ-ONLY evidence: main() ordering + main().catch() handler
src/config/types.ts      # READ-ONLY evidence: exact HarnessProviderMismatchError message
src/cli/index.ts         # READ-ONLY evidence: --validate-prd is a real boolean flag
```

### Desired Codebase tree with files to be changed

```bash
docs/CLI_REFERENCE.md    # MODIFIED — Edits C1–C5
docs/CONFIGURATION.md    # MODIFIED — Edits F1–F4
docs/INSTALLATION.md     # MODIFIED — Edits I1–I2
# (no other files touched)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- GOTCHA 1 — prettier lints these docs. All three files match the glob
     "**/*.{ts,js,json,md,yml,yaml}", so `npm run format:check` MUST pass. The flag tables are
     pipe-aligned — when you extend a Description cell, preserve/match the existing pipe padding or
     prettier will reformat and your edit will look like a rewrite. Run `npx prettier --write <file>`
     and re-read the diff if format:check complains, to ensure intent was preserved. -->

<!-- GOTCHA 2 — Exit Codes consistency (CLI_REFERENCE). Line 243 claims code 2 (VALIDATION_ERROR)
     for --validate-prd. ACTUAL behavior is exit 1 invalid / 0 valid (src/index.ts). This is the one
     factual correction in scope — fix it; don't leave the contradiction. -->

<!-- GOTCHA 3 — do NOT claim --validate-prd "exits 0". It exits 0 on a VALID PRD and 1 on an INVALID
     one. The guarantee is "no credential required", NOT "always succeeds". -->

<!-- GOTCHA 4 — do NOT paste the old raw Node stack trace for the claude-code+zai case. That was the
     PRE-fix bug (Issue 2). The current behavior is a clean `❌ <message>` + exit 1, and the message
     already names both remediations (switch harness to pi OR switch to anthropic/* models). -->

<!-- GOTCHA 5 — keep anchor links resolvable. CLI_REFERENCE links to ./CONFIGURATION.md and
     ./INSTALLATION.md; CONFIGURATION links to ./INSTALLATION.md and the Harness Guide; do not
     rename section headings you link to/from (e.g. "Authentication at startup"). -->

<!-- GOTCHA 6 — do NOT conflate `--validate-prd` (standalone boolean) with `--mode validate` (a mode
     value). They are separate mechanisms; keep both documented distinctly. -->

<!-- GOTCHA 7 — SCOPE. Edit ONLY docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, docs/INSTALLATION.md.
     README.md is P1.M1.T3.S1 (done). The stale ANTHROPIC_AUTH_TOKEN=zk-xxxxx example in
     INSTALLATION Quick Start (~line 84) is PRE-EXISTING and OUT OF SCOPE — leave it. No source,
     test, or .env.example changes. -->
```

## Implementation Blueprint

### Data models and structure

None — documentation only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the evidence files to confirm current behavior (do NOT edit yet)
  - READ src/index.ts main() ordering: configureEnvironment (127) → root logger (130) →
        --dry-run early-return (142-152) → --validate-prd early-return (156-167, returns valid?0:1)
        → configureHarness (207) → runAuthPreflight (212) → ensureHarnessInitialized (217).
  - READ src/index.ts main().catch() (334-344): HarnessProviderMismatchError (339) renders as
        `❌ <message>` + exit 1 (clean, same handler as AuthPreflightError at 335).
  - READ src/config/types.ts:155-157 for the EXACT mismatch message (both remediations inline).
  - READ the three docs at the pinned anchors (lines cited above under "What" / References).

Task 2: EDIT docs/CLI_REFERENCE.md — Edits C1–C5
  - C1 (~142): append credential-free note to the "PRD Validation Only" sentence.
  - C2 (~133): add a credential-free sentence to the "Dry Run (Preview)" block.
  - C3 (~184/189): annotate --dry-run and --validate-prd table Description cells.
  - C4 (~195/205) [recommended]: add "no credential required" to the Flag Details bullets.
  - C5 (~243): FIX the Exit Codes inconsistency — --validate-prd = 0 valid / 1 invalid (NOT 2).
  - MATCH existing pipe padding so prettier stays green.

Task 3: EDIT docs/CONFIGURATION.md — Edits F1–F4
  - F1 (~127): scope the harness/provider "fails fast" note to agent-invoking runs; exempt local modes.
  - F2 (~209/214): annotate --dry-run and --validate-prd table Description cells.
  - F3 (~26): append the local-mode exemption to the Quick Reference auth footnote.
  - F4 (~534): refine the claude-code+zai gotcha to "single actionable message + exit 1, no stack
        trace" and note both remediations.
  - PRESERVE footnote markers (\*) and table alignment.

Task 4: EDIT docs/INSTALLATION.md — Edits I1–I2
  - I1 (~65, Quick Start step 4): insert/reflect a credential-free PRD-validation step BEFORE
        "Configure authentication" (the natural first step the bug restored).
  - I2 (~302-318, "Authentication at startup"): append the exemption that --validate-prd / --dry-run
        bypass the preflight (no API calls) and run with no credential.
  - DO NOT touch the stale ANTHROPIC_AUTH_TOKEN example (~84) — out of scope.

Task 5: VALIDATE (do not skip)
  - `npx prettier --check docs/CLI_REFERENCE.md docs/CONFIGURATION.md docs/INSTALLATION.md` MUST pass.
  - `npm run format:check` MUST pass (whole-project glob).
  - (Optional) `npx markdownlint docs/CLI_REFERENCE.md docs/CONFIGURATION.md docs/INSTALLATION.md`.
  - Manual: re-read each edited region for tone consistency and that no stale wording remains.
```

### Implementation Patterns & Key Details

Reference snippets (copy/adapt; match surrounding tone and pipe padding):

```markdown
<!-- C1 — CLI_REFERENCE Special Modes → "PRD Validation Only" (append to existing sentence) -->
Validates the PRD syntax and structure without running the pipeline. Exits with code 0 if valid,
1 if invalid. It makes no API calls and **requires no credential**, so you can run it before
configuring API access.
```

```markdown
<!-- C2 — CLI_REFERENCE Special Modes → "Dry Run (Preview)" (append a sentence) -->
`--dry-run` makes no API calls and requires no credential — it parses the PRD and prints the plan.
```

```markdown
<!-- C3 — CLI_REFERENCE Boolean Flags table (match existing pipe widths) -->
| `--dry-run`           | boolean | false   | Show plan without executing (no credential required)          |
| `--validate-prd`      | boolean | false   | Validate PRD and exit without running pipeline (no credential)|
```

```markdown
<!-- C5 — CLI_REFERENCE Exit Codes: correct the --validate-prd claim.
     The row currently says code 2 (VALIDATION_ERROR) applies to --validate-prd; that is wrong.
     Actual: --validate-prd returns 0 (valid) / 1 (invalid). Reword the code-1 detail to include
     "an invalid PRD when using --validate-prd" and remove --validate-prd from any code-2 row. -->
```

```markdown
<!-- F1 — CONFIGURATION Agent Runtime (Harness) note (~127). Replace the tail
     "...validates this at startup and fails fast with a configuration error." with: -->
...validates this at startup (on agent-invoking runs) and fails fast with a configuration error.
The pure-local modes `--validate-prd` and `--dry-run` make no API calls and bypass this check.
```

```markdown
<!-- F3 — CONFIGURATION Quick Reference footnote (~26). Append to the existing \*Required line: -->
...must be set for the default path. The pure-local modes `--validate-prd` and `--dry-run` make no
API calls and run without any credential.
```

```markdown
<!-- F4 — CONFIGURATION Common Gotchas "Using claude-code with a z.ai key" (~534). Refine to: -->
Startup fails fast with a single actionable message and exit code 1 (no raw stack trace). The
message names both fixes: switch the harness to `pi` (`PRP_AGENT_HARNESS=pi`) or switch the model
provider to `anthropic/*` models (which also requires an Anthropic credential).
```

```markdown
<!-- I1 — INSTALLATION Quick Start: insert a credential-free validation step before step 4. -->
4. **(Optional) Validate your PRD — no credential needed**

   You can lint your PRD before configuring any API access:

   ```bash
   npm run dev -- --prd ./PRD.md --validate-prd
   # → Status: ✅ VALID (exit 0)   or   ❌ INVALID (exit 1)
   ```

   (Renumber the subsequent "Configure authentication" step accordingly.)
```

```markdown
<!-- I2 — INSTALLATION "Authentication at startup" (~302-318). Append: -->
**Local-only modes are exempt.** `--validate-prd` and `--dry-run` make no API calls and bypass the
auth preflight entirely, so they run with no credential configured (useful for validating a PRD
before setting up API access).
```

### Integration Points

```yaml
NO code / config / build changes. Documentation-only:
  - files: docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, docs/INSTALLATION.md (the ONLY files modified)
  - prettier glob includes "**/*.md" → `npm run format:check` MUST pass after edits.
  - markdownlint-cli is a devDependency → optional `npx markdownlint docs/*.md`.
ANCHOR SAFETY:
  - do not rename linked section headings ("Authentication at startup", "Exit Codes", etc.).
SCOPE BOUNDARY (critical):
  - README.md is P1.M1.T3.S1 (COMPLETE) — do NOT edit.
  - The stale ANTHROPIC_AUTH_TOKEN example in INSTALLATION Quick Start (~84) is out of scope — leave it.
  - No source / test / .env.example changes.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Prettier check — all three docs ARE in the glob ("**/*.{ts,js,json,md,yml,yaml}").
npx prettier --check docs/CLI_REFERENCE.md docs/CONFIGURATION.md docs/INSTALLATION.md
# Expected: all three pass. If a file would be reformatted, run `npx prettier --write <file>` then
# RE-READ the diff to confirm intent was preserved (especially pipe-aligned tables and footnote
# escape sequences), and re-run --check.

# Whole-project format gate (used by CI / `npm run validate`).
npm run format:check
# Expected: clean.

# Optional markdown lint.
npx markdownlint docs/CLI_REFERENCE.md docs/CONFIGURATION.md docs/INSTALLATION.md
# Expected: clean, or only pre-existing warnings unrelated to your edits.
```

### Level 2: Unit Tests

N/A — documentation-only; no test coverage applies. (Do not add tests for prose.)

### Level 3: Integration / Behavioral Verification of the DOC CLAIMS

The docs must describe reality. Before finalizing, confirm each claim against the running source:

```bash
# Claim 1: --validate-prd runs credential-free; exit 0 on a VALID PRD, exit 1 on INVALID.
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" \
    npm run dev -- --prd ./PRD.md --validate-prd
echo "exit=$?"   # Expected: exit=0 and stdout contains "Status: ✅ VALID"
rm -rf "$TMP"

# Claim 2: --dry-run runs credential-free and exits 0.
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" \
    npm run dev -- --prd ./PRD.md --dry-run
echo "exit=$?"   # Expected: exit=0 and stdout contains "🔍 DRY RUN"
rm -rf "$TMP"

# Claim 3: claude-code + default zai → clean ONE-line error, exit 1, NO "Node.js v" stack banner.
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" PRP_AGENT_HARNESS=claude-code \
    npm run dev -- --prd ./PRD.md --dry-run 2>&1 | tee /tmp/cc.out
echo "exit=${PIPESTATUS[0]}"                                                    # Expected: 1
grep -c "incompatible with provider" /tmp/cc.out                                # Expected: >=1
grep -c "Node.js v" /tmp/cc.out                                                 # Expected: 0 (no raw banner)
rm -rf "$TMP"
# If all three claims hold, the doc edits are accurate. If any fails, STOP — the source fix
# (P1.M1.T1/T2) may not be deployed and the docs would be wrong; re-verify before shipping.
```

> NOTE: These are SOURCE checks (`npm run dev` = tsx on src). The bugfix's own acceptance tests
> (P1.M1.T1.S2, P1.M1.T2.S3) already lock this in on the BUILT `dist/index.js`. You do not need to
> rebuild; these commands just confirm the doc claims match current behavior.

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual readability review — re-read each edited region end-to-end:
#   CLI_REFERENCE: Special Modes (C1/C2), flag table (C3), flag details (C4), Exit Codes (C5).
#   CONFIGURATION: harness note (F1), flag table (F2), footnote (F3), claude-code gotcha (F4).
#   INSTALLATION: Quick Start validation step (I1), preflight block (I2).
#
# Cross-doc consistency: --validate-prd is described as credential-free in ALL THREE docs, and its
# exit code (0 valid / 1 invalid) is identical everywhere (no doc says 2).
#
# Anchor check: verify intra-doc and cross-doc links still resolve (no renamed headings).
#
# Tone check: ensure no paragraph reads like a PRD dump (keep it user-facing and concise).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx prettier --check docs/CLI_REFERENCE.md docs/CONFIGURATION.md docs/INSTALLATION.md` passes.
- [ ] `npm run format:check` passes.
- [ ] (Optional) `npx markdownlint docs/*.md` clean or only pre-existing warnings.

### Feature Validation

- [ ] CLI_REFERENCE: `--validate-prd` / `--dry-run` annotated credential-free (C1–C4).
- [ ] CLI_REFERENCE: Exit Codes table corrected — `--validate-prd` = 0 valid / 1 invalid, NOT 2 (C5).
- [ ] CONFIGURATION: harness note + footnote scoped to agent runs; local modes exempt (F1/F3).
- [ ] CONFIGURATION: flag table annotated credential-free (F2).
- [ ] CONFIGURATION: claude-code+zai gotcha notes clean one-line error + exit 1 (F4).
- [ ] INSTALLATION: Quick Start shows credential-free PRD validation before auth (I1).
- [ ] INSTALLATION: preflight block states local modes bypass the preflight (I2).
- [ ] Doc claims verified against live behavior (Validation Loop Level 3, all three exit as stated).
- [ ] No stale "credentials required for local modes" / "exit code 2 for --validate-prd" wording remains.

### Code Quality Validation

- [ ] Tone consistent across all three docs (imperative, concise, code-fenced where helpful).
- [ ] No raw Node stack trace pasted (that was the pre-fix bug).
- [ ] No `--validate-prd` "always exits 0" claim (it exits 1 on an invalid PRD).
- [ ] No conflation of `--validate-prd` (boolean) with `--mode validate`.
- [ ] PRD not restated; edits minimal and surgical.

### Documentation & Deployment

- [ ] This IS the docs task (Mode B). The three `docs/*.md` are updated.
- [ ] README.md NOT touched (owned by P1.M1.T3.S1, COMPLETE).
- [ ] No source / test / .env.example changes (docs-only).
- [ ] No new env vars introduced.

---

## Anti-Patterns to Avoid

- ❌ Don't restate the PRD or document the preflight's internal ordering — keep it user-facing.
- ❌ Don't paste the pre-fix raw Node stack trace for the claude-code+zai case — it's stale.
- ❌ Don't claim `--validate-prd` "exits 0" unconditionally — it exits 1 on an invalid PRD.
- ❌ Don't leave the Exit Codes table claiming code 2 for `--validate-prd` — actual is 1 invalid / 0 valid.
- ❌ Don't conflate `--validate-prd` (standalone boolean) with `--mode validate` (a mode value).
- ❌ Don't touch `README.md` (P1.M1.T3.S1) or any source/test/`.env.example` file.
- ❌ Don't fix the unrelated stale `ANTHROPIC_AUTH_TOKEN=zk-xxxxx` example in INSTALLATION Quick Start
  — it's pre-existing and out of scope; keep edits surgical.
- ❌ Don't skip prettier — the three docs are in the format glob; misaligned table pipes will fail.
- ❌ Don't over-edit — minimal, tone-consistent changes; no rewrite of surrounding sections.

---

**Confidence Score: 9/10** — docs-only, every edit pinned to exact current text + line number, the
three source-verified facts (credential-free local modes; `--validate-prd` exit 0/1 not 2; clean
harness-mismatch error with the verbatim message) are all confirmed against `src/index.ts` /
`src/config/types.ts`, and the sibling README task already validated the established convention.
The only residual uncertainty is the implementer's exact rephrasing within the tone constraints.
