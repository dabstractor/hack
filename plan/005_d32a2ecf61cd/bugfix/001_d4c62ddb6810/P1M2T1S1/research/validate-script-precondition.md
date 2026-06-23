# Research Note — P1.M2.T1.S1: Add `test:run` to the `validate` script + update `docs/TESTING.md`

Pure research (read-only). No files outside this research/ directory were modified. All
commands run from `/home/dustin/projects/hacky-hack`. HEAD at authoring time: `a2a762e`.

## 0. CRITICAL PRECONDITION FINDING — TREE STATE DIVERGES FROM THE CONTRACT'S ASSUMPTION

The work-item contract's INPUT clause assumes: *"The fixed codebase from P1.M1.T1.S1
(the logger regression must be fixed FIRST, otherwise adding test:run to validate would
cause validate to fail due to the 14 broken progress-display tests)."*

That model is built on `main@4e6d2ef`, but **the current working tree is NOT `main@4e6d2ef`**.
It is a divergent branch:

```
git merge-base --is-ancestor 4e6d2ef HEAD && echo YES || echo NO   →   NO   (diverged)
git rev-parse --short HEAD                                          →   a2a762e
```

The current branch (`a2a762e`) descends from `b03ed87`/`93be68d` (the bug-report branch)
and **does not contain the Session 005 resilience work** that lives on `main` (`d9a4d9a`…`4e6d2ef`).
This is the SAME divergence P1.M1T1S1 documented (P1.M1T1S1 was a verified no-op: the
logger regression line is absent here).

### Empirical gate state on the current tree (all measured this session)

| Gate | Command | Exit | Notes |
|---|---|---|---|
| lint | `npm run lint` | **0** | clean |
| format:check | `npm run format:check` | **0** | clean |
| typecheck | `npm run typecheck` | **2** | 2 errors — see §0.1 |
| validate (static) | `npm run validate` | **2** | **ALREADY RED** (fails at typecheck via `&&`) |
| test:run | `npm run test:run` | non-zero | **250 failed \| 5454 passed \| 70 skipped** (161 files) |

**Conclusion:** `npm run validate` is **already failing on the current tree** (at `typecheck`),
independent of this subtask. Adding `&& npm run test:run` therefore has **zero behavioral
effect on the current tree** — `&&` short-circuits at the failing `typecheck` before
`test:run` is ever reached. The contract's verification ("`npm run validate` must exit 0")
**cannot be satisfied on this tree** because the tree is pre-existingly broken on two
unrelated axes (static + tests), neither caused by this subtask.

### 0.1 Why typecheck fails (pre-existing, out of scope)

```
src/core/tasks-json-recovery.ts(42,10): error TS2305: Module '"../tools/git-mcp.js"' has no
  exported member 'gitFileHistory'.
src/core/tasks-json-recovery.ts(42,26): error TS2305: Module '"../tools/git-mcp.js"' has no
  exported member 'gitReadFileAtCommit'.
```

`tasks-json-recovery.ts` was added on this branch by commit `6e80a4f`, but the two exports it
imports (`gitFileHistory`, `gitReadFileAtCommit`) were added to `git-mcp.ts` in commit
`0a6d55a` **on `main`**, which is NOT on this branch. The current branch is therefore
**internally inconsistent** (a module committed without its dependency exports). Confirmed:

```
$ grep -nE "export (async )?function (gitFileHistory|gitReadFileAtCommit)" src/tools/git-mcp.ts
(no output — ABSENT)
```

### 0.2 Why 250 tests fail (pre-existing, out of scope — sample)

The failures cluster into three categories, NONE caused by this subtask (which edits only
`package.json` + `docs/TESTING.md`):

1. **Missing source (R1/R2 resilience constants not on this branch):**
   - `tests/unit/config/research-timeout.test.ts` (6) — `TypeError: getResearchTimeoutSeconds
     is not a function` (the function lives on `main`, not here).
   - `tests/unit/config/issue-retry-max.test.ts` — same pattern (`ISSUE_RETRY_MAX`/getter absent).
   `grep` confirms `src/config/constants.ts` exports NEITHER `RESEARCH_TIMEOUT`/`getResearchTimeoutSeconds`
   NOR `ISSUE_RETRY_MAX`/`getIssueRetryMax`.

2. **Environment-specific (yalc vs npm-link mismatch):**
   - `tests/unit/utils/groundswell-linker.test.ts` (11), `tests/unit/utils/validate-groundswell-link.test.ts`,
     `tests/unit/groundswell/imports.test.ts` ("should have valid npm link configuration from S1").
   These assert npm-link behavior, but this repo uses `"groundswell": "file:.yalc/groundswell"` (yalc),
   not `npm link`. Pre-existing on this branch.

3. **Other pre-existing failures on this branch:**
   - `checkpoint-manager.test.ts` (25), `retry.test.ts` (7), `bug-hunt-workflow.test.ts` (4),
     `errors-environment.test.ts` (2), `tasks-json-recovery.test.ts` PATH B (2),
     `task-orchestrator.test.ts` (2), `coder-agent.test.ts` (2), `prd-pipeline-progress.test.ts` (1), etc.

**None of these are the 14 progress-display tests** the contract worried about — those pass on
this tree (the logger regression is absent here, so P1.M1.T1 was a no-op).

### 0.3 What this means for the PRP

- The **two edits** (append `&& npm run test:run` to `validate`; add a note to `docs/TESTING.md`)
  are **unconditionally correct** — they are the literal contract deliverable and they directly
  implement Issue 2 ("the gate should be self-contained"). They MUST be made.
- The **verification gate** ("`npm run validate` exits 0") can only pass on a **reconciled/green**
  tree (e.g. `main@4e6d2ef` with the logger fix applied). On the current tree it is red for
  **pre-existing reasons unrelated to this subtask**.
- The PRP therefore uses a **Branch A / Branch B** structure (mirroring P1.M1T1S1):
  - **Branch A (green tree):** make edits → `npm run validate` exits 0. Full success.
  - **Branch B (current broken tree):** make edits (still correct) → `npm run validate` still red
    (pre-existing typecheck + 250 test failures) → document the breakdown + divergence for
    orchestrator reconciliation. The edits are correct; the red state is not this subtask's fault.

## 1. The `validate` script — current vs target (the core edit)

**Current** (`package.json`, on BOTH `main@4e6d2ef` and the current tree — identical):
```json
"validate": "npm run lint && npm run format:check && npm run typecheck"
```

**Target** (per contract LOGIC clause (a)):
```json
"validate": "npm run lint && npm run format:check && npm run typecheck && npm run test:run"
```

This appends exactly ` && npm run test:run` (space, `&&`, space, `npm run test:run`). The
`test:run` script is already defined (`"test:run": "vitest run"`) — no new script needed.

The edit is a single-string change in `package.json`. `npm run` does NOT rewrite `package.json`
for a manual script edit, so this is a hand-edit to the `scripts.validate` value only.

## 2. `docs/TESTING.md` — where to put the note

Structure (verified, 1071 lines):

| Line | Heading |
|---|---|
| 23 | `## Testing Philosophy` |
| 27 | `### 100% Coverage Requirement` |
| 85 | `### Layered Testing Approach` |
| 660 | `## Running Tests and Coverage Reports` |
| 662 | `### Test Commands` |
| 686 | (end of the Test Commands bash code block) |
| 688 | `### Coverage Reports` |

The contract suggests the note go in **"Layered Testing Approach"** or **"Testing Philosophy"**.
The most discoverable + natural home is the **"Test Commands"** subsection (where npm scripts are
listed), immediately after the Test Commands code block (between line 686 and line 688). The PRP
specifies this exact insertion plus an optional one-line cross-reference in "Layered Testing
Approach" to satisfy the contract's named sections.

Exact anchor — the Test Commands code block currently ends:
```bash
# Stop after first failure (useful for debugging)
npm run test:bail
# or
vitest run --bail=1
```
```
(newline, then `### Coverage Reports`)

## 3. Adjacent facts (scope guardrails)

- **`CONTRIBUTING.md` does NOT exist** on this tree (confirmed: `ls CONTRIBUTING.md` → not found).
  No action there. The test-infrastructure.md noted it might be a doc location; it isn't present.
- **`README.md:608`** already has `| npm run validate | Run all validation checks |`. That
  description remains accurate (even more so) after the edit. Updating it is OUT of this
  subtask's strict scope (contract DOCS clause = Mode A → `docs/TESTING.md` only). P1.M3.T4
  owns README/overview doc sync.
- **`markdownlint-cli` is already a devDependency** (`^0.49.0`, added in Session 004). Not
  relevant to this subtask; `docs:lint` is a separate gate.
- **`prebuild` hook**: `"prebuild": "npm run validate"`. After this edit, `npm run build` will
  run the full test suite pre-build. That is the intended behavior (a build should not ship if
  tests fail), but it means builds will fail on the current broken tree until it is reconciled.
  This is consistent with Issue 2's intent (no more false greens).

## 4. Self-contained verification of THIS subtask's correctness (independent of tree breakage)

Because the current tree is pre-existingly red, the PRP gives a subtask-local verification that
does NOT depend on the whole tree being green:

```bash
# (a) the edit landed and is well-formed JSON
node -e "const s=require('./package.json').scripts; \
  console.assert(s.validate==='npm run lint && npm run format:check && npm run typecheck && npm run test:run', \
  'validate script wrong: '+s.validate); console.log('validate OK:', s.validate);"

# (b) the appended script name resolves (proves test:run is a real script)
npm run test:run -- --version 2>/dev/null || npm run | grep test:run

# (c) the TESTING.md note is present
grep -n "npm run validate" docs/TESTING.md

# (d) the gate executes end-to-end (characterize exit, don't assume 0)
npm run validate; echo "validate exit: $?"
```

On a **green** tree, (d) exits 0. On the **current** tree, (d) exits 2 at typecheck (pre-existing);
the subtask is still correct per (a)–(c), and the red gate is documented as pre-existing.
