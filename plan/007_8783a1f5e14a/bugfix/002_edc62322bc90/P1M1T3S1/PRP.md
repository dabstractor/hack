# PRP — P1.M1.T3.S1: Update README.md (Configuration + Troubleshooting) re: credential-free local modes & clean harness error

> **Docs-only task (Mode B)** — the final changeset-documentation sync for bugfix 002.
> Source changes are already complete: P1.M1.T1 (Issue 1, preflight placement) and P1.M1.T2
> (Issue 2, clean harness/provider mismatch error). This subtask makes `README.md` consistent with
> the new startup behavior. It touches **only `README.md`** — `docs/CLI_REFERENCE.md`,
> `docs/CONFIGURATION.md`, `docs/INSTALLATION.md` are a **separate** subtask (P1.M1.T3.S2).

---

## Goal

**Feature Goal**: Bring `README.md` into agreement with the verified post-fix startup behavior so
no statement reads as stale:
1. The auth preflight (PRD §9.2.7) now gates **only agent-invoking runs**; the pure-local modes
   `--validate-prd` and `--dry-run` run **without any credential** (they make zero API calls).
2. An invalid `PRP_AGENT_HARNESS=claude-code` + default `zai` configuration now fails at startup
   with a **single actionable message and exit 1** (no raw Node stack trace).

**Deliverable**: Two-to-three small, tone-consistent edits to `README.md`:
- (a) a clarification in the Configuration prerequisite footnote (~line 242) that the preflight
      gates only agent-invoking runs, and that `--validate-prd` / `--dry-run` run credential-free;
- (b) an annotation on the `--dry-run` CLI-table row (and optionally a new `--validate-prd` row,
      since that flag is real but currently absent from the table) noting "no credential required";
- (c) an optional short Troubleshooting note that `claude-code` + default `zai` models fails fast
      with one actionable message (switch harness → `pi`, or switch models → `anthropic/*`).

**Success Definition**:
- `README.md` no longer claims the preflight "aborts ... if none is present" **unconditionally**;
  it scopes that statement to agent-invoking runs.
- A reader can determine from `README.md` alone that `--validate-prd` and `--dry-run` need no API
  credential, and that a `claude-code`+`zai` misconfiguration produces a clean one-line error.
- Markdown is valid; no internal anchor links are broken (the Configuration footnote links to
  `#troubleshooting`). Edits are minimal and match the existing tone. No PRD is restated.

## User Persona (if applicable)

**Target User**: A new contributor / first-time user onboarding with `README.md`.

**Use Case**: (1) Validate a `PRD.md` *before* setting up API access; (2) preview a run with
`--dry-run`; (3) recover from a fat-fingered `PRP_AGENT_HARNESS=claude-code`.

**User Journey**: User reads Quick Start → Configuration → runs `--validate-prd` with no cred →
expects it to work (it now does). If they set `PRP_AGENT_HARNESS=claude-code`, they get a single
actionable line, not a stack trace.

**Pain Points Addressed**: The old footnote implied API access is required to lint a local file
(misleading); there was no hint that local modes are exempt, nor that the harness mismatch is a
clean failure.

## Why

- **Business value**: Closes the documentation-accuracy gap flagged in
  `architecture/system_context.md §7` (the documentation surface to sync). Without these edits
  `README.md` actively misleads users (it instructs `pi /login` / `ZAI_API_KEY` for operations
  that need no credential) — the exact UX problem Issue 1 of bugfix 002 was filed against.
- **Integration**: README is the primary onboarding doc; it must stay consistent with the
  completed source changes (P1.M1.T1 / P1.M1.T2) and in lock-step with the sibling docs sync
  (P1.M1.T3.S2 covers `docs/`). This subtask is the README half; do not duplicate S2's work.
- **Scope discipline**: KEEP EDITS MINIMAL and consistent with the existing tone. Do NOT restate
  the full PRD, do NOT document the preflight's internal ordering, and do NOT touch `docs/*` files.

## What

Make the following **minimal** edits to `README.md` only. Exact anchor text and line numbers are
given in "All Needed Context" so each edit is a precise, unique find/replace. The recommended
wording below is a suggestion — the implementer may rephrase as long as the two facts (credential-
free local modes; clean harness-mismatch error) are conveyed and the tone matches.

### Edit (a) — Configuration prerequisite footnote (~line 242) [REQUIRED]

The current footnote ends: *"A startup preflight aborts with an actionable error if none is present
(see [Troubleshooting](#troubleshooting))."* This is now true **only for agent-invoking runs**.
Scope it and add the local-mode exemption. Example replacement tail:

> A startup preflight (PRD §9.2.7) aborts with an actionable error if none is present **for runs
> that invoke an agent** (see [Troubleshooting](#troubleshooting)). The pure-local modes
> `--validate-prd` and `--dry-run` make no API calls and run **without any credential**.

(Keep the existing `_*`/`**` footnote markers and the rest of the footnote verbatim.)

### Edit (b) — CLI Options table, `--dry-run` row (~line 220) + `--validate-prd` row [REQUIRED]

Annotate the existing `--dry-run` row so "no credential required" is visible at the point of use.
The current row is:

```markdown
| `--dry-run`          | `-d`  | boolean | false      | Show plan without executing                               |
```

Suggested: append "(no credential required)" to the Description, e.g.
`Show plan without executing (no credential required)`.

**Flag-discovery note (important):** `--validate-prd` is a **real standalone boolean flag**
(`src/cli/index.ts:289`, parsed into `args.validatePrd`), but it is **NOT currently in the README
CLI Options table** (the table only lists `--mode <mode>` with a `validate` value, which is a
*different* mechanism). To make Edit (a)'s claim discoverable, **add a new table row** for
`--validate-prd` immediately after the `--dry-run` row, e.g.:

```markdown
| `--validate-prd`     | -     | boolean | false      | Validate the PRD and exit (no agent, no credential)      |
```

(Place it adjacent to `--dry-run` so both local modes sit together. Keep the column alignment
style of the surrounding table.)

### Edit (c) — Troubleshooting: claude-code + zai clean error (~after the preflight block, line ~372–390) [OPTIONAL but recommended]

Add a short note that an invalid `PRP_AGENT_HARNESS=claude-code` combined with the default `zai`
models fails fast at startup with **a single actionable message and exit 1** (not a stack trace),
and name both remediations. Suggested block (place it as its own bolded heading after the existing
`"Authentication preflight failed" startup abort` block):

> **"`claude-code` harness + default `zai` models" startup abort**
>
> `claude-code` is Anthropic-only, so pairing it with the default `zai` models is an invalid
> configuration. It now fails at startup with one actionable message and exit code 1 (not a raw
> stack trace). Fix it one of two ways:
>
> ```bash
> # Option A: switch to the default harness (vendor-neutral; runs any provider)
> unset PRP_AGENT_HARNESS        # or: export PRP_AGENT_HARNESS=pi
>
> # Option B: keep claude-code and switch to Anthropic models
> export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
> export ANTHROPIC_API_KEY="your-anthropic-key-here"
> ```

(Do NOT paste the raw Node stack trace from the pre-fix bug — that is no longer the behavior.)

### Success Criteria

- [ ] Configuration footnote (~line 242) scopes the preflight abort to agent-invoking runs and
      names `--validate-prd` / `--dry-run` as credential-free.
- [ ] CLI Options table: `--dry-run` row annotated "no credential required" AND a new
      `--validate-prd` row added (or, at minimum, the footnote conveys it — but the table row is
      preferred for discoverability).
- [ ] Troubleshooting has a short claude-code+zai clean-error note (both remediations named).
- [ ] No stale wording remains that implies credentials are required for local modes.
- [ ] The `#troubleshooting` anchor link in the footnote still resolves (heading unchanged).
- [ ] No edits outside `README.md`; PRD not restated.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they implement this successfully?_
**Yes** — every edit target is pinned to its exact current text and line number, the two source-
verified facts are stated with their evidence (file:line), and suggested wording is provided. This
is a documentation edit; the only judgment required is tone consistency.

### Documentation & References

```yaml
# MUST READ — the file being edited (the only file you may modify)
- file: README.md
  why: The single deliverable. Make Edits (a), (b), and (c) only.
  pattern: Match the existing tone — short, imperative, code-fenced remediations, bold inline
            `code` for env/flag names, and a single blank line between blocks. Existing examples:
            the "How It Works" auth list and the "Authentication preflight failed" block (line 372).
  gotcha: The Configuration footnote is ONE long italic line (line 242) wrapped in _..._. Edit it
          as a single line; don't break the surrounding _ markers or the \*/\*\* escape sequences.
          The CLI table uses padded pipes for alignment — match the existing column widths.

# MUST READ — the documentation surface that named this sync target
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  why: §7 enumerates the docs that read stale after this changeset and what each needs.
  section: "## 7. Documentation surface to sync (Mode B — final task)" — README.md bullet.

# VERIFIED BEHAVIOR 1 — local modes run credential-free (proof the doc claim is true)
- file: src/index.ts
  why: main() ordering proves --validate-prd / --dry-run early-return BEFORE runAuthPreflight().
        Line 127 configureEnvironment(); line 130 root logger; line 142 `if (args.dryRun)` → logs
        "🔍 DRY RUN - would execute with:" → return 0 (line 152); line 156 `if (args.validatePrd)`
        → logs `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}` (line 167) → returns 0/1;
        ONLY THEN line 207 configureHarness(); line 212 runAuthPreflight(); line 217
        ensureHarnessInitialized(). So no credential is consulted for the two local modes.
  critical: Do NOT claim "--validate-prd exits 0 always" — it exits 1 if the PRD is INVALID
            (result.valid === false). The credential-free guarantee is about AUTH, not validity.
            Word it as "runs without any credential" / "validates the PRD", not "always succeeds".

# VERIFIED BEHAVIOR 2 — the two real stdout markers the doc should reference
- file: src/index.ts
  why: --dry-run prints a line beginning "🔍 DRY RUN - would execute with:" (line ~143);
        --validate-prd prints "Status: ✅ VALID" or "Status: ❌ INVALID" (line 167). Use these
        exact strings only if you choose to echo them; otherwise the simpler "no credential
        required" wording suffices.

# VERIFIED BEHAVIOR 3 — claude-code + zai now fails with a CLEAN one-line error (Issue 2 fix)
- file: src/index.ts
  why: main().catch() (lines 334-344) renders HarnessProviderMismatchError as `❌ <message>` +
        exit 1 — the SAME clean handler as AuthPreflightError. The error names the harness, the
        provider, §9.2.4, and both remediations (switch harness to `pi` OR switch to `anthropic/*`
        models). The old raw Node stack trace ("Node.js v26.2.0" banner) is GONE because
        configureHarness() was moved out of module-eval scope (P1.M1.T2.S1) and is now called
        explicitly inside main() at line 207 (after the local-mode early-returns, before the
        preflight).
  critical: Do NOT document/paste the pre-fix raw stack trace — that is stale and no longer the
            behavior. The doc must describe the clean one-line error + exit 1.

# VERIFIED FACT — --validate-prd is a real flag missing from the README CLI table
- file: src/cli/index.ts
  why: Line 289 registers `--validate-prd` (option `validatePrd: boolean` at line 94). The README
        CLI Options table (line 218) only lists `--mode <mode>` (value `validate`) — a DIFFERENT
        mechanism. This is why Edit (b) adds a dedicated `--validate-prd` row.
  gotcha: Don't conflate `--validate-prd` (standalone boolean) with `--mode validate`. They are
          separate. The README must list `--validate-prd` distinctly.
```

### Current Codebase tree (relevant slice)

```bash
README.md                  # <-- the ONLY file modified in this subtask
src/index.ts               # READ-ONLY evidence: main() ordering + main().catch() handler
src/cli/index.ts           # READ-ONLY evidence: --validate-prd flag (line 289), --dry-run
docs/CLI_REFERENCE.md      # NOT this subtask — owned by P1.M1.T3.S2
docs/CONFIGURATION.md      # NOT this subtask — owned by P1.M1.T3.S2
docs/INSTALLATION.md       # NOT this subtask — owned by P1.M1.T3.S2
```

### Desired Codebase tree with files to be changed

```bash
README.md                  # MODIFIED — Edits (a), (b), (c) only; no new files
# (no other files touched)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- GOTCHA 1 — the Configuration footnote is a single italic line with fragile escape sequences. -->
<!-- Line 242 is ONE line wrapped in _ ... _ and contains \*Required and \*\*Optional. Edit the
     tail only; preserve the leading _* and the trailing ._ and every internal \ escape. Breaking
     it across lines can render the italics wrong. -->

<!-- GOTCHA 2 — the CLI table is pipe-aligned. When you add the `--validate-prd` row and extend
     the `--dry-run` Description, match the existing pipe-padding style so `prettier --check`
     (run by `npm run format:check` / `npm run validate`) stays green. README.md IS in the
     prettier glob: "**/*.{ts,js,json,md,yml,yaml}". -->

<!-- GOTCHA 3 — do NOT claim --validate-prd "exits 0". It exits 0 only on a VALID PRD and 1 on an
     INVALID one. The guarantee is "no credential required", NOT "always succeeds". -->

<!-- GOTCHA 4 — do NOT paste the old raw Node stack trace for the claude-code+zai case. That was
     the PRE-fix bug (Issue 2). The current behavior is a clean `❌ <message>` + exit 1. -->

<!-- GOTCHA 5 — keep the `#troubleshooting` anchor resolvable. The Configuration footnote links
     to it; don't rename the "### Troubleshooting" heading. -->

<!-- GOTCHA 6 — scope. This subtask is README.md ONLY. docs/CLI_REFERENCE.md, docs/CONFIGURATION.md,
     docs/INSTALLATION.md are P1.M1.T3.S2. Do not touch them here. -->
```

## Implementation Blueprint

### Data models and structure

None — documentation only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the three evidence files to confirm current behavior (do NOT edit yet)
  - READ src/index.ts main() ordering: configureEnvironment (127) → root logger (130) →
        --dry-run early-return (142-152) → --validate-prd early-return (156-167) →
        configureHarness (207) → runAuthPreflight (212) → ensureHarnessInitialized (217).
  - READ src/index.ts main().catch() (334-344): HarnessProviderMismatchError renders as
        `❌ <message>` + exit 1 (clean, same handler as AuthPreflightError).
  - READ src/cli/index.ts:289 to confirm `--validate-prd` is a real boolean flag.
  - READ README.md lines 218-220 (CLI table) and 242 (footnote) and 358-390 (Troubleshooting).

Task 2: EDIT README.md — Edit (a): Configuration footnote (~line 242)
  - MODIFY the tail of the single italic footnote line.
  - OLD TAIL: "A startup preflight aborts with an actionable error if none is present (see
        [Troubleshooting](#troubleshooting))."
  - NEW TAIL: scope the abort to agent-invoking runs; state --validate-prd / --dry-run run
        without any credential (suggested wording in the "What" section, Edit (a)).
  - PRESERVE the leading "_*Required ..." and trailing "._" and all \* / \*\* escapes.
  - PLACEMENT: same line (~242).

Task 3: EDIT README.md — Edit (b): CLI Options table (~lines 218-220)
  - ANNOTATE the `--dry-run` row Description to note "no credential required".
  - ADD a new `--validate-prd` row immediately after the `--dry-run` row.
  - MATCH the existing pipe-padding/column widths so prettier stays green.
  - DO NOT conflate with the `--mode <mode>` validate value (a different mechanism).

Task 4: EDIT README.md — Edit (c): Troubleshooting claude-code+zai note (~after line 390)
  - ADD a short bolded heading + 2-3 line explanation + a code block with BOTH remediations
        (unset/switch harness to `pi`  OR  switch models to `anthropic/*` + ANTHROPIC_API_KEY).
  - DESCRIBE the clean one-line error + exit 1 (NOT a stack trace).
  - PLACE it after the existing "Authentication preflight failed" block, before the next heading.

Task 5: VALIDATE (do not skip)
  - `npm run format:check` MUST pass (README.md is in the prettier glob).
  - `npm run lint` MUST pass (eslint may lint .md via plugin if configured; verify).
  - Manual: re-read the three edited regions for tone consistency and that no stale wording
        (e.g. "aborts if none is present" unqualified) remains.
```

### Implementation Patterns & Key Details

Reference snippets (copy/adapt; match surrounding tone):

```markdown
<!-- Edit (a) — footnote tail (replace ONLY the trailing sentence, keep everything before it) -->
... A startup preflight (PRD §9.2.7) aborts with an actionable error if none is present **for
runs that invoke an agent** (see [Troubleshooting](#troubleshooting)). The pure-local modes
`--validate-prd` and `--dry-run` make no API calls and run **without any credential**._
```

```markdown
<!-- Edit (b) — CLI table: annotate dry-run + add validate-prd row -->
| `--dry-run`          | `-d`  | boolean | false      | Show plan without executing (no credential required)  |
| `--validate-prd`     | -     | boolean | false      | Validate the PRD and exit (no agent, no credential)   |
```

```markdown
<!-- Edit (c) — Troubleshooting claude-code+zai clean error -->
**"`claude-code` harness + default `zai` models" startup abort**

`claude-code` is Anthropic-only, so pairing it with the default `zai` models is an invalid
configuration. It fails at startup with a single actionable message and exit code 1 (not a raw
stack trace). Fix it one of two ways:

```bash
# Option A: use the default, vendor-neutral harness (runs any provider)
unset PRP_AGENT_HARNESS        # or: export PRP_AGENT_HARNESS=pi

# Option B: keep claude-code and switch to Anthropic models
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_API_KEY="your-anthropic-key-here"
```
```

### Integration Points

```yaml
NO code / config / build changes. Documentation-only:
  - file: README.md (the ONLY file modified)
  - prettier glob includes "**/*.md" → `npm run format:check` MUST pass after edits.
  - eslint: README.md is not a .ts file, but if a markdownlint/eslint-md config exists, run it.
ANCHOR SAFETY:
  - the Configuration footnote links to #troubleshooting → keep the "### Troubleshooting" heading.
SCOPE BOUNDARY (critical):
  - docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, docs/INSTALLATION.md are P1.M1.T3.S2. Do NOT
    edit them in this subtask.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Prettier check — README.md IS in the glob ("**/*.{ts,js,json,md,yml,yaml}").
npx prettier --check README.md
# Expected: no changes needed. If it reports the file would be reformatting, run
#   npx prettier --write README.md   and re-read the diff to ensure intent was preserved
# (especially the pipe-aligned CLI table and the single-line italic footnote).

# Optional markdown lint (if markdownlint-cli is configured; it is a devDependency).
npx markdownlint README.md
# Expected: clean, or only pre-existing warnings unrelated to your edits.

# ESLint (project script) — primarily .ts, but run to be safe.
npm run lint
# Expected: clean (no .ts changed; README edits shouldn't affect it).
```

### Level 2: Unit Tests

N/A — documentation-only; no test coverage applies. (Do not add tests for prose.)

### Level 3: Integration / Behavioral Verification of the DOC CLAIMS

The docs must describe reality. Before finalizing, confirm each claim against the built source:

```bash
# Claim 1: --validate-prd runs credential-free and exits 0 on a VALID PRD.
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

# Claim 3: claude-code + default zai → clean one-line error, exit 1, NO "Node.js v" stack banner.
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" PRP_AGENT_HARNESS=claude-code \
    npm run dev -- --prd ./PRD.md --dry-run 2>&1 | tee /tmp/cc.out
echo "exit=${PIPESTATUS[0]}"   # Expected: 1
grep -c "HarnessProviderMismatchError\|incompatible with provider" /tmp/cc.out   # Expected: >=1
grep -c "Node.js v" /tmp/cc.out                                                 # Expected: 0 (no raw banner)
rm -rf "$TMP"
# If all three claims hold, the README edits are accurate. If any fails, STOP — the source fix
# (P1.M1.T1/T2) may not be deployed and the docs would be wrong; re-verify before shipping.
```

> NOTE: These are SOURCE checks (`npm run dev` = tsx on src). The bugfix's own acceptance tests
> (P1.M1.T1.S2, P1.M1.T2.S3) already lock this in on the BUILT `dist/index.js`. You do not need
> to rebuild; these commands just confirm the doc claims match current behavior.

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual readability review — re-read the three edited regions end-to-end:
#   1. Configuration footnote (~242): does it clearly scope the preflight to agent runs?
#   2. CLI Options table (~218-221): are --dry-run and --validate-prd both present & annotated?
#   3. Troubleshooting (~390): is the claude-code+zai note short, actionable, and stack-trace-free?
#
# Anchor check: click/verify the #troubleshooting link in the footnote still jumps to the heading.
#
# Tone check: ensure no paragraph reads like a PRD dump (keep it user-facing and concise).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx prettier --check README.md` passes (or `--write` applied + intent re-verified).
- [ ] `npm run lint` passes.
- [ ] (Optional) `npx markdownlint README.md` clean or only pre-existing warnings.

### Feature Validation

- [ ] Edit (a): footnote scopes preflight abort to agent-invoking runs; names credential-free
      `--validate-prd` / `--dry-run`.
- [ ] Edit (b): `--dry-run` row annotated; new `--validate-prd` row added (pipe-aligned).
- [ ] Edit (c): claude-code+zai clean-error note present with both remediations.
- [ ] Doc claims verified against live behavior (Validation Loop Level 3, all three exit as stated).
- [ ] No stale "aborts if none is present" unqualified wording remains.
- [ ] `#troubleshooting` anchor still resolves.

### Code Quality Validation

- [ ] Tone consistent with surrounding README sections (imperative, concise, code-fenced fixes).
- [ ] No raw Node stack trace pasted (that was the pre-fix bug).
- [ ] No `--validate-prd` "always exits 0" claim (it exits 1 on an invalid PRD).
- [ ] PRD not restated; edits minimal.

### Documentation & Deployment

- [ ] This IS the docs task (Mode B). README.md updated.
- [ ] `docs/*` files NOT touched (owned by P1.M1.T3.S2).
- [ ] No new env vars or code introduced (docs-only).

---

## Anti-Patterns to Avoid

- ❌ Don't restate the PRD or document the preflight's internal ordering — keep it user-facing.
- ❌ Don't paste the pre-fix raw Node stack trace for the claude-code+zai case — it's stale.
- ❌ Don't claim `--validate-prd` "exits 0" unconditionally — it exits 1 on an invalid PRD.
- ❌ Don't conflate `--validate-prd` (standalone boolean) with `--mode validate` (different).
- ❌ Don't touch `docs/CLI_REFERENCE.md`, `docs/CONFIGURATION.md`, or `docs/INSTALLATION.md` —
  those are P1.M1.T3.S2.
- ❌ Don't break the single-line italic Configuration footnote (preserve `_*` / `._` / `\*` escapes).
- ❌ Don't skip prettier — `README.md` is in the format glob; misaligned CLI-table pipes will fail.
- ❌ Don't over-edit — three minimal, tone-consistent changes; no rewrite of surrounding sections.
```
