# PRP — P1.M3.T2.S1: Sync changeset-level docs (README, CONFIGURATION, CLI_REFERENCE, ARCHITECTURE)

> Bugfix 001, **Mode B documentation sweep**. This bugfix landed three fixes — **BUG-001 (Critical, DONE)**:
> subcommands now resolve `plan/`/`PRD.md`/`.hack`/`.env` at the repo root via a `preAction` hook;
> **BUG-002 (Minor, DONE)**: `.hack` validation/secrets errors render as a clean single `❌` line (no stack);
> **BUG-003 (Minor, parallel = P1.M3.T1.S1)**: `commit.retry_delay_cap_ms ≥ retry_delay_ms` is now enforced in
> `validateHackTier`. The **external docs are out of sync**: `docs/ARCHITECTURE.md` still diagrams the chdir as
> a *sequential* step *after* `parseCLIArgs()` (the exact BUG-001 root-cause model); `docs/CONFIGURATION.md`
> lists the `[commit]` keys but never states the relational constraint is enforced; `docs/CLI_REFERENCE.md`'s
> subcommand section has no run-from-anywhere note; `README.md`'s "Running from Anywhere" section is accurate
> but doesn't explicitly cover all subcommands. This item edits **only the 4 docs** (NO source/test changes)
> to accurately reflect the three fixes. The architecture fix strategies (`architecture/bug_001/002/003_fix_strategy.md`)
> + the implemented source (`src/cli/index.ts:852` preAction hook; `src/index.ts:143` `getRepoRoot()` singleton;
> `src/config/hack-config.ts` `validateHackTier`) are the contract; this PRP fuses that contract with the
> **verbatim current doc text** at each edit site so the implementer edits precisely + minimally.

---

## Goal

**Feature Goal**: Bring `docs/CONFIGURATION.md`, `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, and
`README.md` into accurate alignment with the BUG-001/002/003 fixes — so a reader of the docs learns the
*actual* post-fix behavior: (1) every `hack` subcommand resolves at the repo root from any cwd; (2) `.hack`
misconfigurations surface as a clean single-line startup error (no stack trace); (3) the
`retry_delay_cap_ms ≥ retry_delay_ms` relational constraint is enforced at startup and by `hack config validate`.

**Deliverable**:
1. **`docs/CONFIGURATION.md`** — (a) add a relational-constraint note to the `.hack` schema-summary notes
   block (after the "Secrets policy" note); (b) append the `≥ COMMIT_RETRY_DELAY` constraint to the
   `COMMIT_RETRY_DELAY_CAP` env-var row; (c) add a one-sentence clean-rendering note (BUG-002) that a
   misconfigured `.hack` surfaces as a single actionable `❌` line at startup (no stack).
2. **`docs/CLI_REFERENCE.md`** — add a "Run from anywhere" note to the Task Management section enumerating
   that ALL subcommands (`task`/`status`/`cache`/`inspect`/`artifacts`/`validate-state`/`config`) resolve at
   the repo root regardless of invocation dir, via the `preAction` hook; `--repo-root` pins; outside-repo →
   `NotARepositoryError` exit 1.
3. **`docs/ARCHITECTURE.md`** — update the Bootstrap Layer (prose + mermaid diagram + step table) to reflect
   the `preAction` hook: the repo-root `chdir` runs DURING `program.parse()` (before each action handler), so
   subcommands resolve correctly; `main()` reads the cached `getRepoRoot()` singleton. Replace the now-false
   "parse THEN chdir" sequencing.
4. **`README.md`** — augment the "Running from Anywhere" section with ONE sentence enumerating that every
   subcommand (`task`/`status`/`cache`/`inspect`/`artifacts`/`validate-state`/`config`) resolves at the repo
   root — not just the default pipeline run.

**Success Definition**:
- The 4 docs no longer contain the now-false "parse → chdir" sequencing claim (ARCHITECTURE.md mermaid/step table).
- A reader learns from each doc the three post-fix behaviors; no doc contradicts the implemented source.
- All internal anchor links added/kept resolve (grep the target headings).
- No source file (`src/**`) or test file (`tests/**`) is modified; `npm run typecheck && npm run lint &&
  npm run format:check` stay clean (docs-only change → no code impact; run to confirm no accidental breakage).
- The 4 edited markdown files render cleanly (headings/tables/code fences intact; prettier `format:check`
  passes since the repo formats `.md`).

---

## User Persona (if applicable)

**Target User**: A developer/operator reading the docs to learn how `hack` resolves paths and validates its
config — e.g. "can I run `hack status` from a subdirectory?", "what happens if my `.hack` has a bad value?",
"does `retry_delay_cap_ms` have to exceed `retry_delay_ms`?".

**Use Case**: Run any `hack` subcommand from a nested subdirectory; trust that a misconfigured `.hack` fails
fast with a clear message; know the relational constraint is enforced.

**Pain Points Addressed**: Docs that describe a *broken* sequencing model (parse-then-chdir) that the fix
superseded; a missing enforcement note that leads users to believe an invalid cap is silently accepted.

---

## Why

- **The docs lag the fix.** ARCHITECTURE.md's Bootstrap Layer still shows the chdir as a sequential step
  *after* `parseCLIArgs()` — the precise model that BUG-001 proved FALSE (subcommand action handlers run
  during parse, before the chdir). Leaving it misleads anyone reasoning about the bootstrap order or
  debugging a subcommand path-resolution issue.
- **Contract OUTPUT point (2)/(3).** The bugfix's stated documentation output is that the changeset docs
  "accurately reflect: (1) all subcommands resolve at repo root; (2) config errors render cleanly; (3) the
  relational constraint is enforced." Today none of the three is documented in the user-facing docs.
- **Mode B = the documentation task.** BUG-001/002/003 carried Mode A (inline source comments); this is the
  dedicated changeset-level docs sweep — the ONLY item that touches the external `docs/*.md` + `README.md`.
- **Minimal + surgical.** Each edit is a note/sentence/table-row or a diagram/table refresh — no restructure,
  no new sections, no churn. The task instruction: "Keep changes minimal — only update what is now
  inaccurate or incomplete due to these three fixes."

---

## What

### User-visible behavior
None (documentation only). The docs now match the implemented behavior.

### Technical requirements (exact edits — VERBATIM prescribed text + sites)

> Each edit below quotes the **current** text (so the implementer finds the exact site) and the
> **replacement/addition**. `prettier --check` is enforced on `*.md` (package.json `format:check` globs
> `**/*.md`) → run `npm run fix` after editing so the formatter owns table/note alignment.

#### EDIT 1 — `docs/CONFIGURATION.md` — relational-constraint note (BUG-003) + clean-rendering note (BUG-002)

**Site A — the schema-summary notes block.** The block after the schema table currently ends with the
"Secrets policy" note (around line 110-113):
```
> **Secrets policy (PRD §9.7.6):** committable `.hack` (global + project tiers) refuses
> secret-bearing keys … (catches typos); type/range/enum mismatches are hard errors.
```
**ADD two new note paragraphs immediately after it** (same `> ` blockquote style), before the
`### \`hack config\` subcommand` heading:
```
> **Relational constraint (PRD §9.7.5):** `[commit] retry_delay_cap_ms` must be **≥**
> `retry_delay_ms` (the exponential-backoff cap can't be below the base delay). Both keys are
> individually validated as `int >= 0`; their cross-key relationship is enforced in
> `validateHackTier` (`src/config/hack-config.ts`) and rejected as a hard error (exit 1) at
> startup and by `hack config validate`. The check is **per-tier** (per-file); only a tier that
> sets both keys is checked.
>
> **Error rendering (§9.2.7 fail-fast):** a misconfigured `.hack` (type/range/enum/secrets/BOM or
> the relational violation) surfaces at startup as a single actionable `❌ <message>` line — no
> stack trace — via a dedicated clean arm, so a typo like `[tasks_lock] poll_ms = -5` reads as a
> clear user error rather than a deep runtime failure mid-pipeline.
```

**Site B — the `COMMIT_RETRY_DELAY_CAP` env-var row** (in the "Resilience Tuning" table, around line 240).
Current cell:
```
| `COMMIT_RETRY_DELAY_CAP` | No       | `120000`      | Maximum delay cap in milliseconds for stagecoach commit-message-generation backoff. See PRD §5.1.                                                                                                                                                                                                                                                                                                    |
```
**Append to the Description cell** (before the `See PRD §5.1.`): add `Must be ≥ \`COMMIT_RETRY_DELAY\` (the relational cap≥delay constraint, PRD §9.7.5; enforced at startup and by \`hack config validate\`). ` so the cell reads:
```
Maximum delay cap in milliseconds for stagecoach commit-message-generation backoff. Must be ≥ `COMMIT_RETRY_DELAY` (the relational cap≥delay constraint, PRD §9.7.5; enforced at startup and by `hack config validate`). See PRD §5.1.
```
(The `.hack` key is `[commit] retry_delay_cap_ms`; the env-var/`.hack`/CLI names map per the schema summary.)

#### EDIT 2 — `docs/CLI_REFERENCE.md` — "Run from anywhere" subcommand note (BUG-001)

**Site — the Task Management section.** It ends with the "Breakdown-in-progress state" note (around
line 202-210, ending `… only auto-resolved (discovered) tasks files get the graceful path. See PRD §5.3.`).
**ADD a new note paragraph immediately after it**, before the `---` separator + the
`### Configuration Management` heading:
```
**Run from anywhere (PRD §9.8.7 / §9.8.9).** Every `hack` subcommand — `task`, `status`, `cache`,
`inspect`, `artifacts`, `validate-state`, and `config` — resolves `plan/`, `PRD.md`, `.hack`, and
`.env` at the **repository root**, regardless of the directory you invoke it from. At startup `hack`
walks up from your current directory to the nearest `.git` entry (a directory for a normal clone, or a
file for a worktree/submodule) and `chdir`s to that root via a `preAction` hook that runs *before* each
action handler, so the same command works identically from the repo root or a deep subdirectory. Pass
`--repo-root <path>` (§9.8.6) to pin an explicit root and skip the upward search. Invoking `hack`
outside any git repository exits 1 with a single `NotARepositoryError` (§9.8.5) naming the directory it
searched from and the `--repo-root` remediation. See [Running from Anywhere](../README.md#running-from-anywhere)
and [Bootstrap Layer](./ARCHITECTURE.md#bootstrap-layer).
```
(If `ARCHITECTURE.md`'s "Bootstrap Layer" anchor differs, drop that link — keep the README link which is verified.)

#### EDIT 3 — `docs/ARCHITECTURE.md` — Bootstrap Layer preAction-hook refresh (BUG-001)

The Bootstrap Layer (lines 87-135) currently sequences `parseCLIArgs() → chdir`. **Three sub-edits:**

**3a — prose (lines 87-92).** Current first paragraph:
```
The **bootstrap layer** runs before any of the four processing engines (PRD §3, §8): it parses
the CLI, resolves and `chdir`s to the repository root, loads the layered `.hack` configuration,
then configures the environment, harness, and auth preflight before the pipeline runs. It is
the chronological first thing `main()` does, and it is what makes "run from anywhere" and the
committed `.hack` defaults work.

**Location**: [`src/index.ts`](../src/index.ts) (`main()`).
```
**Replace the second sentence + the Location line** so the prose states the chdir runs *during* parse via
the `preAction` hook. New paragraph:
```
The **bootstrap layer** runs before any of the four processing engines (PRD §3, §8): it parses
the CLI, resolves and `chdir`s to the repository root **during** `program.parse()` (via a
`preAction` hook that fires before each action handler), loads the layered `.hack` configuration,
then configures the environment, harness, and auth preflight before the pipeline runs. Because the
`chdir` happens *inside* parse — before every subcommand's `.action()` handler, not after
`parseCLIArgs()` returns — it is what makes "run from anywhere" work for **all** subcommands and the
default pipeline alike, and the committed `.hack` defaults work.

**Location**: [`src/cli/index.ts`](../src/cli/index.ts) (`parseCLIArgs()` registers the `preAction`
hook) + [`src/index.ts`](../src/index.ts) (`main()` reads the cached `getRepoRoot()` singleton).
```

**3b — mermaid diagram.** Current:
```
    A[parseCLIArgs] --> B[resolveRepositoryRoot + chdir]
    B --> C[loadHackConfig]
    C --> D[configureEnvironment]
    D --> E[configureHarness]
    E --> F[runAuthPreflight]
    F --> G[pipeline.run]
```
**Replace** so the chdir is shown as a step *inside* parse (the `preAction` hook), and `main()` reads the
singleton after parse:
```
    A["parseCLIArgs / program.parse()"] -->|"preAction hook (every action handler)"| B[resolveRepositoryRoot + chdir]
    A -->|"after parse returns"| H["main(): getRepoRoot() (cached singleton)"]
    B --> C[loadHackConfig]
    H --> C
    C --> D[configureEnvironment]
    D --> E[configureHarness]
    E --> F[runAuthPreflight]
    F --> G[pipeline.run]
```
(Keep the existing `style` lines; add `style B fill:#fff9c4` if reusing the yellow for the hook step. If
mermaid quoting of `preAction hook …` chokes, simplify the edge label to `preAction hook`.)

**3c — step table.** Current steps 1-3 imply parse completes first, then chdir. **Rewrite steps 1-3** so the
`preAction` hook is the chdir site. New first rows:
```
| 1    | `parseCLIArgs()` registers a `program.hook('preAction', …)` and calls `program.parse()` — `--help`/`--version`/usage short-circuit here | `src/cli/index.ts` | §4.1 |
| 1a   | **`preAction` hook fires** (after options parsed, before each action body): `bootstrapRepoRoot(process.cwd(), {explicit?})` → `resolveRepositoryRoot` + `process.chdir(repoRoot)`; idempotent (`_bootstrapped`). Applies to the root default path AND every subcommand. | `src/cli/index.ts:852` + `src/utils/repo-root.ts` | §9.8.2 / §9.8.3 / §9.8.7 |
| 1b   | Subcommand `.action()` handlers run AFTER the chdir → they resolve `plan/`/`PRD.md`/`.hack`/`.env` at `repoRoot`. | `src/cli/index.ts` | §9.8.7 / §9.8.9 |
| 2    | `main()` reads the cached `getRepoRoot()` singleton (the chdir already ran during parse); `INVOCATION_CWD` was captured at module scope for `--prd` pre-resolution. | `src/index.ts` | §9.8 |
```
(Keep steps 4-8 as-is: PRD.md exists-check, `loadHackConfig`, `configureEnvironment`,
`configureHarness`+`runAuthPreflight`, `new PRPPipeline`+`pipeline.run`. Re-number only if needed; the
existing rows 4-8 content stays accurate.)

**3d — repo-root resolver callout** (the `>` blockquote at lines 121-127). It currently ends "`--repo-root`
(§9.8.6) skips the walk and pins an explicit root." **Append one sentence** so it notes the hook + clean error:
```
… `--repo-root` (§9.8.6) skips the walk and pins an explicit root. The resolve+`chdir` is wrapped in
`bootstrapRepoRoot()` and invoked from the `preAction` hook so **all** subcommands inherit the correct cwd;
a `NotARepositoryError` thrown in the hook propagates through `program.parse()` to `main().catch()`'s
dedicated clean arm (single `❌` line, no stack trace).
```

#### EDIT 4 — `README.md` — subcommand coverage in "Running from Anywhere" (BUG-001)

**Site — the "Running from Anywhere" section** (lines 108-126). The paragraph after the intro currently reads:
```
You don't have to `cd` to the repository root. At startup `hack` walks upward from your
current directory to the nearest `.git` entry (a directory for a normal clone, or a file for a
worktree/submodule) and `chdir`s to that repository root before doing anything else
(PRD §9.8). The session directory, `PRD.md`, `.hack`, `.env`, and `plan/` are all resolved
relative to that root, so the same invocation works from anywhere inside the repo.
```
**Append one sentence** after "… so the same invocation works from anywhere inside the repo.":
```
This applies to **every** subcommand — `task`, `status`, `cache`, `inspect`, `artifacts`,
`validate-state`, and `config` — not just the default pipeline run, because `hack` resolves and
`chdir`s to the root before each subcommand's action handler runs.
```
(The existing `cd src/core/deep/nested && hack status` example already demonstrates the subcommand case —
keep it; the added sentence makes the "all subcommands" guarantee explicit.)

### Success Criteria
- [ ] `docs/CONFIGURATION.md` schema-summary notes block has the relational-constraint note (BUG-003) + the
      clean-rendering note (BUG-002); the `COMMIT_RETRY_DELAY_CAP` row states the `≥ COMMIT_RETRY_DELAY` constraint.
- [ ] `docs/CLI_REFERENCE.md` Task Management section has the "Run from anywhere" note enumerating all 7 subcommands.
- [ ] `docs/ARCHITECTURE.md` Bootstrap Layer prose + mermaid + step table reflect the `preAction` hook (chdir
      during parse); no "parse THEN chdir" sequential claim remains.
- [ ] `README.md` "Running from Anywhere" section explicitly names all 7 subcommands.
- [ ] No source (`src/**`) or test (`tests/**`) file modified.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] All added internal anchor links resolve (grep target headings exist).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — for each of the
4 docs the exact current text at the edit site is quoted, the verbatim replacement/addition is prescribed,
the implemented-behavior contract (with source line cites + PRD sections) is given, and the scope boundary
(no source/test edits) is explicit. See `research/01-docs-sweep-facts.md` for the per-fix evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative fix strategies (prescribe the behavior these docs must reflect)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_001_fix_strategy.md
  section: "Fix: program.hook('preAction', ...) + Shared Bootstrap Helper"
  why: Prescribes the preAction-hook design + bootstrapRepoRoot() + idempotency + the per-subcommand chdir.
  critical: The chdir runs DURING program.parse() (before each action handler), NOT after parseCLIArgs() returns.
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_002_fix_strategy.md
  why: Prescribes HackConfigError + the dedicated clean main().catch() arm (single ❌ line, no stack).
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_003_fix_strategy.md
  why: Prescribes the validateHackTier relational check (cap≥delay) + the message style + the per-tier scope.

# MUST READ — PRD sections the docs cite (anchor accuracy)
- file: PRD.md
  sections: "9.8.3" (strategy), "9.8.7"/"9.8.9" (run-from-anywhere acceptance), "9.8.5" (NotARepositoryError),
            "9.8.6" (--repo-root), "9.7.5" (schema incl. relational), "9.7.7" (hard errors), "9.2.7" (fail-fast).
  why: The added notes cite these anchors; verify they exist before linking (they do — cite as §9.x).

# THE IMPLEMENTED SOURCE (verify the prescribed prose against these — READ-ONLY, do NOT edit)
- file: src/cli/index.ts
  section: "the preAction hook (line ~852)" + "parseCLIArgs() registers it before program.parse()"
  why: CONFIRMS the chdir runs during parse via `program.hook('preAction', () => bootstrapRepoRoot(process.cwd(), …))`,
       fires after options parsed + before each action body, idempotent; NotARepositoryError propagates to main().catch().
  critical: This is the single fact ARCHITECTURE.md must reflect — grep `preAction` here to confirm before writing.
- file: src/index.ts
  section: "main() (~123-150): reads getRepoRoot() singleton"
  why: CONFIRMS main() no longer does the chdir; it reads the cached singleton the hook populated.
- file: src/utils/repo-root.ts
  section: "bootstrapRepoRoot() + _bootstrapped idempotency guard"
  why: CONFIRMS the idempotent resolve+chdir helper the hook calls; getRepoRoot()/getInvocationCwd() singletons.
- file: src/config/hack-config.ts
  section: "validateHackTier (~755-797) relational check" (BUG-003, P1.M3.T1.S1)
  why: CONFIRMS the relational check + the throw message style (the CONFIGURATION.md note mirrors it). NOTE: if
       P1.M3.T1.S1 is still in flight, the relational block may not yet be in the working tree — write the doc note
       to the SPEC (cap≥delay enforced) which the parallel item delivers; re-grep before finalizing.

# THE 4 DOCS TO EDIT (each edit site's current text is quoted in "Technical requirements")
- file: docs/CONFIGURATION.md            # EDIT 1 (schema notes block + COMMIT_RETRY_DELAY_CAP row)
- file: docs/CLI_REFERENCE.md            # EDIT 2 (Task Management "Run from anywhere" note)
- file: docs/ARCHITECTURE.md             # EDIT 3 (Bootstrap Layer prose + mermaid + step table + resolver callout)
- file: README.md                        # EDIT 4 ("Running from Anywhere" subcommand sentence)
  why: EDIT — the 4 prescribed edits. Each quotes the current text + the replacement.
  pattern_note: "match the existing `> ` blockquote note style in CONFIGURATION.md's schema-summary block + CLI_REFERENCE's bold-lead-in notes."
  pattern_table: "preserve the markdown table column widths approximately; prettier will reflow — run `npm run fix`."
  critical: prettier `format:check` globs `**/*.md` (package.json) → the edits MUST pass prettier. Run `npm run fix` (lint:fix + format) after editing.

# OUT OF SCOPE (hard boundary — DO NOT touch)
- ANY file under src/ or tests/                # docs-only
- package.json, tsconfig*.json, vitest.config.ts
- architecture/*.md (the fix strategies)       # owned by the code items; this item documents their OUTCOME in docs/*.md
- INSTALLATION.md, TESTING.md, WORKFLOWS.md, user-guide.md, CUSTOM_*.md, GROUNDSWELL_GUIDE.md  # not affected by these 3 fixes
- Any code/test for BUG-002/BUG-003            # those are separate items (DONE / P1.M3.T1.S1)
```

### Current Codebase tree (relevant slice)
```bash
docs/CONFIGURATION.md       # EDIT 1: schema notes block (relational + clean-rendering) + COMMIT_RETRY_DELAY_CAP row
docs/CLI_REFERENCE.md       # EDIT 2: Task Management "Run from anywhere" note (all 7 subcommands)
docs/ARCHITECTURE.md        # EDIT 3: Bootstrap Layer prose + mermaid + step table + resolver callout (preAction hook)
README.md                   # EDIT 4: "Running from Anywhere" subcommand sentence
src/cli/index.ts            # READ-ONLY: preAction hook (~852) — verify the prescribed prose
src/index.ts                # READ-ONLY: main() getRepoRoot() singleton (~143)
src/utils/repo-root.ts      # READ-ONLY: bootstrapRepoRoot() + idempotency
src/config/hack-config.ts   # READ-ONLY: validateHackTier relational check (BUG-003, P1.M3.T1.S1)
```

### Desired Codebase tree with files to be added/edited
```bash
docs/CONFIGURATION.md       # MODIFIED (2 notes + 1 table-cell append)
docs/CLI_REFERENCE.md       # MODIFIED (1 note paragraph)
docs/ARCHITECTURE.md        # MODIFIED (prose + mermaid + step table + 1 callout sentence)
README.md                   # MODIFIED (1 sentence)
# (no new files; no source/test changes)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — prettier `format:check` is enforced on **/*.md (package.json format:check globs markdown). The -->
<!-- multi-line notes + the widened table cell + the mermaid block may reflow. ALWAYS run `npm run fix` -->
<!-- (lint:fix + prettier --write) BEFORE `npm run format:check`. Let the formatter own table-column alignment. -->

<!-- CRITICAL — docs-only. Do NOT edit any src/** or tests/** file. The BUG-002 catch-arm code + the BUG-003 -->
<!-- validateHackTier code are SEPARATE items (DONE / P1.M3.T1.S1); this item only documents their OUTCOME. -->

<!-- GOTCHA — ARCHITECTURE.md's mermaid diagram: mermaid is strict about node-label quoting when the label -->
<!-- contains parentheses/slashes. If `A["parseCLIArgs / program.parse()"]` or the edge label renders wrong, -->
<!-- simplify to `A[parseCLIArgs]` + a plain edge label `preAction hook`. The DIAGRAM is illustrative; the -->
<!-- step table is the authoritative sequencing. Verify the mermaid block still parses (no syntax error). -->

<!-- GOTCHA — anchor links: markdown anchors are lowercased + spaces→hyphens. `README.md#running-from-anywhere` -->
<!-- (heading "Running from Anywhere") and `ARCHITECTURE.md#bootstrap-layer` (heading "Bootstrap Layer") are the -->
<!-- targets. Grep the heading text to confirm the exact anchor before linking; if a heading differs, drop the -->
<!-- link rather than ship a dead anchor. -->

<!-- GOTCHA — the CONFIGURATION.md schema-summary table uses padded column widths for alignment. Appending to the -->
<!-- COMMIT_RETRY_DELAY_CAP Description cell will desync the padding from sibling rows — that's FINE: prettier -->
<!-- reformats markdown tables; just run `npm run fix`. Do NOT hand-align the pipes. -->

<!-- GOTCHA — P1.M3.T1.S1 (BUG-003 relational check) runs IN PARALLEL. Its `validateHackTier` block may not yet be -->
<!-- in the working tree when you write the CONFIGURATION.md note. Write the note to the SPEC (cap≥delay enforced -->
<!-- at startup + by `hack config validate`, per the bug_003_fix_strategy.md) — that's what the parallel item -->
<!-- delivers. Re-grep `validateHackTier` before finalizing to confirm the block landed. -->

<!-- CRITICAL — Keep changes MINIMAL. Each edit is a note / sentence / table-cell / diagram-or-table refresh. Do -->
<!-- NOT add new top-level sections, restructure headings, or rewrite whole pages. Only update what the three -->
<!-- fixes made inaccurate/incomplete. -->
```

---

## Implementation Blueprint

### Data models and structure
None (documentation). No types, schemas, or code.

### Implementation Tasks (ordered by file; each is independent)
```yaml
Task 1: EDIT docs/CONFIGURATION.md  (BUG-003 relational note + BUG-002 clean-rendering note)
  - STEP 1a — In the schema-summary notes block, ADD the two `> ` note paragraphs ("Relational constraint
    (PRD §9.7.5) …" + "Error rendering (§9.2.7 fail-fast) …") immediately AFTER the "Secrets policy" note
    and BEFORE the `### \`hack config\` subcommand` heading. Use the verbatim text in "Technical requirements EDIT 1 Site A".
  - STEP 1b — In the Resilience Tuning table, APPEND the `≥ COMMIT_RETRY_DELAY` constraint to the
    `COMMIT_RETRY_DELAY_CAP` row's Description cell (verbatim in "EDIT 1 Site B").
  - VERIFY: grep `retry_delay_cap_ms` docs/CONFIGURATION.md → ≥2 hits (note + table); grep `hack config validate`
    docs/CONFIGURATION.md → the note + the existing `validate` row.

Task 2: EDIT docs/CLI_REFERENCE.md  (BUG-001 run-from-anywhere subcommand note)
  - ADD the "Run from anywhere (PRD §9.8.7 / §9.8.9)" note (verbatim in "EDIT 2") AFTER the Task Management
    "Breakdown-in-progress state" note + BEFORE the `---`/`### Configuration Management` separator.
  - VERIFY: grep `preAction\|Run from anywhere\|validate-state` docs/CLI_REFERENCE.md → the note is present;
    the 7 subcommands (task/status/cache/inspect/artifacts/validate-state/config) are enumerated.

Task 3: EDIT docs/ARCHITECTURE.md  (BUG-001 Bootstrap Layer preAction-hook refresh)
  - STEP 3a — REPLACE the Bootstrap Layer first paragraph's 2nd sentence + the `**Location**:` line (verbatim
    in "EDIT 3a") so the prose states the chdir runs DURING parse via the preAction hook.
  - STEP 3b — REPLACE the mermaid diagram (verbatim in "EDIT 3b") so the chdir is a preAction-hook step inside
    parse + main() reads the singleton. Keep `style` lines; verify mermaid parses.
  - STEP 3c — REWRITE step-table rows 1-3 into rows 1/1a/1b/2 (verbatim in "EDIT 3c") reflecting the hook;
    keep steps 4-8 (PRD.md exists-check, loadHackConfig, configureEnvironment, harness+auth, pipeline.run).
  - STEP 3d — APPEND the one-sentence hook + clean-error note to the repo-root resolver `>` callout ("EDIT 3d").
  - VERIFY: grep `preAction\|program.parse` docs/ARCHITECTURE.md → the mermaid + step table + prose mention it;
    grep `parseCLIArgs\].*-->.*chdir` (the old sequential edge) → should be GONE from the mermaid.

Task 4: EDIT README.md  (BUG-001 subcommand coverage)
  - APPEND the one sentence enumerating all 7 subcommands to the "Running from Anywhere" paragraph (verbatim
    in "EDIT 4"), after "… so the same invocation works from anywhere inside the repo."
  - VERIFY: grep `task.*status.*cache.*inspect.*artifacts.*validate-state.*config` README.md → the sentence.

Task 5: VERIFY (no code change + format + links + accuracy)
  - RUN: npm run fix          # prettier reflows the .md edits
  - RUN: npm run typecheck && npm run lint && npm run format:check   # docs-only → must stay clean
  - CONFIRM no src/ or tests/ change: `git status --short` shows ONLY the 4 docs.
  - CONFIRM anchor links resolve: grep `#running-from-anywhere` (README "Running from Anywhere"),
    `#bootstrap-layer` (ARCHITECTURE "Bootstrap Layer"); drop any dead link.
  - ACCURACY cross-check: grep `preAction` src/cli/index.ts (the hook), `getRepoRoot()` src/index.ts (the
    singleton), `validateHackTier` src/config/hack-config.ts (relational check) — confirm the docs match.
```

### Implementation Patterns & Key Details
```markdown
<!-- ---- CONFIGURATION.md note style (match the existing blockquote notes) ----
> **Relational constraint (PRD §9.7.5):** `[commit] retry_delay_cap_ms` must be **≥** `retry_delay_ms` …
> enforced in `validateHackTier` … rejected as a hard error (exit 1) at startup and by `hack config validate`.

<!-- ---- CLI_REFERENCE.md note style (match the bold-lead-in notes) ----
**Run from anywhere (PRD §9.8.7 / §9.8.9).** Every `hack` subcommand — `task`, `status`, `cache`, …
resolves `plan/`, `PRD.md`, `.hack`, and `.env` at the **repository root**, regardless of the directory …

<!-- ---- ARCHITECTURE.md: the load-bearing fact (the preAction hook, src/cli/index.ts:852) ----
program.hook('preAction', () => { bootstrapRepoRoot(process.cwd(), opts.repoRoot ? {explicit:…} : undefined); });
// → resolve + chdir run DURING program.parse(), BEFORE each action handler. main() then reads getRepoRoot().
// The OLD model ("parse returns, THEN chdir in main") is the BUG-001 root cause — it must NOT survive in the doc.

<!-- ---- README.md: the one added sentence ----
This applies to **every** subcommand — `task`, `status`, `cache`, `inspect`, `artifacts`, `validate-state`,
and `config` — not just the default pipeline run, because `hack` resolves and `chdir`s to the root before
each subcommand's action handler runs.
```

### Integration Points
```yaml
DOCS (no code integration — documentation-only):
  - docs/CONFIGURATION.md: +2 notes (relational + clean-rendering) + 1 table-cell append.
  - docs/CLI_REFERENCE.md: +1 "Run from anywhere" note (Task Management section).
  - docs/ARCHITECTURE.md: Bootstrap Layer prose + mermaid + step table + resolver callout refresh.
  - README.md: +1 sentence (Running from Anywhere).
  - PRESERVE: all other doc content; headings/anchors; cross-doc links (verify, don't break).

CROSS-REFERENCES (the docs point at each other + at the source):
  - CLI_REFERENCE.md note → README.md#running-from-anywhere + ARCHITECTURE.md#bootstrap-layer.
  - ARCHITECTURE.md → src/cli/index.ts (preAction hook) + src/index.ts (main singleton) + src/utils/repo-root.ts.
  - CONFIGURATION.md note → src/config/hack-config.ts (validateHackTier) + hack config validate.

NO SOURCE/TEST CHANGES (hard boundary):
  - This item touches ONLY the 4 named docs. BUG-001/002 code is DONE; BUG-003 code is P1.M3.T1.S1 (parallel).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write — reflows the .md notes/tables/mermaid (run FIRST)
npm run typecheck      # docs-only → must stay clean (no .ts touched)
npm run lint           # docs-only → must stay clean
npm run format:check   # prettier --check on **/*.md → clean after `npm run fix`
# Expected: all clean. Likely failure: a markdown table/note that prettier wants reformatted → `npm run fix` fixes it.
#   A mermaid syntax error in ARCHITECTURE.md won't fail prettier (it's a fenced block) — eyeball it renders.
```

### Level 2: Content Checks (the "tests" for a docs task)
```bash
# Confirm each edit landed + the now-false claim is gone:
grep -c "retry_delay_cap_ms" docs/CONFIGURATION.md            # ≥2 (the relational note + the schema-summary table row + the env-var row)
grep -c "hack config validate" docs/CONFIGURATION.md          # ≥2 (the relational note + existing validate rows)
grep -c "Run from anywhere" docs/CLI_REFERENCE.md             # 1+ (the new note)
grep -c "preAction" docs/CLI_REFERENCE.md docs/ARCHITECTURE.md README.md   # the note/diagram/prose mention it
# Confirm the OLD sequential claim is GONE from ARCHITECTURE.md's mermaid (BUG-001 root-cause model):
grep -n 'parseCLIArgs\] -->|".*chdir' docs/ARCHITECTURE.md    # expect 0 (the old A→B sequential edge replaced)
grep -n "preAction hook" docs/ARCHITECTURE.md                 # expect ≥1 (the new mermaid edge label / step 1a)
# Confirm all 7 subcommands are enumerated in CLI_REFERENCE + README:
grep -c "validate-state" docs/CLI_REFERENCE.md README.md      # ≥1 each (the enumeration)
# Confirm anchor links resolve (target headings exist):
grep -c "^## Running from Anywhere" README.md                 # 1 → anchor #running-from-anywhere valid
grep -c "^## Bootstrap Layer" docs/ARCHITECTURE.md            # 1 → anchor #bootstrap-layer valid
# Confirm NO source/test files changed:
git status --short                                            # ONLY docs/CONFIGURATION.md docs/CLI_REFERENCE.md docs/ARCHITECTURE.md README.md
```

### Level 3: Integration / Regression (System Validation)
```bash
# Accuracy cross-check — the docs' claims match the implemented source (READ-ONLY greps):
grep -n "program.hook('preAction'" src/cli/index.ts          # confirms the chdir-during-parse claim (ARCHITECTURE/CLI/README)
grep -n "const repoRoot = getRepoRoot()" src/index.ts        # confirms main() reads the singleton (ARCHITECTURE step table)
grep -n "bootstrapRepoRoot" src/utils/repo-root.ts           # confirms the idempotent helper the hook calls
grep -n "retry_delay_cap_ms" src/config/hack-config.ts       # confirms the relational check (BUG-003; if P1.M3.T1.S1 landed)
# Expected: all greps return the cited source sites, proving the docs describe real behavior.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Manual doc-reading checks (record in commit message):
#   1. Read the ARCHITECTURE.md Bootstrap Layer top-to-bottom — does the prose + mermaid + step table tell a
#      COHERENT story (chdir during parse via preAction hook; subcommand handlers run after; main reads singleton)?
#      No leftover "parse returns then chdir" contradiction?
#   2. Read CLI_REFERENCE.md Task Management + README "Running from Anywhere" — does a user learn that ALL
#      subcommands (task/status/cache/inspect/artifacts/validate-state/config) work from a subdir?
#   3. Read CONFIGURATION.md — does a user learn cap≥delay is enforced (startup + `hack config validate`) +
#      that a bad .hack renders as a clean ❌ line?
#   4. Mermaid renders (paste the block into a mermaid live editor OR eyeball the syntax: balanced quotes,
#      valid edge labels, no stray pipes).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run fix` run (prettier reformats the .md edits).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `git status --short` shows ONLY the 4 docs (no `src/`/`tests/` change).

### Feature Validation
- [ ] CONFIGURATION.md: relational-constraint note (BUG-003) + clean-rendering note (BUG-002) + `COMMIT_RETRY_DELAY_CAP`
      row states the `≥ COMMIT_RETRY_DELAY` constraint.
- [ ] CLI_REFERENCE.md: "Run from anywhere" note enumerates all 7 subcommands.
- [ ] ARCHITECTURE.md: Bootstrap Layer reflects the preAction hook (chdir during parse); the old sequential
      `parseCLIArgs → chdir` claim is GONE from the mermaid + step table.
- [ ] README.md: "Running from Anywhere" explicitly names all 7 subcommands.

### Code Quality Validation
- [ ] Each edit matches the existing doc's note/quote/table style (blockquote notes in CONFIGURATION; bold-lead
      notes in CLI_REFERENCE; prose+mermaid+table in ARCHITECTURE).
- [ ] Edits are minimal (no new top-level sections, no restructure, no churn).
- [ ] All added internal anchor links resolve (grep the target headings).
- [ ] Mermaid block in ARCHITECTURE.md parses (no syntax error).

### Documentation & Deployment
- [ ] The 4 docs accurately reflect the 3 fixes (subcommand repo-root resolution; clean config-error rendering;
      enforced relational constraint).
- [ ] Cross-references (source line cites + PRD § anchors + cross-doc links) are correct.
- [ ] Commit message records: BUG-001/002/003 docs sweep (Mode B); the preAction-hook fact for ARCHITECTURE.md;
      the relational-enforcement + clean-rendering notes for CONFIGURATION.md; the all-subcommands run-from-anywhere
      note for CLI_REFERENCE.md + README.md; the minimal/surgical approach.

---

## Anti-Patterns to Avoid

- ❌ Don't edit ANY `src/**` or `tests/**` file. This is a docs-only (Mode B) sweep. The BUG-001/002 code is DONE;
      BUG-003 code is P1.M3.T1.S1 (parallel). You only document their outcome.
- ❌ Don't leave ARCHITECTURE.md's old "parse returns, THEN chdir in main" sequencing. That is the precise BUG-001
      root-cause model — the mermaid edge `A[parseCLIArgs] --> B[chdir]` + the step table (parse=step1,
      chdir=step3) MUST be rewritten to show the chdir runs DURING parse via the preAction hook. Leaving it
      contradicts the fix and the other three docs.
- ❌ Don't hand-align the CONFIGURATION.md markdown table after appending to the `COMMIT_RETRY_DELAY_CAP` cell.
      Prettier reformats markdown tables — run `npm run fix` and let it own the padding. Hand-aligning fights the
      formatter and `format:check` will re-flag it.
- ❌ Don't ship a dead anchor link. `#running-from-anywhere` (README "Running from Anywhere") and
      `#bootstrap-layer` (ARCHITECTURE "Bootstrap Layer") — grep the EXACT heading text before linking; if a
      heading differs, DROP the link rather than ship a 404 anchor.
- ❌ Don't break the mermaid block. Mermaid is strict about node-label quoting (parentheses/slashes inside a
      label often need `["…"]`). If the prescribed `A["parseCLIArgs / program.parse()"]` doesn't render, simplify
      to `A[parseCLIArgs]`. The step table is the authoritative sequencing; the diagram is illustrative.
- ❌ Don't add redundant content. README's Features list does NOT currently include run-from-anywhere — DO NOT
      add a Features bullet; the dedicated "Running from Anywhere" section is the home. Add only the one
      subcommand-enumeration sentence there.
- ❌ Don't restructure the docs (new headings, moved sections, rewritten pages). Each edit is a note / sentence /
      table-cell / diagram-or-table refresh. "Keep changes minimal — only update what is now inaccurate or incomplete."
- ❌ Don't document behavior that isn't (yet) implemented without noting the dependency. If P1.M3.T1.S1 (BUG-003
      relational check) hasn't landed in the working tree when you write the CONFIGURATION.md note, write the note
      to the SPEC (cap≥delay enforced) — that's what the parallel item delivers — and re-grep `validateHackTier`
      before finalizing.
- ❌ Don't forget `npm run fix` before `npm run format:check`. `format:check` globs `**/*.md`; un-formatted
      markdown edits will fail it.
- ❌ Don't touch INSTALLATION.md / TESTING.md / WORKFLOWS.md / user-guide.md / CUSTOM_*.md / the architecture/*.md
      fix strategies. They are not affected by these 3 fixes.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, surgical, documentation-only sweep — 4 markdown files, each edit quoted verbatim
(current text + replacement) with its exact site. The implemented-behavior contract is verified against the
source (`src/cli/index.ts:852` preAction hook; `src/index.ts:143` `getRepoRoot()` singleton; `src/utils/repo-root.ts`
`bootstrapRepoRoot`; `src/config/hack-config.ts` `validateHackTier`) and the three fix-strategy docs, so the
prescribed prose describes REAL behavior. The single load-bearing correction (ARCHITECTURE.md's "parse → chdir"
sequencing → "chdir during parse via preAction hook") is identified with proof it's the BUG-001 root-cause model.
The non-obvious risks are all enumerated + mitigated: (a) prettier reformats `.md` (run `npm run fix`);
(b) mermaid label quoting (simplify if it chokes; step table is authoritative);
(c) dead anchor links (grep headings before linking);
(d) markdown table padding (let prettier own it);
(e) P1.M3.T1.S1 parallel dependency (write the relational note to spec; re-grep before finalizing);
(f) no source/test edits (git status confirms). The deterministic `format:check` + the grep content-gates
confirm correctness in one pass. The only residual risk is a mermaid rendering nuance — non-blocking (it's a
fenced block; eyeball it) and the step table carries the authoritative sequencing.