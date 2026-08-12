# PRP — P3.M1.T1.S2: Update package.json + confirm no .hack schema row for FORMAT_NUDGE_MAX

---

## Goal

**Feature Goal**: Reflect the **stagecoach-ai** commit-generation path (shipped in
P1.M2.T1.S1, Complete) and the **identity-transparency** guarantee (PRD §9.10.1/§9.10.2,
shipped in Phase P1) in `package.json`'s user-discoverable metadata (`description` +
`keywords`), AND **confirm** (via grep assertions, no edits) that `FORMAT_NUDGE_MAX`
(P2.M1.T1.S1) is correctly an **internal constant with no `.hack` schema row and no
env var** — PRD §4.5.1 gives it a fixed default and the delta PRD says "no new tunable
is required." This is the **Mode B documentation/metadata task** that closes the
changeset (contract item 5 DOCS: "This IS the documentation task (Mode B)").

**Deliverable** (Mode B — `package.json` metadata ONLY + confirmation assertions):
1. **`package.json`** — MODIFY:
   - **`description`** (line 4): rewrite to reflect the stagecoach-backed,
     identity-transparent commit-generation path (the current generic
     *"Autonomous PRP Development Pipeline - Agentic software development system"*).
   - **`keywords`** (lines 62-67): ADD `stagecoach`, `commit-generation`,
     `identity-transparent` (the contract item 3a examples) to the existing
     `["typescript", "agent", "pipeline", "autonomous"]` array.
2. **CONFIRMATION (no edits)** — assert via `grep`, in the validation gates, that:
   - `FORMAT_NUDGE_MAX` is **ABSENT** from `src/config/hack-config.ts` (no SCHEMA_MAP
     row exists, so none needs adding or removing).
   - `FORMAT_NUDGE_MAX` is **ABSENT** from `.env.example` and the team-wide `.hack`
     file (no env/TOML entry is needed).
   - `FORMAT_NUDGE_MAX` remains a plain `export const FORMAT_NUDGE_MAX = 2` in
     `src/config/constants.ts:459` with NO env reader (its JSDoc explicitly states
     "intentionally NOT exposed as an environment variable or a `.hack` TOML key").
   If (and only if) a row/entry was *accidentally* added by a prior subtask, S2
   removes it; otherwise S2 makes no change to those files.

**Success Definition**:
- `package.json` `description` names stagecoach (the commit-message generator) and/or
  identity-transparency; `keywords` includes `stagecoach`, `commit-generation`, and
  `identity-transparent`.
- `npm run format:check` passes (package.json is in prettier's JSON glob; run
  `npm run format` if it re-wraps the keyword array).
- `npm run validate` GREEN; no typecheck/test regressions (metadata-only change,
  zero code impact).
- `grep` confirms `FORMAT_NUDGE_MAX` has no `.hack` schema row, no `.env.example`
  entry, no `.hack` TOML key, and no env reader in `constants.ts` — i.e. it is
  correctly internal-only per PRD §4.5.1.
- **Only `package.json` is modified** (confirmation files are READ-ONLY).

---

## User Persona (if applicable)

**Target User**: A developer/operator browsing npm or GitHub who is evaluating
whether to adopt `hacky-hack`, and a future maintainer auditing the config
surface for `FORMAT_NUDGE_MAX`.
**Use Case**: (1) npm search / GitHub topic discovery — the `description` + `keywords`
are the first thing a prospective user sees; surfacing "stagecoach" +
"identity-transparent" signals the commit-generation quality bar. (2) A maintainer
asks "is `FORMAT_NUDGE_MAX` tunable?" — the answer (no, it's internal) is confirmed
by the absence of any schema/env surface.
**User Journey**: npm/GitHub landing → reads description/keywords → understands the
pipeline delegates commits to stagecoach and is identity-transparent → adopts.
**Pain Points Addressed**: (1) The current generic description/keywords give no hint
that commit generation is delegated to a real, identity-transparent tool (a key
differentiator after the §9.10 mis-attribution incident). (2) Avoids accidentally
exposing an internal constant (`FORMAT_NUDGE_MAX`) as a tunable, which would imply
a stability/support contract PRD §4.5.1 deliberately does not grant.

---

## Why

- **PRD §9.10 compliance + discoverability**: §9.10.1 (stagecoach delegation,
  identity-transparent by design) and §9.10.2 (structural guard) are implemented in
  Phase P1 (Complete) but have **no `package.json` surface**. `description` +
  `keywords` are the canonical npm/GitHub discoverability metadata; the stagecoach
  + identity-transparency story belongs there (contract item 3a).
- **PRD §4.5.1 contract**: `FORMAT_NUDGE_MAX` is explicitly an INTERNAL constant
  with a fixed default of 2 — *"no env var is documented for it"* / *"no new tunable
  is required."* S2's job is to **confirm** no `.hack` schema row or env entry
  leaked in (contract item 3b/3c). If one did, it would falsely advertise an
  internal retry budget as a supported tunable.
- **Trust/safety communication**: After the §9.10 incidents (mis-attribution on
  46/49 commits), "identity-transparent commit generation" is a primary selling
  point — it should be in the package metadata, not buried.
- **Mode B documentation**: This is the metadata/doc task that closes the changeset
  (item 5 DOCS). Sibling P3.M1.T1.S1 owns README.md; S2 owns package.json metadata.

### Out of scope (hard fences)
- **README.md** → owned by sibling **P3.M1.T1.S1** ("Update README.md — stagecoach,
  identity-transparency, tool scoping"). S2 does NOT touch README.
- **Any source code logic** (`src/**/*.ts`) → READ-ONLY. S2 makes no behavioral
  change. (The `FORMAT_NUDGE_MAX` constant + its 3 call-site wirings are owned by
  P2.M1.T1.S1, Complete; S2 only READS/CONFIRMS.)
- **`src/config/hack-config.ts`** → READ-ONLY confirmation only (no SCHEMA_MAP edit
  unless a stray row was accidentally added — in which case the fix is to REVERT that
  stray addition, not to add a legitimate one).
- **`.env.example` / `.hack`** → READ-ONLY confirmation only (no `FORMAT_NUDGE_MAX`
  entry should exist; if one does, remove it; otherwise no change).
- **`docs/*.md`** (ARCHITECTURE.md, CONFIGURATION.md, CLI_REFERENCE.md, etc.) → owned
  by a separate changeset-level doc sweep. S2 does NOT touch docs/*.
- **`vitest.config.ts`** → READ-ONLY.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md`** → READ-ONLY (orchestrator-owned).
- **`package.json` deps/scripts/bin/engines/author/license** → UNCHANGED. S2 edits
  ONLY `description` + `keywords`.

---

## What

### User-visible behavior
npm/GitHub metadata changes (description + keywords). No runtime/behavioral change
(this is Mode B documentation/metadata). The `FORMAT_NUDGE_MAX` confirmation is a
no-op grep (nothing changes unless a stray row is found).

### Technical requirements (exact contract — item 3)

**(a) `description` (package.json line 4).** Rewrite the generic description to
reflect the stagecoach-backed, identity-transparent commit-generation path. Keep it
a single JSON string (escape any inner quotes; prefer an em-dash `—` or hyphen `-`
to avoid quote-escaping). Example (adapt wording; the contract gives the themes,
not a verbatim string):

```jsonc
// BEFORE (line 4):
"description": "Autonomous PRP Development Pipeline - Agentic software development system",

// AFTER (example wording — stagecoach + identity-transparent):
"description": "Autonomous PRP Development Pipeline — stagecoach-backed, identity-transparent commit generation for agentic software development",
```

The new description MUST name **stagecoach** (the commit-message generator) and
signal **identity-transparency** (no `Co-Authored-By` / machine author). The exact
phrasing is the implementer's choice as long as those two themes are present.

**(b) `keywords` (package.json lines 62-67).** ADD the three contract-mandated tags
(`stagecoach`, `commit-generation`, `identity-transparent`) to the existing array.
Optional extras (`git`, `commits`) are allowed but not required.

```jsonc
// BEFORE (lines 62-67):
"keywords": [
  "typescript",
  "agent",
  "pipeline",
  "autonomous"
],

// AFTER (append the three tags; prettier may reorder — run `npm run format`):
"keywords": [
  "typescript",
  "agent",
  "pipeline",
  "autonomous",
  "stagecoach",
  "commit-generation",
  "identity-transparent"
],
```

**(c) FORMAT_NUDGE_MAX confirmation (NO edits — grep assertions).** Verify in the
validation gates that:
- `grep -rn "FORMAT_NUDGE_MAX" src/config/hack-config.ts` → **ABSENT** (no
  SCHEMA_MAP row). The `commit` section (hack-config.ts ≈line 332) holds commit
  tunables like `commit_format` and the env-driven `COMMIT_RETRY_MAX`, but
  `FORMAT_NUDGE_MAX` is deliberately NOT among them.
- `grep -n "FORMAT_NUDGE" .env.example` → **ABSENT** (no env entry).
- `grep -n "FORMAT_NUDGE" .hack` → **ABSENT** (no TOML key).
- `src/config/constants.ts:459` is `export const FORMAT_NUDGE_MAX = 2;` with NO
  `process.env` read and NO `getFormatNudgeMax()` getter (its JSDoc at ≈line 449
  states *"intentionally NOT exposed as an environment variable or a `.hack` TOML
  key … Do not add an env reader here"*).

**If (and only if) a stray row/entry IS found**, S2 removes it (revert the stray
addition to restore the internal-only contract). The expected state per the working
tree (research §2-4) is: nothing stray exists → nothing to remove → S2 makes NO edit
to hack-config.ts / .env.example / .hack.

### Success Criteria
- [ ] `package.json` `description` names stagecoach and signals identity-transparency.
- [ ] `package.json` `keywords` includes `stagecoach`, `commit-generation`, and
      `identity-transparent`.
- [ ] `grep FORMAT_NUDGE_MAX src/config/hack-config.ts` → no match (ABSENT).
- [ ] `grep FORMAT_NUDGE .env.example .hack` → no match (ABSENT).
- [ ] `FORMAT_NUDGE_MAX` in `constants.ts` is still a plain const with no env reader.
- [ ] `npm run format:check` passes (run `npm run format` if it re-wraps keywords).
- [ ] `npm run validate` GREEN; no test/typecheck regressions.
- [ ] Only `package.json` is modified (`git diff --name-only` → `package.json`).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a single-file JSON metadata change (Mode B) plus grep-confirmation
assertions. Its correctness hinges on eight pre-proven facts, all pinned with
file:line anchors below: (1) the **exact `description` line** (package.json:4 —
generic, no stagecoach); (2) the **exact `keywords` block** (package.json:62-67 —
`["typescript","agent","pipeline","autonomous"]`, 4 tags, not alphabetical);
(3) **`FORMAT_NUDGE_MAX` is a plain `const`** at constants.ts:459 with JSDoc that
explicitly forbids an env var / `.hack` key (≈line 449: *"intentionally NOT
exposed … Do not add an env reader here"*); (4) **`hack-config.ts` SCHEMA_MAP is
ABSENT of FORMAT_NUDGE_MAX** (sections present: models/reasoning/harness/endpoint/
pipeline/distributed_prd/concurrency/bug_hunt/validation/api/monitor/cli/commit/
tasks_lock — the `commit` section at ≈332 holds `commit_format` + the env-driven
`COMMIT_RETRY_MAX`, but NOT format_nudge_max); (5) **`.env.example` and `.hack`
have NO `FORMAT_NUDGE` entry** (grep → none); (6) **the 3 FORMAT_NUDGE_MAX call
sites** (prp-executor.ts:32/358, prp-generator.ts:28/829, fix-cycle-workflow.ts:44/391)
all import the CONSTANT directly (no getter) — wired by P2.M1.T1.S1, Complete;
S2 only confirms; (7) **JSON formatting** — package.json is in prettier's JSON glob;
run `npm run format` after editing to fix keyword-array wrapping/indentation; (8)
**Mode B scope** — S2 edits ONLY package.json's `description` + `keywords`; README
(S1), src/ (P2.M1.T1.S1 + Phase P1), docs/* (separate sweep) are all disjoint.

### Documentation & References
```yaml
# MUST READ — the PRD spec (already provided in selected_prd_content)
- docfile: PRD.md
  section: "9.1 Technology Stack" (h3.19 — names stagecoach + identity-transparent)
       + "9.10.1 Commit-Message Generation" (h4.43 — stagecoach delegation, message-only)
       + "4.5.1 Format-Nudge Recovery" (h4.0 — FORMAT_NUDGE_MAX default 2, no env var)
  why: §9.1/§9.10.1 are the source of the stagecoach + identity-transparency themes the
       description/keywords must surface. §4.5.1 is the normative rule that
       FORMAT_NUDGE_MAX is internal-only ("fixed default", "no new tunable is required").
  critical: §4.5.1 gives FORMAT_NUDGE_MAX a FIXED default of 2 with no documented env var.
            S2's confirmation asserts this internal-only status is preserved.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/015_459c7d9be558/P3M1T1S2/research/s2-codebase-analysis.md
  section: §1 (package.json current description/keywords + JSON gotchas), §2 (FORMAT_NUDGE_MAX
       is a plain const, no env reader, JSDoc forbids exposure), §3 (.hack SCHEMA_MAP sections
       + FORMAT_NUDGE ABSENT), §4 (.hack file + .env.example ABSENT), §5 (sibling coordination,
       zero overlap), §6 (Mode B), §7 (validation commands), §8 (the minimal change)
  why: Proves the exact edit sites, the ABSENT (not add/remove) confirmation, the JSON
       formatting gate, and the disjoint sibling scopes.

# MUST READ — sibling S1 contract (confirms zero overlap)
- docfile: plan/015_459c7d9be558/P3M1T1S1/PRP.md
  section: "Out of scope (hard fences)" — explicitly assigns package.json to S2:
       "package.json → owned by sibling P3.M1.T1.S2 ('Update package.json + confirm
       no .hack schema row for FORMAT_NUDGE_MAX')."
  why: Confirms S1 (README) and S2 (package.json) are file-disjoint; no merge conflict.
       S1 also confirms the stagecoach-ai dep is real (cites package.json:83 ^0.1.16).

# THE FILE TO EDIT (the only file)
- file: package.json
  section: (1) "description" (line 4) — rewrite to name stagecoach + identity-transparency;
       (2) "keywords" (lines 62-67) — append stagecoach, commit-generation, identity-transparent.
  why: package.json description/keywords are the canonical npm/GitHub discoverability
       metadata; the stagecoach + identity-transparency story (shipped Phase P1) has no
       metadata surface today.
  pattern: standard JSON (double quotes, 2-space indent, no trailing commas). The existing
       keywords array is insertion-ordered (not alphabetical) — prettier may reorder;
       run `npm run format`.
  gotcha: KEEP description a single JSON string (escape any inner double-quotes or use an
       em-dash/hyphen to avoid them). Do NOT touch deps/scripts/bin/engines/author/license.
       Confirm the exact stagecoach-ai version line at edit time (S1 cites ^0.1.16 at :83).

# CONFIRMATION targets (READ-ONLY — no edits unless a stray row is found)
- file: src/config/constants.ts
  section: FORMAT_NUDGE_MAX (line 459): `export const FORMAT_NUDGE_MAX = 2;` with JSDoc
       (≈line 449) stating "intentionally NOT exposed as an environment variable or a
       `.hack` TOML key … Do not add an env reader here."
  why: Confirms FORMAT_NUDGE_MAX is correctly internal-only (no env reader, no getter).
  gotcha: READ-ONLY for S2. If a `getFormatNudgeMax()` getter or `process.env` read was
       accidentally added, that's a P2.M1.T1.S1 regression to flag — but per research it's
       a plain const. Do NOT add a getter here.

- file: src/config/hack-config.ts
  section: SCHEMA_MAP (line 189+) — exhaustive §9.7.5 schema reference. Sections: models,
       reasoning, harness, endpoint, pipeline, distributed_prd, concurrency, bug_hunt,
       validation, api, monitor, cli, commit, tasks_lock. The `commit` section (≈332) holds
       commit_format + COMMIT_RETRY_MAX but NOT format_nudge_max.
  why: Confirms no SCHEMA_MAP row for FORMAT_NUDGE_MAX exists (ABSENT = correct).
  gotcha: READ-ONLY. A FORMAT_NUDGE_MAX row would be { section:'pipeline', key:'format_nudge_max',
       envVar:'FORMAT_NUDGE_MAX', ... } — none exists. If one was accidentally added, REMOVE it.

- file: .env.example
  why: Confirms no `FORMAT_NUDGE` env entry exists (ABSENT = correct).
  gotcha: READ-ONLY. If a `FORMAT_NUDGE_MAX=2` line was accidentally added, REMOVE it.

- file: .hack
  section: team-wide defaults TOML. Sections: harness, models, distributed_prd, pipeline,
       validation, cli.
  why: Confirms no `format_nudge_max` TOML key exists (ABSENT = correct).
  gotcha: READ-ONLY. If `[pipeline] format_nudge_max = 2` was accidentally added, REMOVE it.

# CONTRACT INPUTS (read-only — confirm shipped behavior)
- file: package.json (dependencies block)
  section: "stagecoach-ai" (≈line 83, per S1's research). Added by P1.M2.T1.S1 (Complete).
  why: Confirms the "stagecoach ships transitively" claim grounding the description/keywords
       is TRUE in the current tree (not aspirational). Confirm exact version at edit time.

- file: src/agents/prp-executor.ts (≈line 32, 358) + src/agents/prp-generator.ts (≈28, 829)
       + src/workflows/fix-cycle-workflow.ts (≈44, 391)
  why: Confirms all 3 FORMAT_NUDGE_MAX call sites import the CONSTANT directly (no getter),
       wired by P2.M1.T1.S1 (Complete). S2 does NOT touch these.

- file: vitest.config.ts
  why: coverage.include = ['src/**/*.ts'] — package.json is NOT in the coverage glob;
       the metadata change has zero coverage impact.
- file: package.json (scripts)
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
package.json                 # EDIT — description (line 4) + keywords (lines 62-67)
src/config/constants.ts      # READ-ONLY — FORMAT_NUDGE_MAX const (line 459), confirm no env reader
src/config/hack-config.ts    # READ-ONLY — SCHEMA_MAP, confirm no FORMAT_NUDGE_MAX row
.env.example                 # READ-ONLY — confirm no FORMAT_NUDGE entry
.hack                        # READ-ONLY — confirm no format_nudge_max TOML key
README.md                    # READ-ONLY (sibling P3.M1.T1.S1 owns it)
docs/*.md                    # READ-ONLY (separate doc sweep)
vitest.config.ts             # READ-ONLY — package.json not in coverage glob
PRD.md                       # READ-ONLY — §9.1/§9.10.1/§4.5.1 source of truth
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
package.json                 # MODIFIED — description + keywords reflect stagecoach + identity-transparency
# (no NEW files; no edits to src/, .env.example, .hack, README.md, docs/*)
```

### Known Gotchas of our codebase & Library Quirks
```jsonc
// CRITICAL (Mode B = metadata-only): S2 edits ONLY package.json's description + keywords.
//   Do NOT touch deps/scripts/bin/engines/author/license. Do NOT edit README (S1),
//   src/ (P2.M1.T1.S1 + Phase P1), docs/* (separate sweep), .env.example, .hack, or
//   hack-config.ts. The FORMAT_NUDGE_MAX confirmation is a GREP assertion, not an edit
//   (unless a stray row is found — then REVERT only that stray addition).
// CRITICAL (FORMAT_NUDGE_MAX is intentionally internal): PRD §4.5.1 + the constant's own
//   JSDoc (constants.ts ≈line 449) state it is "intentionally NOT exposed as an environment
//   variable or a `.hack` TOML key … Do not add an env reader here." S2 CONFIRMS this
//   (ABSENT in hack-config.ts / .env.example / .hack). Do NOT "helpfully" add a row/env
//   entry — that would violate §4.5.1 and create a false support contract.
// CRITICAL (JSON validity): package.json is strict JSON. description must be a single
//   double-quoted string (escape inner quotes or avoid them — use an em-dash — or hyphen).
//   keywords must be a JSON string array with no trailing comma. Run `npm run format`
//   after editing — prettier enforces 2-space indent + array wrapping.
// CRITICAL (no trailing comma in keywords): the BEFORE array has no trailing comma after
//   "autonomous". When appending, add the comma after "autonomous" and the new tags, with
//   NO trailing comma after the last tag. Prettier will normalize; verify with `node -e
//   "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`.
// GOTCHA (keywords not alphabetical): the existing array is insertion-ordered (typescript,
//   agent, pipeline, autonomous — not sorted). Appending is fine; prettier may or may not
//   reorder — accept prettier's output.
// GOTCHA (em-dash vs hyphen): the BEFORE description uses " - " (hyphen with spaces). Using
//   an em-dash "—" is fine in JSON (it's a Unicode char, no escaping) and matches the PRD's
//   typographic style. A plain hyphen "-" also works. Either is acceptable.
// GOTCHA (stagecoach-ai version drift): S1's research cited package.json:83 as ^0.1.16.
//   S2 does NOT edit the dep version — but CONFIRM the line exists at edit time (the
//   description/keywords claim is grounded by the real dep). Do not hardcode the version
//   in the description.
// GOTCHA (format:check is gated): package.json IS in prettier's JSON glob. A malformed
//   keywords array (e.g. trailing comma) fails `npm run format:check` → `npm run validate`
//   fails. Always run `npm run format` after the edit, then `npm run format:check`.
// GOTCHA (no coverage impact): vitest.config.ts coverage.include = ['src/**/*.ts'].
//   package.json is not TypeScript source — the metadata change has ZERO coverage impact.
//   The 100/100/100/100 gate is unaffected.
```

---

## Implementation Blueprint

### Data models and structure
None. Pure JSON metadata (Mode B). No types, models, constants, or code.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY package.json — description (line 4)
  - EDIT the "description" value (line 4) from the generic
    "Autonomous PRP Development Pipeline - Agentic software development system"
    to a new single JSON string that names stagecoach (the commit-message generator)
    and signals identity-transparency. Example:
      "Autonomous PRP Development Pipeline — stagecoach-backed, identity-transparent commit generation for agentic software development"
    (Adapt wording; the two themes — stagecoach + identity-transparent — MUST be present.)
  - PRESERVE: valid JSON (single double-quoted string; escape or avoid inner quotes;
    use em-dash — or hyphen -). Keep "name", "version", "type", "bin", "engines" unchanged.
  - FOLLOW pattern: standard JSON string value; the existing hyphen-with-spaces style or
    the PRD's em-dash style (both acceptable).
  - GOTCHA: do NOT introduce an unescaped double-quote inside the string. Do NOT change
    "name": "hacky-hack" or "version".

Task 2: MODIFY package.json — keywords (lines 62-67)
  - EDIT the "keywords" array to ADD (at minimum) "stagecoach", "commit-generation",
    and "identity-transparent" to the existing ["typescript","agent","pipeline","autonomous"].
    Optional extras: "git", "commits".
  - PRESERVE: valid JSON string array (add a comma after "autonomous"; no trailing comma
    after the last new tag). Keep all 4 existing tags.
  - FOLLOW pattern: the existing lowercase-hyphenated keyword style (e.g. "commit-generation",
    "identity-transparent" match "typescript"/"autonomous").
  - GOTCHA: prettier may re-wrap/reorder the array — run `npm run format` after, then
    `npm run format:check`. Verify JSON parses: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`.

Task 3: CONFIRM (no edits) — FORMAT_NUDGE_MAX is internal-only
  - RUN grep -rn "FORMAT_NUDGE_MAX" src/config/hack-config.ts → EXPECT no match (ABSENT).
  - RUN grep -n "FORMAT_NUDGE" .env.example → EXPECT no match (ABSENT).
  - RUN grep -n "FORMAT_NUDGE" .hack → EXPECT no match (ABSENT).
  - RUN grep -n "FORMAT_NUDGE_MAX" src/config/constants.ts → EXPECT the single
    `export const FORMAT_NUDGE_MAX = 2;` (line 459) + JSDoc; NO `process.env` read, NO
    `getFormatNudgeMax` getter.
  - IF any stray row/entry IS found (unexpected per research): REMOVE it to restore the
    internal-only contract. Document the removal in the commit message. (Expected: nothing
    to remove — no edit to these files.)
  - GOTCHA: this task is a CONFIRMATION. The default outcome is "no change to
    hack-config.ts / .env.example / .hack." Only act if a stray addition is found.

Task 4: VERIFY — format + no regressions + only package.json changed
  - RUN npm run format → auto-fix any keyword-array wrapping/indentation.
  - RUN npm run format:check → passes.
  - RUN npm run typecheck → exit 0 (no impact; confirms no accidental src edit).
  - RUN npm run test:run → green (no impact; package.json not in coverage glob).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds (no impact).
  - RUN node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" → no throw
    (valid JSON).
  - RUN grep -n "stagecoach\|commit-generation\|identity-transparent" package.json → all
    three present (in description and/or keywords).
  - VERIFY only package.json changed: git diff --name-only → package.json (UNLESS Task 3
    found a stray row, in which case ALSO the file it was removed from — document it).
```

### Implementation Patterns & Key Details
```jsonc
// PATTERN: the description edit (package.json line 4).
//   BEFORE: "description": "Autonomous PRP Development Pipeline - Agentic software development system",
//   AFTER:  "description": "Autonomous PRP Development Pipeline — stagecoach-backed, identity-transparent commit generation for agentic software development",
//   (single JSON string; em-dash or hyphen; names stagecoach + identity-transparency)

// PATTERN: the keywords edit (package.json lines 62-67).
//   BEFORE:
//     "keywords": [
//       "typescript",
//       "agent",
//       "pipeline",
//       "autonomous"
//     ],
//   AFTER (append; prettier may re-wrap):
//     "keywords": [
//       "typescript",
//       "agent",
//       "pipeline",
//       "autonomous",
//       "stagecoach",
//       "commit-generation",
//       "identity-transparent"
//     ],

// PATTERN: the confirmation (no edits — grep assertions in validation gates).
//   grep -rn "FORMAT_NUDGE_MAX" src/config/hack-config.ts   # ABSENT (correct)
//   grep -n "FORMAT_NUDGE" .env.example .hack               # ABSENT (correct)
//   grep -n "FORMAT_NUDGE_MAX" src/config/constants.ts      # the single const, no env reader

// CRITICAL: Mode B = package.json description+keywords ONLY. No README (S1), no src/,
//   no docs/*, no .env.example/.hack/hack-config.ts edits (confirmation is grep, not edit).
// CRITICAL: FORMAT_NUDGE_MAX is intentionally internal (PRD §4.5.1). Do NOT add a row/env
//   entry. CONFIRM its absence. Only REMOVE if a stray addition is found.
// CRITICAL: run `npm run format` after the JSON edit — package.json is in prettier's glob.
```

### Integration Points
```yaml
PACKAGE.JSON:
  - edit: "description" (line 4) — stagecoach + identity-transparency.
  - edit: "keywords" (lines 62-67) — +stagecoach, +commit-generation, +identity-transparent.
  - unchanged: name, version, type, bin, engines, scripts, dependencies, author, license.

NO SOURCE / NO README / NO docs/*.md / NO .env.example / NO .hack / NO hack-config.ts
  — Mode B metadata-only. FORMAT_NUDGE_MAX confirmation = grep assertions (no edits
  unless a stray row is found).
NO PRD.md / NO tasks.json / NO prd_snapshot.md / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run format           # auto-fix keyword-array wrapping/indentation (package.json in JSON glob)
npm run format:check     # prettier --check → passes
# Expected: Zero errors. If format:check fails, run `npm run format` then re-check.

# JSON validity (belt-and-suspenders):
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo "valid JSON"
# Expected: "valid JSON" (no throw — no trailing comma, no unescaped quote).
```

### Level 2: Unit Tests (Component Validation)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (confirms no accidental src edit)
npm run test:run         # vitest run → green (package.json not in coverage include glob)
# Expected: No regressions. The metadata change has zero code/coverage impact.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate         # lint + format:check + typecheck + test:run → GREEN
npm run build            # tsc -p tsconfig.build.json → succeeds (no impact)
# Expected: GREEN. package.json metadata does not affect the build.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the description + keywords reflect the stagecoach + identity-transparency themes:
grep -n "stagecoach" package.json                    # EXPECT: ≥1 (description and/or keyword)
grep -n "identity-transparent" package.json          # EXPECT: ≥1 (description and/or keyword)
grep -n "commit-generation" package.json             # EXPECT: ≥1 (keyword)

# Confirm the three contract-mandated keywords are present:
node -e "const k=require('./package.json').keywords; console.log(k.includes('stagecoach'), k.includes('commit-generation'), k.includes('identity-transparent'))"
# EXPECT: true true true

# CONFIRM FORMAT_NUDGE_MAX is internal-only (no schema row, no env, no TOML key):
grep -rn "FORMAT_NUDGE_MAX" src/config/hack-config.ts   # EXPECT: no match (ABSENT)
grep -n "FORMAT_NUDGE" .env.example                      # EXPECT: no match (ABSENT)
grep -n "FORMAT_NUDGE" .hack                             # EXPECT: no match (ABSENT)

# Confirm FORMAT_NUDGE_MAX is still a plain const with no env reader:
grep -n "export const FORMAT_NUDGE_MAX" src/config/constants.ts   # EXPECT: 1 match (= 2)
grep -n "getFormatNudgeMax\|process.env\[.FORMAT_NUDGE" src/config/constants.ts  # EXPECT: no match

# Confirm the stagecoach-ai dependency is real (grounds the description/keywords claim):
grep -n "stagecoach-ai" package.json   # EXPECT: 1 match in dependencies

# Confirm only package.json changed (unless Task 3 found a stray row):
git diff --name-only
# EXPECT: package.json ONLY (or + the file a stray FORMAT_NUDGE row was removed from, documented)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` passes (package.json in prettier's JSON glob).
- [ ] `npm run typecheck` exit 0 (no accidental src edit).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds (no impact).
- [ ] `package.json` parses as valid JSON (`node -e JSON.parse …` no throw).

### Feature Validation
- [ ] `description` names stagecoach and signals identity-transparency.
- [ ] `keywords` includes `stagecoach`, `commit-generation`, and `identity-transparent`.
- [ ] `FORMAT_NUDGE_MAX` is ABSENT from `src/config/hack-config.ts` (no SCHEMA_MAP row).
- [ ] `FORMAT_NUDGE_MAX` is ABSENT from `.env.example` and `.hack` (no env/TOML entry).
- [ ] `FORMAT_NUDGE_MAX` is still `export const … = 2` in constants.ts with no env reader.

### Code Quality Validation
- [ ] Only `description` + `keywords` in package.json changed (deps/scripts/bin/etc. intact).
- [ ] New keywords match the existing lowercase-hyphenated style.
- [ ] JSON is valid (no trailing comma, no unescaped quote).
- [ ] No edits to README.md, src/, docs/*, .env.example, .hack, hack-config.ts (Mode B).

### Documentation & Deployment
- [ ] package.json is the only file modified (or + a documented stray-row revert).
- [ ] No new env vars / config / source (Mode B metadata-only).
- [ ] Commit message notes the description/keywords update + the FORMAT_NUDGE_MAX confirmation.

---

## Anti-Patterns to Avoid
- ❌ Don't edit ANY file other than `package.json` (unless Task 3 finds a stray
  FORMAT_NUDGE_MAX row — then revert ONLY that stray addition). This is Mode B
  metadata-only. No README (sibling S1), src/ (P2.M1.T1.S1 + Phase P1), docs/*
  (separate sweep), .env.example, .hack, or hack-config.ts.
- ❌ Don't **add** a `.hack` schema row or env entry for `FORMAT_NUDGE_MAX` —
  PRD §4.5.1 + the constant's own JSDoc explicitly forbid it ("intentionally NOT
  exposed … Do not add an env reader here"). S2 CONFIRMS its absence; it does not
  "helpfully" expose it. Exposing it would create a false support contract.
- ❌ Don't touch `package.json` deps/scripts/bin/engines/author/license — S2 edits
  ONLY `description` + `keywords`.
- ❌ Don't introduce an **unescaped double-quote** inside the `description` string
  or a **trailing comma** in the `keywords` array — both make package.json invalid
  JSON, failing `npm run format:check` / `npm run validate`. Verify with
  `node -e "JSON.parse(...)"`.
- ❌ Don't **hardcode the stagecoach-ai version** in the description — the dep line
  (≈package.json:83) is the source of truth; the description should name the tool,
  not the version. Confirm the dep exists at edit time.
- ❌ Don't forget `npm run format` — package.json is in prettier's JSON glob; an
  unformatted keyword array fails `npm run format:check`.
- ❌ Don't **edit README.md** — sibling P3.M1.T1.S1 owns it (stagecoach installation
  note, Commit Workflow subsection, Agent Tool Access subsection). S2 and S1 are
  file-disjoint by design.
- ❌ Don't claim **aspirational** behavior in the description — the stagecoach
  delegation (P1.M2.T1, Complete) and identity-transparency (P1.M3, Complete) are
  SHIPPED. Confirm `stagecoach-ai` in package.json deps before naming it.
- ❌ Don't touch `PRD.md`, `tasks.json`, `prd_snapshot.md`, or `vitest.config.ts`.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S2 is a single-file JSON metadata
change (Mode B): rewrite `description` (line 4) + append 3 keywords (lines 62-67),
plus grep-assertion confirmations that `FORMAT_NUDGE_MAX` is correctly internal-only.
Every edit site is pinned with a file:line anchor, and the FORMAT_NUDGE_MAX confirmation
is a no-op grep (research §2-4 proves ABSENT in hack-config.ts / .env.example / .hack,
and a plain const with no env reader in constants.ts:459). The correctness rests on
eight pre-proven facts: the exact description line, the exact keywords block, the
plain-const status of FORMAT_NUDGE_MAX, its ABSENT schema/env/TOML surface, the 3
already-wired call sites (P2.M1.T1.S1 Complete), the JSON formatting gate, the
zero-coverage impact (package.json not in the src/**/*.ts glob), and the Mode-B
disjoint-sibling scope (S1 = README, S2 = package.json — zero overlap, confirmed by
S1's own "Out of scope" fence). The single notable risk — JSON validity (trailing
comma / unescaped quote) — is mitigated by Task 4's `node -e JSON.parse` check and
`npm run format`. The stagecoach-ai dep grounding is confirmed real (P1.M2.T1.S1
Complete; S1 cites package.json:83). The remaining 1/10 is ordinary
description-wording/keyword-style judgment (mitigated by the "must name stagecoach +
identity-transparency" + "match lowercase-hyphenated style" guidance).