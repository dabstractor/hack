# Research — P1.M1.T4.S3: Sweep docs/ARCHITECTURE.md + docs/CLI_REFERENCE.md

> Mode-B **verification-pass** doc sweep for the Distributed-PRD Include Dedup bugfixes
> (BUG-001/002/003, all Complete). This research confirms the **shipped post-fix behavior** (§1),
> snapshots the **current prose** of both target files (§2), and builds the **claim→source→verdict
> matrix** (§3) that the implementing agent re-verifies against the LIVE file (grep, not line numbers).
> **Conclusion (pre-verification, to be re-confirmed live): BOTH files are already accurate →
> NO-EDIT is the expected outcome.** CLI_REFERENCE.md has zero relevant content (pure vacuous
> no-edit); ARCHITECTURE.md's one relevant section (L157-183) already documents the `@!include`/
> `@!end-include` markers + unconditional stale stderr warning + maxDepth default 10. The single
> judgment call (ARCHITECTURE.md L165 "silent") defaults to NO-EDIT, mirroring the CONFIGURATION.md
> L305 "silent" decision in T4.S2.

---

## 1. Shipped post-fix behavior (source-of-truth — src/core/session-utils.ts)

Live line citations verified against the current file (grep-confirmed, not snapshot):

| Concern | Shipped behavior | Source line(s) |
|---------|------------------|----------------|
| **BUG-001 — emitted markers** (open/close around EXPANDED content) | `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->` | `src/core/session-utils.ts:593` |
| **BUG-001 — elision ref** (cycles/diamonds/back-edges + depth-gate elision) | `<!-- @!include-ref: ${token} -->` | `src/core/session-utils.ts:610` (`elisionRefComment`) |
| **BUG-001 — `@!` rationale** | `! ∉ [A-Za-z0-9_./-]` → `RESOLVE_TOKEN` zero-captures → structurally non-resolvable (technique B, PRD §2.3) | JSDoc L443/L606/L717-723 |
| **BUG-002 — stale `.md` warn (main loop)** | `replacement === undefined && token.endsWith('.md')` → `emitStaleIncludeWarning(token, abs)` | `src/core/session-utils.ts:585` |
| **BUG-002 — stale `.md` warn (depth gate)** | `neutralizeResolvableTokens` ALSO calls `emitStaleIncludeWarning` for a non-resolving `.md` → **unconditional incl. depth gate** | `src/core/session-utils.ts:671` |
| **BUG-002 — warn sink** | `console.warn(\`[prd-resolver] stale include '@${token}': ...\`)` → **process.stderr, sync** (pino writes stdout; §2.3 requires stderr) | `src/core/session-utils.ts:621-627` (`emitStaleIncludeWarning`) |
| **BUG-002 — depth-gate confirmation** | "A stale `.md` at the `maxDepth` gate ALSO emits exactly one warning (the depth-gate `neutralizeResolvableTokens` scan runs the same stale-`.md` check as the main loop)" | JSDoc `src/core/session-utils.ts:731-732` |
| **BUG-003 — dedup key** | `dedupKey(abs) = realpathSync(abs)` with lexical fallback (`catch { return abs }`) → symlink aliases to one physical file dedup correctly | `src/core/session-utils.ts:504-506`; `import { realpathSync } from 'node:fs'` at L35 |
| **BUG-003 — keying sites** (all THREE use canonical key) | `visited.has(dedupKey(abs))` (L538), `visited.add(dedupKey(abs))` (L560), `new Set<string>([dedupKey(absEntry)])` entry pre-seed (L773) | L538 / L560 / L773 |
| **maxDepth default** | `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10` | `src/config/constants.ts:1257` |
| **markers env toggle** | `PRD_INCLUDE_MARKERS` truthy → markers on; `opts.markers` overrides env both directions | JSDoc L715-716 |

**CRITICAL distinctions the doc prose must not conflate:**
- **DIRECTIVE syntax** `@path/to/file.md` (typed by the PRD author) is **UNCHANGED** by all three fixes.
- **EMITTED markers** `<!-- @!include: … -->` / `<!-- @!end-include -->` / `<!-- @!include-ref: … -->` (emitted by the resolver) use the collision-proof `@!` prefix. **The `!` MUST stay.** Dropping it is the one genuinely-wrong case.

---

## 2. Current prose of the two target files

### 2a. docs/ARCHITECTURE.md — ONE relevant section: "Resolved-Document Invariant (Distributed PRDs)" (L157-183)

Verbatim current prose (re-read LIVE; lines may drift — locate by grep):

```markdown
## Resolved-Document Invariant (Distributed PRDs)

A PRD of any real size may be authored across multiple files (architecture, API, data model,
companion docs) and assembled into **one canonical document** at load time (PRD §2.3). An
`@path/to/file.md` token is an _include directive_ — it is replaced inline by the referenced
file's UTF-8 contents.                                  # L159 — DIRECTIVE syntax (UNCHANGED ✓)

### Expansion Rules

A token expands only when **both** conditions hold:

1. **Boundary** — the `@` is at the start of a line _or_ preceded by a non-path character, so
   `foo@bar.com` and mid-word `@` are left literal.
2. **Existence** — the path resolves to an existing **file** (directories and missing paths stay
   verbatim and silent).                                  # L165 — "silent" = non-fatal control flow (JUDGMENT CALL; see §4)

Includes resolve **project-root-relative** (relative to the entry PRD's directory) and expand
**recursively, with cycle detection**, up to `PRD_INCLUDE_MAX_DEPTH` (default `10`).
Re-resolution is **idempotent** — identical input bytes yield identical resolved bytes.
                                                         # L168 — depth default 10 ✓; cycle detection ✓; idempotent ✓

When `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @!include: path -->` /
`<!-- @!end-include -->` markers around expanded includes; a `.md` token that fails to resolve
(a _stale include_) emits a warning on stderr.
                                                         # L170 — @! markers ✓ (has the `!`); UNCONDITIONAL stale warn ✓ (no carve-out)
```

**Downstream-invariant bullets (L172-183)** restate "fully-resolved, include-expanded document"
(hashing, prd_snapshot, delta detection, agent prompts, mdsel) — none mention markers/dedup/warning
specifically; they reference the resolved-document invariant, which is accurate.

**False-positive grep hits in ARCHITECTURE.md (NOT the include feature — out of scope):**
- **L131** — "`realpathSync` canonicalizes the root" → this is the **repo-root resolver**
  (`src/utils/repo-root.ts`, §9.8) canonicalizing the git root, NOT BUG-003's include `dedupKey`
  (`session-utils.ts:504`). Different file, different feature. Leave it.
- **L957** — "eliding trailing levels" → the **commit position layer** (`PRP_COMMIT_FORMAT`),
  unrelated "eliding". Leave it.
- **L981** — "`NO_ISSUES_FOUND.md` marker … removes a stale marker" → the **bug-hunt clean-state
  marker** file, unrelated "marker"/"stale". Leave it.

**Dedup prose in ARCHITECTURE.md?** NO. grep for `dedup|visited|realpath|symlink|first-encounter|global
flat|elid` returns only L131 (repo root) + L957 (commit eliding). ARCHITECTURE.md describes
**include RESOLUTION** (directive/boundary/existence/depth/markers/stale-warning/cycle-detection/
idempotency) but NOT the visited-set **dedup mechanism**. So concern (d) is vacuously satisfied —
same as CONFIGURATION.md. (Unlike what the task's "key gotcha" hypothesized, ARCHITECTURE.md does
**not** describe the pipeline + dedup; it stays at the capability/invariant level.)

### 2b. docs/CLI_REFERENCE.md — ZERO relevant content

grep hits and verdict:

| Line | Text (abridged) | Feature | In scope? |
|------|-----------------|---------|-----------|
| 204 | `hack status` / `hack task next` print a calm notice to **stderr**, exit 0 | status/task CLI exit semantics | ✗ unrelated |
| 266 | A bare pre-existing `.hack.local` line is left untouched (**dedup**) | `hack config set` gitignore dedup | ✗ unrelated (NOT include dedup) |
| 271 | `hack config validate` prints a loud **stderr** WARNING | config-validate diagnostics | ✗ unrelated |
| 405 | A fatal error occurred during execution. **This includes**: | exit-code 1 prose | ✗ unrelated |
| 697 | Forces regeneration of all PRPs if you suspect cached content is **stale** | `hack regenerate` cache | ✗ unrelated |

**CLI_REFERENCE.md has NO reference to the Distributed-PRD include directive, the emitted markers,
the stale-include warning, or include dedup.** (There is no `@include`/`@!include`/`PRD_INCLUDE`/
`distributed_prd`/include-`visited` text anywhere.) → **Vacuously satisfied: nothing to verify or
correct.** Pure NO-EDIT outcome, documented in the work log.

---

## 3. Verification matrix (claim → source → verdict) — to be re-confirmed LIVE by the implementing agent

### 3a. docs/ARCHITECTURE.md

| # | Region (locate by grep) | Claim | Source-of-truth | Pre-verdict |
|---|-------------------------|-------|-----------------|-------------|
| A1 | L159 — directive intro | `@path/to/file.md` token = include directive, replaced inline by file contents | Directive syntax UNCHANGED by all 3 fixes; `RESOLVE_TOKEN` | ✅ ACCURATE (directive ≠ emitted marker — do not touch) |
| A2 | L163 — boundary rule | `@` at line-start or after non-path char; `foo@bar.com` literal | Boundary logic unchanged | ✅ ACCURATE |
| A3 | L165 — existence rule | directories + missing paths "stay verbatim and silent" | Resolver leaves non-file/non-resolving verbatim + continues; "silent" = non-fatal (L170 covers the `.md` stderr warn) | ⚠️ JUDGMENT CALL — default NO-EDIT (see §4) |
| A4 | L168 — resolution | project-root-relative, recursive, cycle detection, `PRD_INCLUDE_MAX_DEPTH` default `10`, idempotent | baseDir = entry dir; `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`; visited set; `resolve(resolve(x))===resolve(x)` | ✅ ACCURATE (default 10 ✓; cycle detection ✓; idempotent preserved by all 3 fixes) |
| A5 | L170 — markers | emits `<!-- @!include: path -->` / `<!-- @!end-include -->` around expanded includes | `session-utils.ts:593` `<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->` | ✅ ACCURATE (markers keep the `!`) |
| A6 | L170 — stale warn | `.md` token that fails to resolve (stale include) emits warning on **stderr** | `session-utils.ts:621-627` (`emitStaleIncludeWarning`→`console.warn`→stderr); L731-732 confirms depth gate ALSO warns → UNCONDITIONAL | ✅ ACCURATE (no depth-gate carve-out in the prose) |
| A7 | (dedup) | — | NO dedup prose in ARCHITECTURE.md → nothing to reconcile | ✅ VACUOUS (concern d satisfied; do NOT add dedup prose) |
| A8 | L172-183 downstream | "fully-resolved, include-expanded document" framing | Invariant is accurate | ✅ ACCURATE |

**ARCHITECTURE.md pre-verdict: ALL ACCURATE → expected NO-EDIT** (sole nuance: A3 "silent" judgment
call, default no-edit).

### 3b. docs/CLI_REFERENCE.md

| # | Concern | Finding | Pre-verdict |
|---|---------|---------|-------------|
| B1 | Include directive / emitted markers / stale warn / include dedup | NONE present (all grep hits are unrelated features — §2b) | ✅ VACUOUS — nothing to verify/correct |

**CLI_REFERENCE.md pre-verdict: NO relevant content → expected NO-EDIT** (document "verified: no
include/marker/dedup references present; nothing to correct").

---

## 4. The ONE judgment call — ARCHITECTURE.md L165 "silent" (mirrors CONFIGURATION.md L305)

**The text:** Existence rule #2 — "the path resolves to an existing **file** (directories and missing
paths stay verbatim and silent)."

**The tension:** "missing paths stay … silent" reads, at first, as "missing paths produce no warning."
But L170 (same section, two lines later) authoritatively states a `.md` token that fails to resolve
emits a **stderr warning**. So a literal reading of "silent" for a missing `.md` path contradicts L170.

**The reconciliation (why the DEFAULT is NO-EDIT):** "silent" in L165 means **non-fatal control flow**
— the resolver leaves the token verbatim in the output and continues (it does not abort, throw, or
drop the token). The stderr warning is an **advisory side-channel** that does NOT change the verbatim
output. Read together: a missing `.md` → verbatim output + non-fatal continue (L165 "silent") +
advisory stderr warning (L170). Consistent. L170 is the authoritative statement of the warning
behavior; L165's "silent" governs the OUTPUT/control-flow, not the warning.

**Decision rule (NO-EDIT default):** Because L170 authoritatively and correctly documents the stale
warning, L165's "silent" can stand as "non-fatal." The expected/preferred outcome is NO-EDIT —
identical to the resolved CONFIGURATION.md L305 decision in T4.S2. **Only if** a careful read
concludes "silent" GENUINELY misleads a reader into thinking missing `.md` paths produce no warning
should a minimal scope-narrowing edit be made (qualify "silent" to non-`.md` paths — copy-ready text
in the PRP §"Implementation Patterns"). Do NOT add dedup prose as "correction" — ARCHITECTURE.md has
none; adding it is enhancement, not the accuracy sweep.

---

## 5. Validation gates (verified present + baseline)

```yaml
docs-consistency:
  cmd: "npm run docs:check"        # tsx scripts/check-docs.ts — scans docs/*.md
  baseline: "5 passed, 0 warnings, 0 failed" (GREEN, verified this research)
  must_pass: always (edit OR no-edit)

markdown-lint:
  cmd: "npm run docs:lint"         # markdownlint "docs/**/*.md"  (bonus gate per task TEST contract)
  baseline: not yet run this task — run it; if it flags PRE-EXISTING issues outside scope, do NOT
            fix them (out of scope); if it flags YOUR edit, run `npm run docs:lint:fix`.
  must_pass: if no edit, baseline (don't introduce regressions); if edit, fix what the edit flagged.

formatting:
  cmd: "npm run format:check"      # prettier --check "**/*.{ts,js,json,md,yml,yaml}" (md in glob)
  baseline: clean tree verified this research
  if_edit_flags: "npm run format" then re-run format:check
  must_pass: always (edit OR no-edit)
```

**Scope boundary:** in scope = `docs/ARCHITECTURE.md` + `docs/CLI_REFERENCE.md` ONLY. Out of scope:
`README.md` (T4.S1), `docs/CONFIGURATION.md` (T4.S2), any `src/` file (T1/T2/T3 — Complete), `PRD.md`,
`spec/**`, `**/tasks.json`, `prd_snapshot.md`, all other docs files.